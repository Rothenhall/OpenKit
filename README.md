# Openkit

Free tools from [Rothenhall](https://rothenhall.com) that earn attention and bring traffic to us.
Each tool is genuinely useful on its own and ends in a natural next step toward a Rothenhall
conversation.

The first tool is the **Sales Call Trainer**. Paste your company website, get realistic buyer
scenarios built from the real offering, then take a live voice call. Either you sell and an AI
buyer pushes back, or the AI cold calls you. At the end you enter your email and the PDF report, with your scores and better lines, is emailed to you. The report is never shown on screen, so the email is the lead.
Voices and understanding run on [Sarvam](https://sarvam.ai), so it works in Indian languages and
in code-mixed speech such as Hindi and English in one sentence.

## How it is built

```
backend/    NestJS API and the live voice WebSocket. Port 4000.
frontend/   Next.js app (App Router, TypeScript, Tailwind). The call screen. Port 3000.
```

A call is a stream. The browser sends 16 kHz audio when you pause. The server transcribes it,
streams the model's reply, cuts it into sentences, speaks each sentence as soon as it is written,
and sends the clips back in order for gapless playback. Talking over the agent stops it at once
and keeps only what you actually heard. First reply audio arrives about a second after
transcription.

More detail lives in [`AGENTS.md`](AGENTS.md) (the map of the repo) and
[`backend/src/tools/leads/README.md`](backend/src/tools/leads/README.md) (the tool, its protocol,
deployment and lead capture).

## Run it locally

You need Node 22 or newer and a [Sarvam](https://dashboard.sarvam.ai) API key.

```bash
# API
cd backend
cp .env.example .env        # add SARVAM_API_KEY
npm install
npm run start:dev

# Web app, in a second terminal
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000, allow the microphone, and use headphones for the clearest call.
If your machine blocks port 3000 (some Windows setups do), run `npx next dev -p 3100`. In
development the API accepts any localhost port.

Lead capture and the emailed report need two things. A Postgres database: set `DATABASE_URL` in
`backend/.env` (we use [Neon](https://neon.com), tables are created on first use). And Gmail SMTP:
set `SMTP_USER` and `SMTP_PASSWORD` (a Google app password). Without them the tool still runs, and
the email form reports that it cannot send yet.

## Checks

```bash
cd backend
npm run lint && npm test    # unit tests
npm run test:e2e            # the voice protocol and lead capture, with a fake Sarvam, no API spend
npm run latency             # real Sarvam: time to first audio per turn (server must be running)

cd frontend
npm run lint && npm run build
```

CI runs all of this on every push and pull request.

## Deploy

Run the API as a single instance (sessions live in memory) behind a proxy that passes WebSocket
upgrades, with `TRUST_PROXY=true` and `FRONTEND_ORIGIN` set to your site. A `backend/Dockerfile`
is included. The web app is a normal Next.js deployment and can be embedded in an iframe on
rothenhall.com. Every environment variable, the cost and abuse limits, and the embed snippet are
documented in [`backend/src/tools/leads/README.md`](backend/src/tools/leads/README.md).

Secrets come from the environment and are never committed. `.env` files are ignored, and the
`.env.example` files list what to set.

## Adding a tool

One NestJS module per tool under `backend/src/tools/`, routes under `/tools/<name>`, shared
pieces in `backend/src/common/`. The recipe is in
[`backend/src/tools/README.md`](backend/src/tools/README.md).
