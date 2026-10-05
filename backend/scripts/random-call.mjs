// Practise a cold call from the terminal.
//
//   npm run build && npm run start          (in one terminal)
//   node scripts/random-call.mjs [url] [language] [--voice] [--speaker=kunal]
//
// --speaker picks the lead's voice by name: a saved platform voice such as
// kunal or lokesh, or a built in one such as priya. Without it, the server's
// SARVAM_AGENT_VOICE is used, then a voice that fits the persona.
//
// Example, a Telugu call with the agent speaking out loud:
//   node scripts/random-call.mjs rothenhall.com te-IN --voice
//
// A random lead is generated from the website. You play the rep. Type a line
// and press Enter. Type /end to hang up and get the scorecard. With --voice
// the lead's replies are spoken (Windows plays the WAV itself).
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import WebSocket from 'ws';

try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const args = process.argv.slice(2);
const voice = args.includes('--voice');
const [url = 'rothenhall.com', language] = args.filter((a) => !a.startsWith('--'));
const speaker = args.find((a) => a.startsWith('--speaker='))?.split('=')[1];
const base = process.env.LEADS_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function api(path, body, method = 'POST') {
  const response = await fetch(`${base}/tools/leads${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.message ?? `HTTP ${response.status}`);
  return json;
}

const say = (text) => console.log(`\n  \u001b[36m${text}\u001b[0m\n`);
const dir = voice ? mkdtempSync(join(tmpdir(), 'leads-')) : '';
let clip = 0;

function play(base64) {
  const file = join(dir, `${clip++}.wav`);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  if (process.platform !== 'win32') return console.log(`  (audio saved to ${file})`);
  return new Promise((resolve) =>
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`],
      () => resolve(),
    ),
  );
}

console.log(`Reading ${url} ...`);
const session = await api('/analyse', { url, ...(language && { language }) });
console.log(`Company: ${session.profile.name}. ${session.profile.oneLiner}`);

const call = await api(`/sessions/${session.sessionId}/calls`, {
  agentRole: 'lead',
  ...(language && { language }),
  ...(speaker && { voice: speaker }),
});
const { lead, goal } = call.scenario;
console.log(`\nYou are a rep from ${session.profile.name}.`);
console.log(`You are calling ${lead.name}, ${lead.jobTitle}.`);
console.log(`Your goal: ${goal}`);
console.log(`Language: ${call.language}. Type /end to hang up.\n`);
console.log('Ringing... they pick up:');

// Voice mode talks over the WebSocket. Text mode uses plain HTTP.
let socket;
const waiters = [];
if (voice) {
  socket = new WebSocket(`${base.replace(/^http/, 'ws')}/tools/leads/voice?callId=${call.callId}`);
  socket.on('message', (raw) => {
    const { event, data } = JSON.parse(raw);
    waiters.splice(0).forEach((w) => w({ event, data }));
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}
const next = (...events) =>
  new Promise((resolve) => {
    const listener = (message) =>
      events.includes(message.event) ? resolve(message) : waiters.push(listener);
    waiters.push(listener);
  });

// The agent's reply streams in as one clip per sentence. Play each clip as it
// lands, and finish when the closing `agent` event arrives. The greeting is a
// single `agent` event that carries its own audio.
async function heardAgent() {
  const sentAt = Date.now();
  let first = true;
  for (;;) {
    const { event, data } = await next('agent_chunk', 'agent', 'error');
    if (event === 'error') return console.log(`  ! ${data.message}`), undefined;
    if (event === 'agent_chunk') {
      if (first) console.log(`  (first audio after ${Date.now() - sentAt}ms)`);
      first = false;
      say(data.text);
      if (data.audio) await play(data.audio);
      continue;
    }
    if (!data.streamed) {
      say(data.text);
      if (data.audio) await play(data.audio);
    }
    return data;
  }
}

let ended = false;
if (voice) {
  await next('ready');
  ended = (await heardAgent())?.ended ?? false;
} else {
  say(call.turns.at(-1).text);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
let closed = false;
rl.on('close', () => (closed = true));
while (!ended && !closed) {
  let line;
  try {
    line = (await rl.question('you> ')).trim();
  } catch {
    break;
  }
  if (!line) continue;
  if (line === '/end') break;
  try {
    if (voice) {
      socket.send(JSON.stringify({ event: 'text', data: { text: line } }));
      const agent = await heardAgent();
      ended = agent?.ended ?? false;
      if (ended) await next('scorecard');
    } else {
      const current = await api(`/calls/${call.callId}/turns`, { message: line });
      say(current.turns.at(-1).text);
      ended = current.ended;
    }
  } catch (error) {
    console.log(`  ! ${error.message}`);
  }
}
rl.close();
socket?.close();

console.log(ended ? 'The call ended.\n' : 'You hung up.\n');
try {
  const card = await api(`/calls/${call.callId}/end`, {});
  console.log(`Outcome: ${card.outcome}`);
  console.log(card.summary, '\n');
  for (const d of card.dimensions) console.log(`  ${d.name.padEnd(20)} ${d.score}/5  ${d.note}`);
  console.log('\nWhat went well');
  card.strengths.forEach((s) => console.log(`  + ${s}`));
  console.log('Do next time');
  card.improvements.forEach((s) => console.log(`  - ${s}`));
} catch (error) {
  console.log(`No scorecard: ${error.message}`);
}
console.log(`\nWho they were: ${lead.name}, mood "${lead.mood}", ${call.scenario.difficulty}.`);
console.log(`Objections they had ready: ${lead.objections.join(' | ')}`);
