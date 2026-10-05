# Leads

A voice-first sales call tool. Paste a website and Leads reads it, builds a company profile, and proposes 3 to 5 realistic call scenarios in each of two modes:

- **Agent is the rep** (`agentRole: "rep"`): the AI calls as that company's representative. The user plays the lead.
- **Agent is the lead** (`agentRole: "lead"`): the AI plays a realistic prospect. The user plays the rep and practises closing.

Users can also add their own scenario from a plain sentence. Every call ends with a scorecard on how the rep did.

## Funnel step

- **Who it attracts:** founders and sales or revenue leaders at growing companies who want to see and sharpen their outbound pitch.
- **Next step:** a Rothenhall conversation about go-to-market and revenue operations, where the same discipline is run for them.

## Status

Complete: site analysis, scenarios, streaming voice calls with barge in, scorecard, rate limits, and the Next.js front end in `frontend/`. No database. Sessions live in memory for an hour and are lost on restart, so run one instance.

Voice streams the reply. The client records one utterance (16 kHz WAV with a short pre-roll, so the first syllable is never clipped), the server transcribes it, and the chat model's tokens are cut into sentences. Each sentence goes to text to speech the moment it is complete, in parallel, and the clips are sent in order. The browser schedules them back to back, so the agent starts talking about when its first sentence is written, not after the whole answer. Barge in works end to end: the user talking over the agent stops playback at once and sends `interrupt`, which aborts the model and speech in flight. The greeting's speech starts when the call is created, so it is ready when the user taps Begin. A reply that comes back empty is retried once, then a spoken fallback line is used, and per turn STT, first audio and TTS timings log at debug level.

## Realtime roadmap

- **Sarvam realtime speech to text was tested and rejected for now.** Against this key it works and finalises about 250 to 750 ms after speech ends, but on a spoken test sentence it misheard names ("Rothon Hall") and ordinary words ("shop and buyers" for "show up when buyers"), where the REST transcription got both right. Its voice detection also split one thought into two turns at a normal pause. For a sales trainer, accuracy beats a faster guess. Revisit when the realtime model improves, or use it only for server side voice detection while keeping REST for the final text. The browser already sends 16 kHz PCM, so only the proxy would be missing.
- **Names are corrected after transcription.** The company and product names from the analysed site are matched against close mishearings and fixed (`common/sarvam/brand-terms.ts`).
- **Streaming TTS socket**: replace the per sentence REST calls with one Bulbul WebSocket per reply, to shave the per clip round trip.
- **Keep per turn REST** as the fallback path behind any of these.

## Try it from the terminal

```bash
npm run build && npm run start           # terminal 1, port from .env
npm run call -- rothenhall.com           # terminal 2, text call with a random lead
npm run call -- rothenhall.com te-IN --voice   # Telugu, lead replies are spoken
```

You play the rep. Type `/end` to hang up and get the scorecard.

## HTTP routes

| Route | Purpose |
| --- | --- |
| `POST /tools/leads/analyse` | `{ url, language? }`. Reads the site, returns `sessionId`, `profile`, `scenarios`. |
| `GET /tools/leads/sessions/:id` | Current profile and scenarios. |
| `PATCH /tools/leads/sessions/:id/profile` | `{ profile: {...}, regenerate? }`. Correct the profile, optionally regenerate scenarios. |
| `POST /tools/leads/sessions/:id/scenarios` | `{ agentRole, description, difficulty?, language? }`. Adds a custom scenario. |
| `POST /tools/leads/sessions/:id/calls` | `{ scenarioId?, agentRole?, language?, practiceMinutes? }`. Starts a call and the agent speaks first. Leave out `scenarioId` for a random scenario of `agentRole` (default `lead`). `practiceMinutes` is 1 to 10, default 5. The call ends at the limit. |
| `POST /tools/leads/calls/:id/turns` | `{ message }`. Text turn, returns the updated transcript. |
| `GET /tools/leads/calls/:id` | Transcript, voice and scorecard so far. |
| `POST /tools/leads/calls/:id/end` | Hang up and get the scorecard. |
| `GET /tools/leads/calls/:id/scorecard` | Scorecard, scored once and cached. |

Languages: `en-IN hi-IN bn-IN gu-IN kn-IN ml-IN mr-IN od-IN pa-IN ta-IN te-IN`.

## Voice over WebSocket

Connect to `ws://<host>/tools/leads/voice?callId=<id>` after starting a call. Messages are JSON `{ "event": string, "data": object }`.

