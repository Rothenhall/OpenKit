import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
} from '@nestjs/common';
import {
  SarvamService,
  type ChatMessage,
} from '../../../common/sarvam/sarvam.service.js';
import {
  isLanguageCode,
  languageOfText,
  type LanguageCode,
} from '../../../common/sarvam/languages.js';
import { SpeechChunker } from '../../../common/sarvam/speech-chunker.js';
import { pickVoice, type VoiceId } from '../../../common/sarvam/voices.js';
import {
  END_CALL_TOKEN,
  buildSystemPrompt,
  connectCue,
} from '../persona/persona-prompt.js';
import type { Call, CompanyProfile, Scenario } from '../leads.types.js';

const MAX_USER_TURNS = 40;
const MAX_USER_CHARS = 1000;
/** A spoken turn is one to three short sentences, so a tight cap keeps replies fast. */
const SPOKEN_MAX_TOKENS = 220;

/** The turn loop. Text in, text out. Voice wraps this same loop. */
@Injectable()
export class CallService {
  constructor(private readonly sarvam: SarvamService) {}

  async start(
    profile: CompanyProfile,
    scenario: Scenario,
    language: LanguageCode,
    voice?: VoiceId,
    practiceMinutes = 5,
  ): Promise<Call> {
    const startedAt = Date.now();
    const call: Call = {
      id: randomUUID(),
      scenario,
      language,
      voice: voice ?? voiceFor(scenario),
      turns: [],
      ended: false,
      startedAt,
      practiceMinutes,
      endsAt: startedAt + practiceMinutes * 60_000,
    };
    await this.speak(profile, call);
    return call;
  }

  async takeTurn(
    profile: CompanyProfile,
    call: Call,
    userText: string,
    detectedLanguage?: unknown,
  ): Promise<Call> {
    this.addUserTurn(call, userText, detectedLanguage);
    await this.speak(profile, call);
    return call;
  }

  /**
   * Validates the user's line and adds it to the call. Split from the reply
   * so the voice path can stream the answer while the text path stays simple.
   */
  addUserTurn(call: Call, userText: string, detectedLanguage?: unknown): void {
    const text = userText.trim().slice(0, MAX_USER_CHARS);
    if (!text)
      throw new BadRequestException('Say something to continue the call');
    if (call.ended) throw new BadRequestException('This call has ended');
    if (Date.now() > call.endsAt) {
      call.ended = true;
      throw new GoneException(
        'Practice time is up. End the call to see the scorecard.',
      );
    }
    if (
      call.turns.filter((t) => t.speaker === 'user').length >= MAX_USER_TURNS
    ) {
      call.ended = true;
      throw new BadRequestException('This call reached its length limit');
    }
    call.turns.push({ speaker: 'user', text });
    // Mirror the user's current language, for any language and any mix. The
    // transcript's own script is the reliable signal: in codemix mode Hindi
    // comes back in Devanagari, so an all-Latin transcript is English even
    // when the detector labels an Indian accent as Hindi. Sarvam's label only
    // decides between languages that share a script, such as Hindi and Marathi.
    call.language = languageOfText(
      text,
      isLanguageCode(detectedLanguage) ? detectedLanguage : call.language,
    );
  }

