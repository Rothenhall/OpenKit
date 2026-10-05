import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { correctBrandNames } from '../../../common/sarvam/brand-terms.js';
import { SarvamService } from '../../../common/sarvam/sarvam.service.js';
import {
  ttsLanguageFor,
  type LanguageCode,
} from '../../../common/sarvam/languages.js';
import type { Call } from '../leads.types.js';
import { LeadsService } from '../leads.service.js';

const MAX_AUDIO_BYTES = 2_000_000;
/** Anything shorter than this is a click or a breath, not speech. Saves a round trip. */
const MIN_AUDIO_BYTES = 1200;

export interface AgentSpeech {
  text: string;
  language: LanguageCode;
  /** Base64 WAV. Missing when text to speech failed, so the client can still show the text. */
  audio?: string;
  ended: boolean;
}

/** One spoken sentence of a streamed reply. Chunks play in `seq` order. */
export interface AgentChunk {
  seq: number;
  text: string;
  language: LanguageCode;
  audio?: string;
}

export type Emit = (event: string, data: unknown) => void;

/** Turns audio into a call turn and the agent's reply back into audio. */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly warm = new Map<string, Promise<AgentSpeech>>();

  constructor(
    private readonly sarvam: SarvamService,
    private readonly leads: LeadsService,
  ) {}

  /**
   * Starts the greeting's speech as soon as the call exists, so by the time
   * the user taps Begin the first line is already waiting.
   */
  warmGreeting(call: Call): void {
    const speech = this.speakLast(call);
    speech.catch(() => undefined);
    this.warm.set(call.id, speech);
    setTimeout(() => this.warm.delete(call.id), 5 * 60_000).unref();
  }

  /** The agent's opening line, spoken. Used when the client connects. */
  greeting(call: Call): Promise<AgentSpeech> {
    return this.warm.get(call.id) ?? this.speakLast(call);
  }

  /** Transcribes what the user said. Lets Sarvam detect the language, for any language and any mix. */
  async hear(
    call: Call,
    audio: Buffer,
    mime: string,
  ): Promise<{ text: string; language?: LanguageCode }> {
    if (audio.byteLength === 0)
      throw new BadRequestException('No audio received');
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw new BadRequestException(
        'That recording is too long. Keep each turn under a minute.',
      );
    }
    if (audio.byteLength < MIN_AUDIO_BYTES) return { text: '' };
    const started = Date.now();
    const raw = await this.sarvam.transcribe(audio, mime, 'unknown');
    const heard = {
      ...raw,
      text: correctBrandNames(raw.text, await this.leads.brandTerms(call.id)),
    };
    this.logger.debug(
      `call ${call.id} stt ${Date.now() - started}ms bytes=${audio.byteLength} lang=${heard.language ?? '?'} chars=${heard.text.length}`,
    );
    return heard;
  }

  /**
   * Streams the agent's reply. The model writes, each finished sentence goes
   * straight to text to speech, and every clip is sent the moment it is
   * ready, in order. First audio lands about when the first sentence is done,
   * not when the whole answer is. Aborting `signal` stops all of it.
   */
  async streamReply(
    call: Call,
    userText: string,
    detectedLanguage: LanguageCode | undefined,
    signal: AbortSignal,
    emit: Emit,
    heardAt = Date.now(),
  ): Promise<void> {
    await this.leads.addUserTurn(call.id, userText, detectedLanguage);
    await this.streamAgent(call, signal, emit, heardAt);
  }

  async streamAgent(
    call: Call,
    signal: AbortSignal,
    emit: Emit,
    startedAt = Date.now(),
  ): Promise<void> {
    let seq = 0;
    let tail: Promise<void> = Promise.resolve();
    let firstAudioLogged = false;
    const speak = (text: string) => {
      const index = seq++;
      const language = ttsLanguageFor(text, call.language);
      // Synthesis starts right away and runs in parallel across sentences.
      // Sending is chained, so clips always go out in order.
      const audio = this.sarvam
        .synthesize(text, language, call.voice, signal)
        .catch((error: Error) => {
          if (!signal.aborted)
            this.logger.warn(`Text to speech failed: ${error.message}`);
          return undefined;
        });
      tail = tail.then(async () => {
        const clip = await audio;
        if (signal.aborted) return;
        if (!firstAudioLogged) {
          firstAudioLogged = true;
          this.logger.debug(
            `call ${call.id} first audio ${Date.now() - startedAt}ms after the user stopped`,
          );
        }
        const chunk: AgentChunk = { seq: index, text, language, audio: clip };
        emit('agent_chunk', chunk);
      });
    };
    try {
      await this.leads.streamAgent(call.id, signal, speak);
    } finally {
      await tail;
    }
    if (signal.aborted) return;
    const text = call.turns.at(-1)?.text ?? '';
    emit('agent', {
      text,
      language: ttsLanguageFor(text, call.language),
      ended: call.ended,
      streamed: true,
    });
  }

  private async speakLast(
    call: Call,
    turnStarted = Date.now(),
  ): Promise<AgentSpeech> {
    const text = call.turns.at(-1)?.text ?? '';
    const language = ttsLanguageFor(text, call.language);
    const ttsStarted = Date.now();
    try {
      const audio = await this.sarvam.synthesize(text, language, call.voice);
      this.logger.debug(
        `call ${call.id} tts ${Date.now() - ttsStarted}ms turn ${Date.now() - turnStarted}ms`,
      );
      return { text, language, audio, ended: call.ended };
    } catch (error) {
      this.logger.warn(`Text to speech failed: ${(error as Error).message}`);
      return { text, language, ended: call.ended };
    }
  }
}
