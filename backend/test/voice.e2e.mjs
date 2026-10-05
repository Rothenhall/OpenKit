// End to end test of the voice protocol, with a fake Sarvam so it costs nothing.
//   npm run test:e2e        (builds first, then runs against dist)
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { SarvamService } from '../dist/common/sarvam/sarvam.service.js';
import { CallService } from '../dist/tools/leads/call/call.service.js';
import { toScenario } from '../dist/tools/leads/scenarios/scenarios.service.js';
import { normaliseProfile } from '../dist/tools/leads/profile/profile.service.js';
import { SessionStore } from '../dist/tools/leads/session/session.store.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SENTENCES = ['Okay, go ahead.', 'I have about two minutes.', 'What is this about?'];

const fakeSarvam = {
  async *chatStream(_messages, _options, signal) {
    for (const sentence of SENTENCES) {
      await sleep(40);
      if (signal?.aborted) return;
      yield `${sentence} `;
    }
  },
  chat: async () => 'Hello, Meera Rao speaking. Who is this?',
  transcribe: async () => ({ text: 'Hi, this is Sam from Acme.', language: 'en-IN' }),
  synthesize: async (text) => Buffer.from(`WAV:${text}`).toString('base64'),
};

let app, url, store, callId, call;

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SarvamService)
    .useValue(fakeSarvam)
    .compile();
  app = module.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  url = (await app.getUrl()).replace('[::1]', 'localhost');
  store = app.get(SessionStore, { strict: false });
  const profile = normaliseProfile({ name: 'Acme', oneLiner: 'Anvils', offerings: ['Anvils'] }, '');
  const scenario = toScenario(
    { lead: { name: 'Meera Rao', gender: 'female' }, goal: 'Book a demo' },
    'lead',
    'en-IN',
    false,
  );
  call = await app.get(CallService, { strict: false }).start(profile, scenario, 'en-IN');
  store.addCall(store.create('acme.com', profile, [scenario]), call);
  callId = call.id;
});

after(async () => app?.close());

/** Opens the voice socket and collects every event, with a waiter for the next match. */
async function connect(id = callId, headers = {}) {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/tools/leads/voice?callId=${id}`, { headers });
  const events = [];
  const waiting = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    events.push(message);
    for (const w of waiting.splice(0)) w();
  });
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const until = async (test, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = events.find(test);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out, saw ${events.map((e) => e.event)}`);
      await new Promise((resolve) => {
        waiting.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  };
  const send = (event, data = {}) => ws.send(JSON.stringify({ event, data }));
  return { ws, events, until, send, closed };
}

describe('voice protocol', () => {
  it('answers the health probe', async () => {
    const body = await (await fetch(`${url}/health`)).json();
    assert.equal(body.ok, true);
  });

  it('opens with ready and a spoken greeting', async () => {
    const c = await connect();
    await c.until((e) => e.event === 'ready');
    const greeting = await c.until((e) => e.event === 'agent');
    assert.match(greeting.data.text, /Meera Rao/);
    assert.ok(greeting.data.audio, 'greeting carries audio');
    c.ws.close();
  });

  it('streams a reply sentence by sentence, in order, then closes the turn', async () => {
    const c = await connect();
    await c.until((e) => e.event === 'agent');
    c.send('text', { text: 'Hello, is this Meera?' });
    const done = await c.until((e) => e.event === 'agent' && e.data.streamed);
    const chunks = c.events.filter((e) => e.event === 'agent_chunk').map((e) => e.data);
    assert.deepEqual(chunks.map((x) => x.seq), [0, 1, 2]);
    assert.ok(chunks.every((x) => x.audio), 'every clip has audio');
    assert.equal(done.data.text, SENTENCES.join(' '));
    c.ws.close();
  });

  it('transcribes audio, then replies', async () => {
    const c = await connect();
    await c.until((e) => e.event === 'agent');
    c.send('audio', { audio: Buffer.alloc(4000).toString('base64'), mime: 'audio/wav' });
    const heard = await c.until((e) => e.event === 'heard');
    assert.equal(heard.data.text, 'Hi, this is Sam from Acme.');
    await c.until((e) => e.event === 'agent' && e.data.streamed);
    c.ws.close();
  });

  it('stops on interrupt and keeps only what was heard', async () => {
    const c = await connect();
    await c.until((e) => e.event === 'agent');
    const before = call.turns.length;
    c.send('text', { text: 'Tell me more.' });
    await c.until((e) => e.event === 'agent_chunk');
    c.send('interrupt', { playedSeq: 0 });
    await sleep(400);
    assert.equal(
      c.events.some((e) => e.event === 'agent' && e.data.streamed && e.data.text === SENTENCES.join(' ')),
      false,
      'the interrupted reply never closes as complete',
    );
    const last = call.turns.at(-1);
    assert.equal(last.speaker, 'agent');
    assert.equal(last.text, SENTENCES[0], 'history keeps only the sentence that played');
    assert.ok(call.turns.length > before);
    c.ws.close();
  });

  it('refuses a browser origin that is not allowed', async () => {
    const c = await connect(callId, { Origin: 'https://evil.example' });
    const error = await c.until((e) => e.event === 'error');
    assert.match(error.data.message, /cannot start a call/);
    assert.equal(await c.closed, 1008);
  });

  it('rejects an unknown call', async () => {
    const c = await connect('nope');
    const error = await c.until((e) => e.event === 'error');
    assert.match(error.data.message, /not found/);
  });
});
