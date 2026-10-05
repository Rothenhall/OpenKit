// End to end test of the email gate over HTTP, with a fake database, fake mail and fake Sarvam.
//   npm run test:e2e
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { DbService } from '../dist/common/db/db.service.js';
import { MailService } from '../dist/common/mail/mail.service.js';
import { SarvamService } from '../dist/common/sarvam/sarvam.service.js';
import { CallService } from '../dist/tools/leads/call/call.service.js';
import { normaliseProfile } from '../dist/tools/leads/profile/profile.service.js';
import { toScenario } from '../dist/tools/leads/scenarios/scenarios.service.js';
import { SessionStore } from '../dist/tools/leads/session/session.store.js';

const queries = [];
const fakeDb = {
  enabled: true,
  query: async (text, params = []) => {
    queries.push({ text, params });
    return { rows: [], rowCount: 1 };
  },
};
const sent = [];
const fakeMail = {
  enabled: true,
  send: async (mail) => void sent.push(mail),
};
const fakeSarvam = { chat: async () => 'Hello, Meera Rao speaking.' };

let app, url, callId;

before(async () => {
  process.env.RATE_LIMIT_DISABLED = 'true';
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SarvamService)
    .useValue(fakeSarvam)
    .overrideProvider(DbService)
    .useValue(fakeDb)
    .overrideProvider(MailService)
    .useValue(fakeMail)
    .compile();
  app = module.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  url = (await app.getUrl()).replace('[::1]', 'localhost');
  const store = app.get(SessionStore, { strict: false });
  const profile = normaliseProfile({ name: 'Acme', oneLiner: 'Anvils', offerings: ['Anvils'] }, '');
  const scenario = toScenario({ title: 'Founder doubts', lead: { name: 'Meera Rao' }, goal: 'Book a demo' }, 'lead', 'en-IN', false);
  const call = await app.get(CallService, { strict: false }).start(profile, scenario, 'en-IN');
  call.turns.push({ speaker: 'user', text: 'Hi, this is Sam.' });
  call.scorecard = {
    outcome: 'next_step_agreed',
    summary: 'Good call.',
    dimensions: [
      { name: 'Opening', score: 4, note: 'Clear.' },
      { name: 'Discovery', score: 3, note: 'Ok.' },
      { name: 'Objection handling', score: 5, note: 'Calm.' },
      { name: 'Close', score: 4, note: 'Asked.' },
    ],
    strengths: ['Clear'],
    improvements: ['More questions'],
    betterMoves: [],
    coaching: [],
    benefits: [],
    verdict: 'Strong.',
  };
  store.addCall(store.create('acme.com', profile, [scenario]), call);
  callId = call.id;
});

after(async () => app?.close());

const post = (id, path, body) =>
  fetch(`${url}/tools/leads/calls/${id}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('email gate', () => {
  it('emails the PDF report, reading the company, outcome and score from the call itself', async () => {
    queries.length = 0;
    const res = await post(callId, 'report', {
      email: 'Priya@Example.com',
      phone: '+91 98765 43210',
      outcome: 'forged',
      avgScore: 5,
      company: 'Forged Inc',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, alreadySent: false });

    assert.equal(sent.length, 1, 'one email was sent');
    assert.equal(sent[0].to, 'priya@example.com');
    assert.match(sent[0].subject, /Acme/);
    const pdf = sent[0].attachments[0];
    assert.equal(pdf.contentType, 'application/pdf');
    assert.equal(pdf.content.subarray(0, 5).toString(), '%PDF-');

    const create = queries.findIndex((q) => q.text.includes('create table if not exists lead_captures'));
    const insert = queries.find((q) => q.text.includes('insert into lead_captures'));
    assert.ok(insert, 'saved the lead');
    assert.ok(create >= 0 && create < queries.indexOf(insert), 'the table is created before the first insert');
    const p = insert.params;
    assert.equal(p[1], 'priya@example.com');
    assert.equal(p[2], '+91 98765 43210');
    assert.equal(p[3], 'Acme', 'company comes from the analysed site');
    assert.equal(p[9], 'next_step_agreed', 'outcome comes from the scorecard, not the form');
    assert.equal(p[10], 4, 'score is the average of the four dimensions');
  });

  it('refuses a bad email or an unknown call', async () => {
    assert.equal((await post(callId, 'report', { email: 'nope' })).status, 400);
    assert.equal((await post(callId, 'report', {})).status, 400);
    assert.equal((await post('missing', 'report', { email: 'a@b.co' })).status, 404);
  });

  it('accepts a bot quietly and sends nothing', async () => {
    sent.length = 0;
    queries.length = 0;
    const res = await post(callId, 'report', { website: 'http://spam.example' });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 0);
    assert.equal(queries.length, 0);
  });
});

describe('the report never reaches the browser', () => {
  it('leaves the scorecard out of the call view', async () => {
    const view = await (await fetch(`${url}/tools/leads/calls/${callId}`)).json();
    assert.equal('scorecard' in view, false);
  });

  it('has no route that returns a scorecard', async () => {
    assert.equal((await fetch(`${url}/tools/leads/calls/${callId}/scorecard`)).status, 404);
  });

  it('hangs up without handing back the scorecard', async () => {
    const res = await post(callId, 'end', {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ended: true });
  });
});