| Direction | Event | Data |
| --- | --- | --- |
| server | `ready` | `{ callId, language }` |
| server | `agent` | `{ text, language, audio?, ended, streamed? }`. The greeting arrives here with `audio` (base64 WAV). After `agent_chunk` events it closes the turn with the full text and `streamed: true`. |
| server | `agent_chunk` | `{ seq, text, language, audio? }`. One spoken sentence of the reply. Play in `seq` order. |
| client | `interrupt` | The user talked over the agent. Aborts the reply in flight. |
| client | `audio` | `{ audio, mime }`. One finished utterance, base64. WAV, WebM, OGG and MP4 work. Max 2 MB. |
| server | `heard` | `{ text }`. What the audio was transcribed as. |
| server | `no_speech` | Nothing was heard, try again. |
| client | `text` | `{ text }`. A typed line. The agent still answers in voice. |
| client | `end` | Hang up. |
| server | `scorecard` | Sent after `end`, or when the agent ends the call. |
| server | `error` | `{ message }` |

Turns run one at a time per connection, in order. A new `audio`, `text` or `end`, or an `interrupt`, cancels the reply in flight, so the user can always cut in. `npm run latency` prints time to first audio for a few typed lines.

## How analysis works

Understand first, generate second. The pipeline fans out everything independent and keeps one small reasoning chain:

1. Safety check, robots.txt, then sitemap discovery and home page fetch in parallel.
2. Merged candidate pool, ranked by URL signals, top pages fetched in parallel. One slow page never stops the rest.
3. Near duplicate pages dropped by text hash.
4. Page evidence extracted in parallel, quotes required, extraction only.
5. One company understanding call over the evidence pack, with unknowns and unsupported claims separated from facts. Deterministic validation before anything continues.
6. One blueprint matrix per side for global diversity, then all scenarios written in parallel from blueprint plus relevant evidence only. Only failures are repaired, once each.
7. The company profile is mapped from the understanding and feeds the live prompts and scorecards.

Timings per phase log at debug level during analyse.

## Speech models

Speech to text is Saaras v4 in `codemix` mode, so Hindi and English in one sentence come back as one transcript, with the language auto-detected every turn. Text to speech is Bulbul v3 at natural speed with warm, expressive prosody (`pace` 1.0, `temperature` 0.6). Each call gets a built in speaker top-ranked for its language by Sarvam's pronunciation measurements, for example `neha` or `priya` for Telugu, `priya` or `shubh` for Hindi, `ishita` or `ratan` for Tamil. The voice stays the same for the whole call, even when the user switches language, the same person code-switching sounds natural. The spoken language follows each reply, so the agent can switch language mid call.

The site reader takes the home page plus 6 marketing pages, discovered through sitemap and home page links in parallel and ranked by URL signals, and the profile, scenarios, live prompts and scorecards all draw on that context. Live turns run on the conversational chat model for speed, while evidence, understanding, scenarios and scorecards run on the task model (`glm5.3` by default).

Scorecards come in two kinds. When the human is the rep, the card coaches them: overall summary, strengths, improvements, stronger lines for real moments, calling habits, and a final verdict. When the AI is the rep, the card rates the AI caller and lists what that kind of caller would do for a cold calling pipeline.

## Custom voices

Voices saved on the Sarvam platform, such as the cloned `kunal` (English) and `lokesh` (Telugu), can speak any supported language, since Sarvam clones across languages. Pick one by name:

- Per call: `POST /tools/leads/sessions/:id/calls` with `{ "voice": "kunal" }`, or `--speaker=kunal` in the terminal script.
- For every call: set `SARVAM_AGENT_VOICE=kunal`. A voice in the request wins over this.
- With neither, the agent gets a built in speaker top-ranked for the call's language (see `BEST_VOICES` in `src/common/sarvam/voices.ts`).

Names match saved voices first (ignoring case), then built in speakers such as `priya`. An unknown name returns 400. Saved voices are limited to 1000 characters per line and are a little slower than built in ones, about 2 seconds a line in testing.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `SARVAM_API_KEY` | yes | Sarvam API subscription key. |
| `SARVAM_CHAT_MODEL` | no | Chat model, default `sarvam-105b-conversations`. `sarvam-105b` reasons before answering and returned empty replies on long prompts. |
| `SARVAM_TASK_MODEL` | no | Offline task model for scenarios and scorecards via V2 chat, default `glm5.3`. Falls back to the chat model when the key lacks V2 access. |
| `SARVAM_AGENT_VOICE` | no | Default voice for the agent, a saved platform voice or built in speaker name, for example `kunal`. |
| `FRONTEND_ORIGIN` | no | Allowed CORS origin, default `http://localhost:3000`. |
| `PORT` | no | Server port, default 3000. |
| `RATE_LIMIT_DISABLED` | no | Set to `true` to switch rate limits off in development. |

