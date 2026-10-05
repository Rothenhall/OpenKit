// End to end test of lead capture over HTTP, with a fake database and fake Sarvam.
//   npm run test:e2e
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { DbService } from '../dist/common/db/db.service.js';
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
const fakeSarvam = { chat: async () => 'Hello, Meera Rao speaking.' };

let app, url, callId;

before(async () => {
  process.env.RATE_LIMIT_DISABLED = 'true';
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SarvamService)
    .useValue(fakeSarvam)
    .overrideProvider(DbService)
    .useValue(fakeDb)
    .compile();
  app = module.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  url = (await app.getUrl()).replace('[::1]', 'localhost');
  const store = app.get(SessionStore, { strict: false });
  const profile = normaliseProfile({ name: 'Acme', oneLiner: 'Anvils', offerings: ['Anvils'] }, '');
  const scenario = toScenario({ title: 'Founder doubts', lead: { name: 'Meera Rao' }, goal: 'Book a demo' }, 'lead', 'en-IN', false);
  const call = await app.get(CallService, { strict: false }).start(profile, scenario, 'en-IN');
  call.scorecard = {
    outcome: 'next_step_agreed',
    dimensions: [
      { name: 'Opening', score: 4, note: '' },
      { name: 'Discovery', score: 3, note: '' },
      { name: 'Objection handling', score: 5, note: '' },
      { name: 'Close', score: 4, note: '' },
    ],
  };
  store.addCall(store.create('acme.com', profile, [scenario]), call);
  callId = call.id;
});

after(async () => app?.close());

const post = (id, body) =>
  fetch(`${url}/tools/leads/calls/${id}/lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('lead capture', () => {
  const good = { name: 'Priya Nair', email: 'Priya@Example.com', role: 'VP Sales', consent: true };

  it('saves a lead, reading the company, outcome and score from the call itself', async () => {
    queries.length = 0;
    const res = await post(callId, { ...good, outcome: 'forged', avgScore: 5, company: 'Forged Inc' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const insert = queries.find((q) => q.text.includes('insert into lead_captures'));
    assert.ok(insert, 'inserted a row');
    const create = queries.findIndex((q) => q.text.includes('create table if not exists lead_captures'));
    assert.ok(create >= 0 && create < queries.indexOf(insert), 'the table is created before the first insert');
    const p = insert.params;
    assert.equal(p[0], callId);
    assert.equal(p[2], 'priya@example.com');
    assert.equal(p[5], 'Acme', 'company comes from the analysed site');
    assert.equal(p[11], 'next_step_agreed', 'outcome comes from the scorecard, not the form');
    assert.equal(p[12], 4, 'score is the average of the four dimensions');
  });

  it('refuses without consent, a bad email, or an unknown call', async () => {
    assert.equal((await post(callId, { ...good, consent: false })).status, 400);
    assert.equal((await post(callId, { ...good, email: 'nope' })).status, 400);
    assert.equal((await post('missing', good)).status, 404);
  });

  it('accepts a bot quietly and saves nothing', async () => {
    queries.length = 0;
    const res = await post(callId, { website: 'http://spam.example' });
    assert.equal(res.status, 200);
    assert.equal(queries.length, 0);
  });
});
