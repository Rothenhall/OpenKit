import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { clientIp, isOriginAllowed } from '../../../common/http/origins.js';
import { RateLimiter } from '../../../common/rate-limit/rate-limiter.js';
import { MINUTE } from '../../../common/rate-limit/rate-limit.guard.js';
import { LeadsService } from '../leads.service.js';
import type { Call } from '../leads.types.js';
import { VoiceService } from './voice.service.js';

/**
 * Live call over WebSocket. Connect to
 * `/tools/leads/voice?callId=<id>` and exchange JSON messages of the form
 * `{ "event": string, "data": object }`.
 *
 * Client to server:
 *   audio  { audio: base64, mime: "audio/webm" }  one finished utterance
 *   text   { text: string }                         typed line, agent still answers in voice
 *   end    {}                                       hang up
 *
 * Server to client:
 *   ready      { callId, language }
 *   agent      { text, language, audio?, ended }
 *   heard      { text }                             what the user's audio was transcribed as
 *   no_speech  {}                                   nothing was heard, try again
 *   call_complete {}                                  the call is over. The report is emailed, never sent here
 *   error      { message }
 */
/**
 * Live call over WebSocket. Connect to
 * `/tools/leads/voice?callId=<id>` and exchange JSON messages of the form
 * `{ "event": string, "data": object }`.
 *
 * Client to server:
 *   audio      { audio: base64, mime: "audio/wav" }  one finished utterance
 *   text       { text: string }                       typed line, agent still answers in voice
 *   interrupt  { playedSeq? }                         the user talked over the agent, stop it now.
 *                                                     playedSeq is the last clip that started playing,
 *                                                     so history keeps only what was actually heard.
 *   end        {}                                     hang up
 *
 * Server to client:
 *   ready        { callId, language }
 *   heard        { text, language }                   what the user's audio was transcribed as
 *   agent_chunk  { seq, text, language, audio? }      one spoken sentence, play in seq order
 *   agent        { text, language, ended, audio?, streamed? }
 *                                                     the full line. Carries audio only for the
 *                                                     greeting. After chunks it closes the turn.
 *   no_speech    {}                                   nothing was heard, try again
 *   call_complete {}                                  the call is over, ask for an email address
 *   error        { message }
 *
 * A new turn or an `interrupt` cancels the reply in flight, so the user can
 * always cut in. Turns run one at a time per connection, in arrival order.
 */
/** Live voice calls at once, across everyone, and per visitor address. */
const MAX_LIVE_CALLS = Number(process.env.MAX_LIVE_CALLS ?? 100);
const MAX_LIVE_CALLS_PER_IP = Number(process.env.MAX_LIVE_CALLS_PER_IP ?? 3);

