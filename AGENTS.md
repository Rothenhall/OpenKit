# Openkit: context for agents and contributors

Read this first. It explains what Openkit is, who it serves, and how the code is organised.

## What Openkit is

Openkit is the backend for **Rothenhall's free tools**. Each tool is a small, useful thing
we give away to prospects and customers to earn attention and bring traffic to Rothenhall.
It is a lead-generation and goodwill surface, not a paid product.

The repo has the API (`backend/`) and one front end (`frontend/`, the Sales Call Trainer
that ships on the Rothenhall website). Other front ends (Cailyx, landing pages, partner
sites) can call the same API over HTTP and WebSocket.

## About Rothenhall (why these tools exist)

Rothenhall Partners is an India-first fractional operating partner for AI-era growth,
based in Bengaluru with an office in Edinburgh. Tagline: **Be the company the AI recommends.**

We make venture- and PE-backed companies the ones AI answer engines (ChatGPT, Perplexity,
Google AI Overviews) name, and we own the go-to-market and revenue operations behind that
demand as one accountable operator. Four disciplines: AI visibility (AEO/GEO), go-to-market,
revenue operations, growth operating.

Products in the wider family:

- **Millbrook**: rothenhall.com, our website and go-to-market engine.
- **Cailyx**: the AI visibility engine every engagement runs on (measurement, diagnosis, fixes).
- **Motion**: the social growth platform, in build.
- **Openkit** (this repo): free tools that feed the top of the funnel for all of the above.

A good Openkit tool is genuinely useful on its own, shows what Rothenhall can do, and gives
a natural next step toward a Rothenhall conversation. It should never feel like a locked
teaser.

## Brand and voice (applies to any copy, error text, or generated output)

- No em dashes. Commas, periods, short sentences.
- Lead with the point. Numbers and proof over adjectives.
- Do not use: rank, #1, dominate, guaranteed, unlock, unleash, game-changing, AI-native.
- Claims are about rates, never positions. Never promise placement in an AI answer.
- Names: Rothenhall (one word), Cailyx (no article), Bengaluru (not Bangalore).

## Vocabulary

- **Tool**: one self-contained free offering (for example the Sarvam AI agent). Each tool is
  one NestJS module under `src/tools/`. We call the folder `tools` on purpose: plain,
  searchable, and it matches how the tools are described to customers.
- **Common**: shared building blocks used by more than one tool (config, guards, logging,
  rate limiting, lead capture). Lives in `src/common/`.

## Repo layout

```
backend/     NestJS API (everything below), has its own package.json and .env
frontend/    Next.js app (App Router, TypeScript, Tailwind), calls the backend over HTTP
```

Backend runs on port 4000 (set in `backend/.env`), frontend on Next's default 3000.
Run all commands from inside the relevant folder.

## Structure (inside `backend/`)

```
src/
  main.ts                 entry point
  app.module.ts           root module, imports every tool module
  common/                 shared infrastructure, no tool-specific logic
  tools/
    README.md             the recipe for adding a tool
    <tool-name>/          one folder per tool, kebab-case
      <tool-name>.module.ts
      <tool-name>.controller.ts
      <tool-name>.service.ts
      dto/                request and response shapes, validated
      README.md           what the tool does, inputs, outputs, env vars
```

Rules:

1. **One module per tool.** A tool owns its controller, service, DTOs and README.
2. **Tools do not import each other.** If two tools need the same thing, move it to `common/`.
3. **Routes are namespaced by tool**: `/tools/<tool-name>/...`.
4. **Build one tool at a time**, end to end, before starting the next.
5. **Secrets come from environment variables**, documented in the tool README, never committed.
6. **Every tool README states its purpose as a Rothenhall funnel step**: who it attracts and
   what the next step is.

## Tool roadmap

| Tool | Status | Notes |
| --- | --- | --- |
| `leads` | Built, ready to embed | Sarvam-powered sales call agent. Paste a website, get realistic scenarios, then take a live voice call as the rep or practise closing against an AI lead. Streaming voice, barge in, scorecard, and a consent based follow-up form that saves leads to Postgres. Sessions in memory, run one instance. See `backend/src/tools/leads/README.md`. |

## Commands

```bash
# in backend/
npm run start:dev    # watch mode, PORT from backend/.env (falls back to 3000)
npm run build
npm run test         # unit tests (vitest)
npm run test:e2e     # voice protocol end to end, fake Sarvam, no API spend
npm run latency      # real Sarvam: time to first audio per turn (server must be running)
npm run lint

# in frontend/
npm run dev          # port 3000
npm run build
npm run lint
```

## Current state

`leads` is built end to end. `common/` holds the Sarvam client, rate limiting and HTTP helpers
(origin allow list, client address) and `common/db/` (Postgres on Neon, lazy, used only for lead capture).
Calls and sessions still live in memory. There is no auth, on purpose: it is a free tool.

Deploying: see "Deploying and embedding" in `backend/src/tools/leads/README.md`.
