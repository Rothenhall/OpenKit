// Measures how fast the voice agent answers, end to end, without a browser.
//
//   npm run build && npm run start          (in one terminal)
//   node scripts/latency-check.mjs [url] [language]
//
// Starts a call, then sends a few typed lines and prints, for each one, the
// time to the first spoken clip and to the end of the reply. Typed lines skip
// speech to text, so add roughly 400 to 700 ms for that on a real call.
import WebSocket from 'ws';

try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const [url = 'rothenhall.com', language] = process.argv.slice(2);
const base = process.env.LEADS_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function api(path, body) {
  const response = await fetch(`${base}/tools/leads${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.message ?? `HTTP ${response.status}`);
  return json;
}

const session = await api('/analyse', { url, ...(language && { language }) });
const call = await api(`/sessions/${session.sessionId}/calls`, {
  agentRole: 'lead',
  ...(language && { language }),
});

const socket = new WebSocket(
  `${base.replace(/^http/, 'ws')}/tools/leads/voice?callId=${call.callId}`,
);
const inbox = [];
let wake;
socket.on('message', (raw) => {
  inbox.push(JSON.parse(raw));
  wake?.();
});
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});

async function until(done) {
  const seen = [];
  for (;;) {
    while (inbox.length) {
      const message = inbox.shift();
      seen.push({ ...message, at: Date.now() });
      if (done(message)) return seen;
    }
    await new Promise((resolve) => (wake = resolve));
  }
}

const t0 = Date.now();
const greeting = await until((m) => m.event === 'agent' || m.event === 'error');
console.log(`greeting ready ${Date.now() - t0}ms after connect: "${greeting.at(-1).data.text}"`);

const lines = [
  'Hi, this is Sam from Rothenhall. Do you have two minutes?',
  'We help companies show up when buyers ask AI tools for recommendations. How are you handling that today?',
  'Fair enough. Could we do a short call on Friday at eleven to look at your numbers?',
];
for (const line of lines) {
  const sent = Date.now();
  socket.send(JSON.stringify({ event: 'text', data: { text: line } }));
  const got = await until((m) => ['agent', 'error'].includes(m.event));
  const chunks = got.filter((m) => m.event === 'agent_chunk');
  const first = chunks[0];
  console.log(
    `\nyou: ${line}\n  first audio  ${first ? first.at - sent : '-'}ms\n  reply done   ${got.at(-1).at - sent}ms (${chunks.length} clips)`,
  );
  for (const c of chunks) console.log(`  [${c.data.audio ? 'audio' : 'NO AUDIO'}] ${c.data.text}`);
  if (got.at(-1).event === 'error') console.log(`  ! ${got.at(-1).data.message}`);
}

// Barge in: start a reply, cut it off, check that no more clips arrive.
socket.send(JSON.stringify({ event: 'text', data: { text: 'Tell me more about how it works.' } }));
await until((m) => m.event === 'agent_chunk');
socket.send(JSON.stringify({ event: 'interrupt', data: {} }));
await new Promise((resolve) => setTimeout(resolve, 2500));
const late = inbox.filter((m) => m.event === 'agent_chunk').length;
console.log(`\nbarge in: ${late} clips after interrupt (a few in flight is fine, then silence)`);
socket.close();