@WebSocketGateway({ path: '/tools/leads/voice' })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly calls = new WeakMap<WebSocket, string>();
  private readonly inflight = new WeakMap<WebSocket, AbortController>();
  private readonly queue = new WeakMap<WebSocket, Promise<void>>();
  private readonly pings = new WeakMap<WebSocket, ReturnType<typeof setInterval>>();
  private readonly deadlines = new WeakMap<WebSocket, ReturnType<typeof setTimeout>>();
  private readonly counted = new WeakMap<WebSocket, string>();
  private readonly perIp = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly voice: VoiceService,
    private readonly leads: LeadsService,
    private readonly limiter: RateLimiter,
  ) {}

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const callId = new URL(
      request.url ?? '',
      'http://localhost',
    ).searchParams.get('callId');
    // Only the Rothenhall site, or a script with no Origin, may open a call.
    if (!isOriginAllowed(request.headers.origin)) {
      this.send(client, 'error', { message: 'This site cannot start a call.' });
      client.close(1008, 'origin not allowed');
      return;
    }
    let call: Call;
    try {
      call = await this.leads.getCall(callId ?? '');
    } catch {
      this.send(client, 'error', {
        message: 'That call was not found. Start a call first.',
      });
      client.close();
      return;
    }
    const ip = clientIp(request);
    if (
      this.total >= MAX_LIVE_CALLS ||
      (this.perIp.get(ip) ?? 0) >= MAX_LIVE_CALLS_PER_IP
    ) {
      this.send(client, 'error', {
        message: 'Lots of people are on calls right now. Try again in a minute.',
      });
      client.close(1013, 'busy');
      return;
    }
    this.counted.set(client, ip);
    this.total++;
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    // A call that outlives its practice time plus a short grace is abandoned.
    this.deadlines.set(
      client,
      setTimeout(
        () => client.close(1000, 'practice time is up'),
        Math.max(0, call.endsAt - Date.now()) + 60_000,
      ),
    );
    this.calls.set(client, callId as string);
    // Idle sockets get dropped by proxies and load balancers. A ping every
    // 20 seconds keeps the line open through quiet stretches of the call.
    this.pings.set(
      client,
      setInterval(() => {
        if (client.readyState === client.OPEN) client.ping();
      }, 20_000),
    );
    this.send(client, 'ready', { callId, language: call.language });
    // The greeting is only for the start of a call. A client that reconnects
    // mid call, for example when the server instance recycles, resumes quietly.
    if (call.turns.some((t) => t.speaker === 'user')) return;
    return this.run(client, async () => {
      this.send(client, 'agent', await this.voice.greeting(call));
    });
  }

  handleDisconnect(client: WebSocket) {
    clearInterval(this.pings.get(client));
    clearTimeout(this.deadlines.get(client));
    this.inflight.get(client)?.abort();
    const ip = this.counted.get(client);
    if (ip !== undefined) {
      this.counted.delete(client);
      this.total--;
      const left = (this.perIp.get(ip) ?? 1) - 1;
      if (left <= 0) this.perIp.delete(ip);
      else this.perIp.set(ip, left);
    }
  }

  @SubscribeMessage('audio')
  onAudio(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body: { audio?: string; mime?: string },
  ) {
    const received = Date.now();
    return this.turn(client, async (call, signal) => {
      const bytes = Buffer.from(body?.audio ?? '', 'base64');
      const { text, language } = await this.voice.hear(
        call,
        bytes,
        body?.mime ?? 'audio/webm',
      );
      if (!text) return void this.send(client, 'no_speech', {});
      this.send(client, 'heard', { text, language: language ?? call.language });
      if (signal.aborted) {
        // Superseded while transcribing. Keep the words so context is not lost.
        await this.leads.addUserTurn(call.id, text, language);
        await this.leads.saveCall(call.id);
        return;
      }
      await this.answer(client, call, text, language, signal, received);
    });
  }

  @SubscribeMessage('text')
  onText(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body: { text?: string },
  ) {
    return this.turn(client, (call, signal) =>
      this.answer(client, call, body?.text ?? '', undefined, signal),
    );
  }

  /** The user spoke over the agent. Stop generating and speaking right away. */
  @SubscribeMessage('interrupt')
  onInterrupt(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body?: { playedSeq?: number },
  ) {
    const seq = body?.playedSeq;
    // The abort reason tells the reply how much of it the user really heard.
    this.inflight
      .get(client)
      ?.abort({ keep: typeof seq === 'number' && seq >= -1 ? seq : undefined });
  }

  @SubscribeMessage('end')
  onEnd(@ConnectedSocket() client: WebSocket) {
    return this.turn(
      client,
      async (call) => {
        this.send(client, 'call_complete', {});
        await this.leads.finish(call.id);
      },
      false,
    );
  }

  private async answer(
    client: WebSocket,
    call: Call,
    text: string,
    language: Call['language'] | undefined,
    signal: AbortSignal,
    heardAt?: number,
  ) {
    await this.voice.streamReply(
      call,
      text,
      language,
      signal,
      (event, data) => this.send(client, event, data),
      heardAt,
    );
    if (call.ended && !signal.aborted) {
      // Tell the page first, scoring runs in the background.
      this.send(client, 'call_complete', {});
      await this.leads.finish(call.id);
    }
  }

  /** One turn: rate limited, cancels whatever the agent was doing, then runs in order. */
  private turn(
    client: WebSocket,
    work: (call: Call, signal: AbortSignal) => Promise<void>,
    limited = true,
  ) {
    const callId = this.calls.get(client);
    const controller = this.supersede(client);
    return this.run(client, async () => {
      if (!callId) throw new Error('No call is attached to this connection');
      if (limited) this.limiter.hit(`voice:${callId}`, 90, 10 * MINUTE);
      await work(await this.leads.getCall(callId), controller.signal);
    });
  }

  /** Cancels the reply in flight and hands back a fresh signal for the next turn. */
  private supersede(client: WebSocket): AbortController {
    this.inflight.get(client)?.abort();
    const controller = new AbortController();
    this.inflight.set(client, controller);
    return controller;
  }

  private run(client: WebSocket, work: () => Promise<void>): Promise<void> {
    const previous = this.queue.get(client) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        await work();
      } catch (error) {
        const message =
          (error as { message?: string }).message ?? 'Something went wrong';
        this.logger.warn(message);
        this.send(client, 'error', { message });
      }
    });
    this.queue.set(client, next);
    return next;
  }

  private send(client: WebSocket, event: string, data: unknown) {
    if (client.readyState === client.OPEN)
      client.send(JSON.stringify({ event, data }));
  }
}