  /**
   * Streams the agent's next line. `onSentence` fires for each speakable
   * sentence the moment it is complete, so audio can start while the model
   * is still writing. Whatever was actually emitted is what lands in the
   * call history, even when the turn is cut short by a barge in.
   */
  async speakStream(
    profile: CompanyProfile,
    call: Call,
    signal: AbortSignal,
    onSentence: (sentence: string) => void,
  ): Promise<void> {
    const chunker = new SpeechChunker();
    const said: string[] = [];
    let raw = '';
    const emit = (chunks: string[]) => {
      for (const chunk of chunks) {
        const sentence = stripToSpeech(chunk);
        if (!sentence || signal.aborted) continue;
        said.push(sentence);
        onSentence(sentence);
      }
    };
    try {
      for await (const piece of this.sarvam.chatStream(
        this.toMessages(profile, call),
        { temperature: 0.5, maxTokens: SPOKEN_MAX_TOKENS },
        signal,
      )) {
        raw += piece;
        emit(chunker.push(piece));
      }
    } catch (error) {
      // Keep what the user already heard so the history matches the call.
      if (said.length) call.turns.push({ speaker: 'agent', text: said.join(' ') });
      throw error;
    }
    if (!signal.aborted) emit(chunker.flush());
    if (signal.aborted) {
      // A barge in names the last clip that started playing. Sentences after
      // it were generated but never heard, so they do not belong in history.
      const keep = (signal.reason as { keep?: number } | undefined)?.keep;
      const heard = typeof keep === 'number' ? said.slice(0, keep + 1) : said;
      if (heard.length) call.turns.push({ speaker: 'agent', text: heard.join(' ') });
      return;
    }
    if (!said.length) {
      // Empty stream. One plain retry, then a spoken fallback, never silence.
      const retry = stripToSpeech(
        await this.sarvam.chat(this.toMessages(profile, call), {
          temperature: 0.5,
          maxTokens: SPOKEN_MAX_TOKENS,
        }),
      );
      raw = retry;
      emit([retry || FALLBACK_LINE]);
    }
    call.turns.push({ speaker: 'agent', text: said.join(' ') });
    if (raw.includes(END_CALL_TOKEN)) call.ended = true;
  }

  private async speak(profile: CompanyProfile, call: Call): Promise<void> {
    // One retry on an empty reply, then a spoken fallback. Silence feels
    // like failure on a call, so the agent always says something.
    // Temperature 0.5 per the voice pipeline spec: steady enough to hold
    // language and role, lively enough to stay human.
    let reply = await this.sarvam.chat(this.toMessages(profile, call), {
      temperature: 0.5,
      maxTokens: SPOKEN_MAX_TOKENS,
    });
    if (!stripToSpeech(reply)) {
      reply = await this.sarvam.chat(this.toMessages(profile, call), {
        temperature: 0.5,
        maxTokens: SPOKEN_MAX_TOKENS,
      });
    }
    const ends = reply.includes(END_CALL_TOKEN);
    const text = stripToSpeech(reply) || FALLBACK_LINE;
    call.turns.push({ speaker: 'agent', text });
    if (ends) call.ended = true;
  }

  private toMessages(profile: CompanyProfile, call: Call): ChatMessage[] {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(profile, call.scenario, call.language),
      },
      { role: 'user', content: connectCue(call.scenario) },
    ];
    for (const turn of call.turns) {
      const role = turn.speaker === 'agent' ? 'assistant' : 'user';
      const last = messages.at(-1);
      // A cut off turn can leave two user lines in a row. Merge them, some
      // chat models reject or mishandle consecutive messages from one role.
      if (last && last.role === role && messages.length > 2) {
        last.content += ` ${turn.text}`;
      } else {
        messages.push({ role, content: turn.text });
      }
    }
    return messages;
  }
}

/**
 * Spoken when the model returns nothing twice. Never silence on a call.
 */
const FALLBACK_LINE = 'Sorry, I missed that. Could you say it once more?';

function stripToSpeech(reply: string): string {
  return reply.replace(END_CALL_TOKEN, '').trim();
}

/**
 * The lead's voice matches the lead, in a speaker top-ranked for the call's
 * language. The rep has no persona of its own, so the scenario id picks a
 * stable voice, alternating between women and men. One voice stays for the
 * whole call, even if the user switches language mid-call, the same person
 * code-switching sounds natural, a new voice would not.
 */
export function voiceFor(scenario: Scenario) {
  if (scenario.agentRole === 'lead') {
    return pickVoice(
      scenario.lead.gender,
      scenario.lead.name,
      scenario.language,
    );
  }
  const gender = scenario.id.charCodeAt(0) % 2 === 0 ? 'female' : 'male';
  return pickVoice(gender, scenario.id, scenario.language);
}