## Rate limits (per client address)

Analyse 10 an hour. Start a call 20 an hour. Text turns 120 per 10 minutes. Voice turns 60 per call per 10 minutes. Scorecards 30 an hour. Custom scenarios and profile edits 20 an hour.

## Safety

The site fetcher only reads public http(s) addresses. It resolves the host and blocks loopback, private and link-local ranges on every redirect, follows robots.txt, and caps time, size and page count. Rep prompts forbid guarantees, invented numbers and claims about the lead's own business.

## Deploying and embedding

**Backend** (`backend/`). Copy `.env.example` to `.env` and fill in `SARVAM_API_KEY`. Set
`FRONTEND_ORIGIN` to the sites that may call it (comma separated, include the `www` form), and
`TRUST_PROXY=true` behind a reverse proxy or load balancer, otherwise every visitor shares the
proxy's address and one rate limit. `NODE_ENV=production` turns off the localhost allowance. A
`Dockerfile` is included. The proxy must pass WebSocket upgrades on `/tools/leads/voice` and keep
idle connections open for at least a minute (the server pings every 20 s). Run one instance:
sessions live in memory. `GET /health` is the liveness probe.

**Cost and abuse limits**, all environment variables with safe defaults:
`GLOBAL_CALLS_PER_HOUR` (300) and `GLOBAL_ANALYSES_PER_HOUR` (200) cap total Sarvam spend,
`MAX_LIVE_CALLS` (100) and `MAX_LIVE_CALLS_PER_IP` (3) cap concurrent voice sockets, and the
per address route limits in the controller still apply. The voice socket refuses browser
origins that are not allowed, and closes a call a minute after its practice time ends.

**Frontend** (`frontend/`). Set `NEXT_PUBLIC_BACKEND_URL` to the public API address, then
`npm run build && npm run start`. It answers with `frame-ancestors` for `EMBED_ORIGINS`
(default: rothenhall.com and www.rothenhall.com) and a `Permissions-Policy` that allows the
microphone.

**Embedding on the Rothenhall site.** Link to the tool, or put it in a frame. A frame must grant
the microphone, or the browser will refuse it:

```html
<iframe src="https://tools.rothenhall.com" allow="microphone" title="Sales Call Trainer"
        style="width:100%;height:760px;border:0"></iframe>
```

The page needs https, since browsers only allow the microphone on secure pages. On a browser
that cannot do live audio the Start button is disabled with a plain explanation.

**Funnel step.** This tool attracts sales and growth leaders who want to practise or see AI
calling. The next step is the follow-up form on the scorecard, which saves the visitor as a lead.

## Lead capture

The scorecard ends with a short form: name, work email, optional role and phone, and a consent
checkbox that must be ticked. `POST /tools/leads/calls/:id/lead` validates it and writes one row
to `lead_captures` in Postgres (Neon, `DATABASE_URL`). The table is created on first use.

- **The server reads the facts, not the form.** Company, site, mode, scenario, difficulty,
  language, outcome and average score come from the call itself, so a lead cannot be forged.
- **One row per call.** Submitting again for the same call updates it instead of duplicating.
- **Spam.** A hidden field drops bots quietly, and the route is rate limited per address.
- **Team alert.** Set `LEAD_WEBHOOK_URL` and every new lead is posted there (Slack incoming
  webhook format, plain JSON for Zapier or Make). A failing webhook never affects the visitor.
- **If the database is down** the form says it could not save and the visitor can retry. Nothing
  else in the tool depends on it.
- **Privacy.** The consent line links to the privacy policy: set `NEXT_PUBLIC_PRIVACY_URL` on the
  frontend, and publish that page before launch. Leads are personal data, so plan how a person
  asks to be removed (delete the row by email).

Read recent leads:

```sql
select created_at, name, email, role, company_name, outcome, avg_score
from lead_captures order by created_at desc limit 50;
```


## Testing

`npm run test` runs the unit tests. `npm run test:e2e` builds the app and runs the voice protocol
against a fake Sarvam: greeting, streamed sentences in order, audio turns, interrupt keeping only
what was heard, origin refusal. `npm run latency` measures the real thing.
