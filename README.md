# Scout & Sage — GLP-1 Dual AI Companion

WhatsApp-native dual AI for GLP-1 persistence: **Scout** (patient companion) and **Sage** (AI clinician), plus a same-origin **Clinician** inbox for human WhatsApp handoffs.

Patient UI stays on WhatsApp. Clinicians use the Next.js inbox in this repo (`/`) to reply into the same Wassist thread after Scout escalates.

Built with [Wassist](https://wassist.app) + [Vercel Eve](https://eve.dev) + Next.js (`withEve` — one app, one origin).

## Why

- 46.5% of T2D and 64.8% of non-diabetic patients discontinue GLP-1s within 12 months (*JAMA Netw Open* 2025, n=125,474); quitters regain ~⅔ of weight.
- 25–40% of weight lost can be lean mass; real-world users often under-eat protein.
- Health apps retain ~4% at 30 days — WhatsApp is where patients already live.
- One warm companion plus a specialist AI clinician beats a single generic chatbot for adherence *and* clinical situational awareness.

## Architecture

```
WhatsApp
   │
   ▼
Wassist platform webhook (signed)
   │ POST /webhook
   ▼
Eve root agent — Scout  (agent/)
   escalate_to_clinician → global queue (.eve/escalations.json)
   handoffStatus: human → Scout pauses coaching
   │
   ├──► Sage (subagent) — briefs / risk / eMed (never WhatsApp)
   │
   ▼
Next.js clinician UI  (app/)  ← same origin via withEve
   GET  /clinician/escalations
   GET  /clinician/escalations/:id/messages
   POST /clinician/escalations/:id/messages  → Wassist sendMessage
   POST /clinician/escalations/:id/resolve   → return thread to Scout
```

`next.config.ts` wraps the app with [`withEve`](https://eve.dev/docs/guides/frontend/nextjs) so `npm run dev` boots Next + Eve together. Custom channel routes (`/webhook`, `/clinician/*`, `/health`, …) are rewritten to the Eve process (withEve alone only mounts `/eve/v1/*`).

## Clinician UI

1. Scout (after red flags / Sage handoff guidance) calls `escalate_to_clinician` with `conversationId`
2. Case appears in the inbox at `/` (polls every few seconds)
3. Open a case → WhatsApp thread → reply (sent as `[Care team] …`)
4. **Resolve / return to Scout** → queue marked resolved; next patient turn resumes AI coaching

No clinician auth in this demo.

## Onboarding (in WhatsApp)

New numbers start with an empty durable profile (`emedSetupStatus: pending`).

1. Welcome + disclose you're not a doctor (Scout; Sage partners; eMed can connect)
2. One question at a time: name (typed) → medication → dose → week → diet → protein → **check-in frequency** → **eMed setup**
3. Almost everything uses WhatsApp **quick-reply buttons** (`offer_choices`, max 3) — only name needs typing
4. **eMed step (required):** Connect eMed / I don't have one / Not now
5. Connect writes that user’s device + readings into durable state (stand-in until live eMed API)
6. When onboarding completes, coaching unlocks

## Stack

| Piece | Role |
| --- | --- |
| Next.js (`withEve`) | Clinician UI + same-origin proxy to Eve |
| Wassist | WhatsApp pipe, media, quick replies |
| Vercel Eve | Durable agent, tools, schedules, `defineState`, subagents |
| Scout (root) | Patient companion on WhatsApp |
| Sage (subagent) | AI clinician — briefs, eMed tools |
| Escalation queue | File-backed global inbox (`.eve/escalations.json` or `/tmp` on Vercel) |

## Setup

Requires **Node 24+**.

```bash
cp .env.example .env
# AI_GATEWAY_API_KEY, WASSIST_API_KEY, WASSIST_WEBHOOK_SECRET, RUNWARE_API_KEY

npm install
npm run dev          # Next on :3000 — Eve boots alongside via withEve
```

Open the clinician inbox at [http://localhost:3000](http://localhost:3000).

Eve-only (no UI): `npm run dev:eve`.

Optional: `NEXT_PUBLIC_EVE_URL` if the UI must call a remote Eve origin (same-origin is the default with `withEve`).

### Wire Wassist

1. Create a webhook at [wassist.app/developers/webhooks](https://wassist.app/developers/webhooks)
2. URL: your deploy host + `/webhook`
3. Subscribe to `message.received`
4. Copy the signing secret into `WASSIST_WEBHOOK_SECRET`
5. Point your number’s routing at this integration (**one** webhook)
6. Set `WASSIST_API_KEY` so replies can be sent via the Conversations API

## Deploy

This repo is a **Next.js + Eve** project. Deploy the Next app to Vercel; `withEve` wires the Eve service and `/eve/v1/*`. Channel routes (`/webhook`, `/clinician/*`, …) are patched into the Vercel output config at build time.

```bash
npm run build
# or: vercel deploy
```

Env vars:

- `AI_GATEWAY_API_KEY` (or Gateway OIDC on Vercel)
- `WASSIST_API_KEY`
- `WASSIST_WEBHOOK_SECRET` (required in production — HMAC `x-wassist-signature`)
- `RUNWARE_API_KEY`
- `DEMO_RESET_SECRET` (required for `POST /reset-all` demo wipe)
- `CLINICIAN_WEBHOOK_URL` (optional Slack/PagerDuty notify on escalate)
- `NEXT_PUBLIC_EVE_URL` (optional; only if UI is not same-origin)

Health: `GET /health` · Eve: `GET /eve/v1/health` · Inbox: `GET /`

### Demo reset (wipe all sessions)

```bash
curl -X POST https://<your-host>/reset-all \
  -H "x-demo-reset-secret: $DEMO_RESET_SECRET"
```

## Demo (live WhatsApp + clinician inbox)

1. New chat → onboarding with quick replies (incl. eMed Connect) → confirm profile
2. Agent-initiated check-in on their cadence (or `POST /proactive-checkin`)
3. “Rough week, nauseous, skipped a dose” → Scout coaches; may consult Sage on risk
4. Lunch photo → protein estimate + Runware upgrade image
5. “Bad stomach pain” → Scout → Sage → `escalate_to_clinician` → patient told a **human** is joining
6. Open `/` → case → reply on WhatsApp → Resolve / return to Scout

## Safety

- Adherence & nutrition only — never diagnoses or changes doses
- Red flags → emergency-care messaging + Sage + human escalate when needed
- While `handoffStatus` is human, Scout does not coach (short ack only)
- Shell / web / file built-ins disabled

## Pitch close

`$1,000/mo drug × ~50% churn wastes millions per employer cohort. Scout keeps the ritual where patients already are — WhatsApp — while Sage keeps the clinical picture sharp.`
