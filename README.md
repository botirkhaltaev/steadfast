# Scout & Sage — WhatsApp Dual AI Care Companion

WhatsApp-native dual AI for chronic care programmes: **Scout** (patient companion) and **Sage** (AI clinician), plus a same-origin **Clinician** inbox for human WhatsApp handoffs.

Patient UI stays on WhatsApp (onboarding, check-ins, side-effect / adherence coaching, optional meal-photo nutrition, quick replies, dropout-risk awareness, Sage consults). Clinicians use the Next.js inbox in this repo (`/`) to reply into the same Wassist thread after Scout escalates.

Built with [Wassist](https://wassist.app) + [Vercel Eve](https://eve.dev) + Next.js (`withEve` — one app, one origin).

## Why

- Chronic programmes lose patients between visits, and clinicians get pulled into routine questions.
- Health apps retain ~4% of users at 30 days — WhatsApp is where patients already live.
- One warm companion plus a specialist AI clinician beats a single generic chatbot for adherence and clinical situational awareness.
- Sage reviews in the background so clinicians are only pulled in when necessary.

## Architecture

```
WhatsApp
   │
   ▼
Wassist platform webhook (signed)
   │ POST /eve/v1/wassist/webhook
   ▼
Eve root agent — Scout  (agent/)
   instructions.md   — onboarding + coach + when to call Sage / escalate
   defineState       — durable patient (+ condition, sageBriefs, emed, handoff)
   escalate_to_clinician → global queue (.eve/escalations.json)
   handoffStatus: human → Scout pauses coaching
   │
   ├──► Sage (subagent) — briefs / risk / eMed (never WhatsApp)
   │
   ▼
Next.js clinician UI  (app/)  ← same origin via withEve
   GET  /eve/v1/clinician/escalations
   GET  /eve/v1/clinician/escalations/:id/messages
   POST /eve/v1/clinician/escalations/:id/messages  → Wassist sendMessage
   POST /eve/v1/clinician/escalations/:id/resolve   → return thread to Scout
```

`next.config.mjs` wraps the app with [`withEve`](https://eve.dev/docs/guides/frontend/nextjs) so `npm run dev` boots Next + Eve together. withEve proxies `/eve/v1/**` to the Eve service — custom channel routes are authored under that prefix (same pattern as Slack/Telegram/etc.).

## Clinician UI

1. Scout (after red flags / Sage handoff guidance) calls `escalate_to_clinician` with `conversationId`
2. Case appears in the inbox at `/` (polls every few seconds)
3. Open a case → WhatsApp thread → reply (sent as `[Care team] …`)
4. **Resolve / return to Scout** → queue marked resolved; next patient turn resumes AI coaching

No clinician auth in this demo.

## Onboarding (in WhatsApp)

New numbers start with an empty durable profile (`emedSetupStatus: pending`).

1. Welcome + disclose you're not a doctor (Scout; Sage partners; eMed can connect)
2. One question at a time: name (typed) → condition → medication → dose → week → check-in frequency → eMed setup
3. **Tap-first:** almost everything is WhatsApp quick-reply buttons (`offer_choices`, max 3). Name is the only required typing step; **Other** is the escape hatch for custom med/dose
4. Condition-aware med buttons (e.g. Weight → Semaglutide / Tirzepatide / Other; Diabetes → Metformin / Insulin / Other)
5. Dose buttons follow the chosen medication
6. **eMed step (required):** Connect eMed / I don't have one / Not now
7. Connect writes that user’s health data + readings into durable state
8. One confirmation summary: cadence + eMed outcome (linked / no device / skipped)

Diet and protein target are optional. Coaching, optional meal vision, and risk scoring unlock only after onboarding completes.

## Stack

| Piece | Role |
| --- | --- |
| Next.js (`withEve`) | Clinician UI + same-origin proxy to Eve |
| Wassist | WhatsApp pipe, media, quick replies, voice notes |
| Vercel Eve | Durable agent, tools, schedules, `defineState`, subagents |
| Scout (root) | Patient companion on WhatsApp (no eMed reading tools) |
| Sage (subagent) | AI clinician — briefs, eMed biomarker tools |
| Escalation queue | File-backed global inbox (`.eve/escalations.json` or `/tmp` on Vercel) |
| Eve `defineState` | Patient DB incl. condition + eMed link/readings + handoff |
| OpenAI via AI Gateway | Coach + meal vision + voice transcription |
| Runware FLUX | Optional higher-protein meal visuals |
| Gemini Live API | Tasso+ voice + vision device helper (browser link) |

## Setup

Requires **Node 24+**.

```bash
cp .env.example .env
# AI_GATEWAY_API_KEY, WASSIST_API_KEY, WASSIST_WEBHOOK_SECRET, RUNWARE_API_KEY
# GEMINI_API_KEY, PUBLIC_BASE_URL, DEVICE_SUPPORT_LINK_SECRET (Tasso+ live helper)

npm install
npm run dev          # Next on :3000 — Eve boots alongside via withEve
```

Open the clinician inbox at [http://localhost:3000](http://localhost:3000).

Eve-only (no UI): `npm run dev:eve`.

Optional: `NEXT_PUBLIC_EVE_URL` if the UI must call a remote Eve origin (same-origin is the default with `withEve`).

### Tasso+ live device helper (Gemini Live)

When a patient struggles with their Tasso+ blood kit, Scout calls `start_device_support_session` and sends a one-time browser link (`/eve/v1/device-support?t=…`). The page requests camera + mic, mints a short-lived Gemini Live ephemeral token from this app, and runs a voice + vision troubleshooting session grounded in the Tasso+ Instructions For Use. On end, the outcome resumes the WhatsApp thread so Scout can follow up.

Requires `GEMINI_API_KEY`, `PUBLIC_BASE_URL` (e.g. `https://steadfast-olive.vercel.app`), and preferably `DEVICE_SUPPORT_LINK_SECRET`.

### eMed health data (onboarding)

Patients explicitly choose during onboarding. **Connect** links per-user eMed health data and stores readings in Eve state. Skip / no device leaves them unlinked. **Sage** reads linked data via `get_emed_device` / `get_emed_biomarkers`. Scout connects via `update_onboarding` only — no clinical read tools.

### Wire Wassist

1. Create a webhook at [wassist.app/developers/webhooks](https://wassist.app/developers/webhooks)
2. URL: your deploy host + `/eve/v1/wassist/webhook`
3. Subscribe to `message.received`
4. Copy the signing secret into `WASSIST_WEBHOOK_SECRET`
5. Point your number’s routing at this integration (**one** webhook — do not also attach a second BYOA/agent webhook to the same URL)
6. Set `WASSIST_API_KEY` so replies can be sent via the Conversations API

## Deploy

This repo is a **Next.js + Eve** project. Deploy the Next app to Vercel; `withEve` wires the Eve service and proxies `/eve/v1/**` (including Wassist, clinician, and Tasso+ `/eve/v1/device-support` channel routes).

```bash
npm run build
# or: vercel deploy
```

Env vars:

- `AI_GATEWAY_API_KEY` (or Gateway OIDC on Vercel)
- `WASSIST_API_KEY`
- `WASSIST_WEBHOOK_SECRET` (required in production — HMAC `x-wassist-signature`)
- `RUNWARE_API_KEY`
- `GEMINI_API_KEY` (Tasso+ Gemini Live helper)
- `PUBLIC_BASE_URL` (origin used in WhatsApp device-support links)
- `DEVICE_SUPPORT_LINK_SECRET` (HMAC for one-time links; falls back to webhook secret)
- `CLINICIAN_WEBHOOK_URL` (optional Slack/PagerDuty notify on escalate)
- `NEXT_PUBLIC_EVE_URL` (optional; only if UI is not same-origin)

Health: `GET /eve/v1/wassist/health` · Eve: `GET /eve/v1/health` · Inbox: `GET /` · Device help: `GET /eve/v1/device-support`

### Demo reset (wipe all sessions)

Patient data lives in Eve durable **sessions** (not a separate Postgres). Restarting the app does **not** clear them. To demo from scratch:

```bash
curl -X POST https://<your-host>/eve/v1/wassist/reset-all
```

This bumps a session epoch so every phone gets a **new** Eve session on the next WhatsApp message (blank onboarding / eMed). Open endpoint — no auth (hackathon demos).

## Demo (live WhatsApp + clinician inbox)

1. New chat → onboarding with quick replies (condition, frequency, eMed Connect) → confirm profile
2. Agent-initiated check-in on their cadence (or `POST /eve/v1/wassist/proactive-checkin`)
3. “Rough week, side effects, skipped a dose” → Scout coaches; may consult Sage on risk
4. If they connected eMed → Scout consults Sage → Sage pulls that user’s biomarkers
5. Optional: lunch photo → protein estimate + Runware upgrade image
6. “Bad stomach pain” → Scout → Sage → `escalate_to_clinician` → patient told a **human** is joining
7. Open `/` → case → reply on WhatsApp → Resolve / return to Scout
8. “My Tasso+ isn’t collecting blood” → Scout sends `/eve/v1/device-support` live link → patient opens camera+mic helper → Scout follows up on outcome

## Safety

- Adherence & behaviour coaching only — never diagnoses or changes doses
- Red flags → emergency-care messaging + Sage + human escalate when needed
- While `handoffStatus` is human, Scout does not coach (short ack only)
- Shell / web / file built-ins disabled

## Pitch close

Scout makes onboarding easy and runs warm check-ins where patients already are: WhatsApp. Sage handles clinical review in the background so clinicians are not pulled in unless it matters.
