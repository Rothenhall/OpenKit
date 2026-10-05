import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SarvamAIClient } from 'sarvamai';
import { extractJson, stripReasoning } from './json.js';
import { isLanguageCode, type LanguageCode } from './languages.js';
import { isBuiltInVoice, isCustomVoice, type VoiceId } from './voices.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the API to guarantee a JSON object reply. */
  json?: boolean;
}

type Model = 'sarvam-105b' | 'sarvam-105b-conversations';

/** Open weight model for offline tasks (scenarios, scorecards) via V2. */
type TaskModel = 'glm5.3' | 'gemma4' | 'deepseekv4-flash' | 'sarvam-105b';

const DEFAULT_TASK_MODEL: TaskModel = 'glm5.3';

/**
 * Cleans model text before speech synthesis. Bulbul misreads markdown,
 * symbols and ungrouped long numbers, so strip the formatting and group
 * digits the way people speak them (10000 becomes 10,000).
 */
export function normalizeForSpeech(text: string): string {
  const grouped = text.replace(/\d{5,}/g, (digits) =>
    digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','),
  );
  return grouped
    .replace(/[*_#>`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The conversations variant answers in about a second and does not spend
 * tokens on hidden reasoning. `sarvam-105b` reasons first, and that counts
 * against max_tokens, so long prompts came back empty.
 */
const DEFAULT_MODEL: Model = 'sarvam-105b-conversations';

@Injectable()
export class SarvamService {
  private readonly logger = new Logger(SarvamService.name);
  private client?: SarvamAIClient;

  private get sarvam(): SarvamAIClient {
    const apiSubscriptionKey = process.env.SARVAM_API_KEY;
    if (!apiSubscriptionKey) {
      throw new ServiceUnavailableException('SARVAM_API_KEY is not set');
    }
    this.client ??= new SarvamAIClient({ apiSubscriptionKey });
    return this.client;
  }

  /** Returns the model's reply as plain text. */
  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<string> {
    const model = (process.env.SARVAM_CHAT_MODEL ?? DEFAULT_MODEL) as Model;
    try {
      const response = await this.sarvam.chat.completions({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens ?? 3000,
        response_format: options.json ? { type: 'json_object' } : undefined,
      });
      return stripReasoning(response.choices[0]?.message?.content ?? '');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 401 || status === 403) {
        throw new ServiceUnavailableException('Sarvam rejected the API key');
      }
      throw new BadGatewayException('Sarvam chat request failed');
    }
  }

  /**
   * Streams the model's reply as text pieces, so speech can start on the
   * first sentence instead of waiting for the whole answer. Hidden reasoning
   * blocks are removed. Stops quietly when `signal` aborts.
   */
  async *chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const model = (process.env.SARVAM_CHAT_MODEL ?? DEFAULT_MODEL) as Model;
    let stream: AsyncIterable<{
      choices: { delta?: { content?: string | null } }[];
    }>;
    try {
      stream = await this.sarvam.chat.completions(
        {
          model,
          messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens ?? 3000,
          stream: true,
        },
        { abortSignal: signal, maxRetries: 1, timeoutInSeconds: 20 },
      );
    } catch (error) {
      if (signal?.aborted) return;
      throw this.toHttpError(error, 'Sarvam chat request failed');
    }
    let inThink = false;
    let hold = '';
    try {
      for await (const chunk of stream) {
        if (signal?.aborted) return;
        let piece = hold + (chunk.choices[0]?.delta?.content ?? '');
        hold = '';
        if (!piece) continue;
        for (;;) {
          if (inThink) {
            const end = piece.indexOf('</think>');
            if (end === -1) {
              piece = '';
              break;
            }
            piece = piece.slice(end + 8);
            inThink = false;
          }
          const start = piece.indexOf('<think>');
          if (start === -1) break;
          const before = piece.slice(0, start);
          const after = piece.slice(start + 7);
          inThink = true;
          piece = after;
          if (before) yield before;
        }
        // A "<" near the end might be the start of a tag split across pieces.
        const lt = piece.lastIndexOf('<');
        if (lt !== -1 && piece.length - lt < 8 && '<think>'.startsWith(piece.slice(lt, lt + 7))) {
          hold = piece.slice(lt);
          piece = piece.slice(0, lt);
        }
        if (piece) yield piece;
      }
      if (hold && !inThink) yield hold;
    } catch (error) {
      if (signal?.aborted) return;
      throw this.toHttpError(error, 'Sarvam chat stream failed');
    }
  }

  /**
   * Offline task model (scenarios, scorecards) via `POST /v2/chat/completions`.
   * The installed SDK has no V2 client, so this calls REST directly, the same
   * way the cloned voice endpoint is hand rolled below. Model comes from
   * `SARVAM_TASK_MODEL`, default `glm5.3`. Live turns stay on the
   * conversational model through `chat()`, which answers faster.
   */
  async chatTask(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<string> {
    const model = (process.env.SARVAM_TASK_MODEL ??
      DEFAULT_TASK_MODEL) as TaskModel;
    try {
      const response = await this.rest('/v2/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens ?? 3000,
          response_format: options.json ? { type: 'json_object' } : undefined,
        }),
      });
      const body = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
      };
      return stripReasoning(body.choices?.[0]?.message?.content ?? '');
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 400 || status === 403) {
        // V2 needs per key whitelisting. Fall back to the V1 chat model
        // instead of failing the tool when access is missing.
        this.logger.warn(
          `Task model ${model} unavailable (HTTP ${status}), falling back to chat model`,
        );
        return this.chat(messages, options);
      }
      throw this.toHttpError(error, 'Sarvam task request failed');
    }
  }

  /**
   * Speech to text. Returns the transcript and the language Sarvam heard.
   * `language` is a hint. Pass `unknown` to let Sarvam detect it, including
   * code-mixed speech. Uses Saaras v4 with codemix mode, so Telugu+English
   * comes back as Telugu in Telugu script and English in English.
   */
  async transcribe(
    audio: Buffer,
    mime: string,
    language: LanguageCode | 'unknown' = 'unknown',
  ): Promise<{ text: string; language?: LanguageCode }> {
    try {
      const extension = mime.includes('webm')
        ? 'webm'
        : mime.includes('ogg')
          ? 'ogg'
          : mime.includes('mp4')
            ? 'm4a'
            : 'wav';
      const response = await this.sarvam.speechToText.transcribe(
        {
        // Browsers report "audio/webm;codecs=opus". Sarvam rejects any
        // parameters with a 400, so send the bare type.
        file: new File([new Uint8Array(audio)], `speech.${extension}`, {
          type: mime.split(';')[0].trim(),
        }),
          model: 'saaras:v4',
          mode: 'codemix',
          language_code: language,
        },
        { maxRetries: 1, timeoutInSeconds: 15 },
      );
      const heard = response.language_code;
      return {
        text: response.transcript?.trim() ?? '',
        language: isLanguageCode(heard) ? heard : undefined,
      };
    } catch (error) {
      const { statusCode, body } = error as {
        statusCode?: number;
        body?: unknown;
      };
      this.logger.error(
        `Speech to text failed (HTTP ${statusCode ?? '?'}, mime ${mime}): ${JSON.stringify(body) ?? (error as Error).message}`,
      );
      throw this.toHttpError(error, 'Sarvam speech to text failed');
    }
  }

  /** Text to speech. Returns a base64 encoded WAV. */
  async synthesize(
    text: string,
    language: LanguageCode,
    voice: VoiceId,
    signal?: AbortSignal,
  ): Promise<string> {
    const spoken = normalizeForSpeech(text);
    try {
      if (isCustomVoice(voice))
        return await this.synthesizeCloned(spoken, language, voice, signal);
      const response = await this.sarvam.textToSpeech.convert(
        {
          text: spoken.slice(0, 2500),
          language_code: language,
          speaker: voice,
          model: 'bulbul:v3',
          speech_sample_rate: 24000,
          // Sarvam's guidance for agents: let the model normalise digits,
          // abbreviations and English words inside Indic sentences.
          enable_preprocessing: true,
          // Sarvam's conversational agent preset. Natural speed with warm,
          // expressive prosody, so the agent sounds like a person on a call.
          pace: 1.0,
          temperature: 0.6,
        },
        { abortSignal: signal, maxRetries: 1, timeoutInSeconds: 15 },
      );
      const audio = response.audios?.[0];
      if (!audio) throw new Error('empty audio');
      return audio;
    } catch (error) {
      throw this.toHttpError(error, 'Sarvam text to speech failed');
    }
  }

  /**
   * Speaks with a voice saved on the Sarvam platform. The SDK does not cover
   * this endpoint yet. It takes form fields, and text is capped at 1000 chars.
   */
  private async synthesizeCloned(
    text: string,
    language: LanguageCode,
    voiceId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.set('voice_id', voiceId);
    form.set('text', text.slice(0, 1000));
    form.set('language_code', language);
    const response = await this.rest('/voices/clone', {
      method: 'POST',
      body: form,
      signal,
    });
    const audio = (await response.json()).audio;
    if (typeof audio !== 'string' || !audio) throw new Error('empty audio');
    return audio;
  }

  /**
   * Turns a voice name such as "kunal" into something `synthesize` accepts.
   * Saved platform voices are matched by name, ignoring case, then the built in speakers.
   */
  async resolveVoice(name: string): Promise<VoiceId> {
    const wanted = name.trim().toLowerCase();
    if (isCustomVoice(wanted)) return wanted;
    const saved = (await this.savedVoices()).find(
      (v) => v.name.toLowerCase() === wanted,
    );
    if (saved) return saved.id;
    if (isBuiltInVoice(wanted)) return wanted;
    throw new BadRequestException(`No voice called "${name}" was found`);
  }

  private savedCache?: { at: number; voices: { id: VoiceId; name: string }[] };

  private async savedVoices(): Promise<{ id: VoiceId; name: string }[]> {
    if (this.savedCache && Date.now() - this.savedCache.at < 10 * 60_000) {
      return this.savedCache.voices;
    }
    try {
      const body = await (await this.rest('/voices')).json();
      const voices = (body?.data?.voices ?? [])
        .filter((v: { status?: string }) => v.status === 'active')
        .map((v: { id: VoiceId; name: string }) => ({
          id: v.id,
          name: v.name,
        }));
      this.savedCache = { at: Date.now(), voices };
      return voices;
    } catch (error) {
      throw this.toHttpError(
        error,
        'Could not load the saved voices from Sarvam',
      );
    }
  }

  private async rest(path: string, init: RequestInit = {}): Promise<Response> {
    const key = process.env.SARVAM_API_KEY;
    if (!key)
      throw new ServiceUnavailableException('SARVAM_API_KEY is not set');
    const response = await fetch(`https://api.sarvam.ai${path}`, {
      ...init,
      headers: {
        'api-subscription-key': key,
        ...((init.headers ?? {}) as Record<string, string>),
      },
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`Sarvam ${path} returned ${response.status}`),
        {
          statusCode: response.status,
        },
      );
    }
    return response;
  }

  private toHttpError(error: unknown, message: string): Error {
    if (error instanceof ServiceUnavailableException) return error;
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 401 || status === 403) {
      return new ServiceUnavailableException('Sarvam rejected the API key');
    }
    return new BadGatewayException(message);
  }

  /** Asks for a JSON object and parses it, retrying once on a malformed reply. */
  async chatJson<T>(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await this.chat(messages, {
        temperature: 0.4,
        ...options,
        json: true,
      });
      try {
        return extractJson<T>(reply);
      } catch {
        // retry once, then fall through to the error below
      }
    }
    throw new BadGatewayException(
      'Sarvam returned a reply that was not valid JSON',
    );
  }

  /** Same as `chatJson` but through the task model (`SARVAM_TASK_MODEL`). */
  async chatJsonTask<T>(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await this.chatTask(messages, {
        temperature: 0.4,
        ...options,
        json: true,
      });
      try {
        return extractJson<T>(reply);
      } catch {
        // retry once, then fall through to the error below
      }
    }
    throw new BadGatewayException(
      'Sarvam returned a reply that was not valid JSON',
    );
  }
}
