# Scout & Sage — GLP-1 Dual AI Companion

WhatsApp-native dual AI for GLP-1 persistence: **Scout** (patient companion) and **Sage** (AI clinician) coordinate to improve patient and clinician experience.

**UI = WhatsApp only.** Conversational onboarding, frequency-based proactive check-ins, side-effect coaching, meal-photo protein support, quick-reply choices, dropout-risk awareness, and Sage consults on red flags / complex cases. Human clinician handoff is deferred for a later pass.

Built with [Wassist](https://wassist.app) webhooks + [Vercel Eve](https://eve.dev).

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
   │ event: message.received
   │ contact.phoneNumber, message.body, conversationId
   ▼
Eve root agent — Scout
   instructions.md   — onboarding + coach + when to call Sage
   defineState       — durable patient (+ sageBriefs, emedSetupStatus, emedDevice, emedReadings)
   tools/            — onboarding (incl. eMed connect), choices, check-in, vision, WhatsApp
   schedules/        — daily sweep; check-ins honor chosen cadence
   │
   ├──► Sage (subagent) — clinical briefs, risk, eMed biomarker review
   │         tools: get_patient_profile, get_emed_device, get_emed_biomarkers,
   │                save_clinical_brief
   │         never messages the patient
   │
   ▼ POST /conversations/{id}/messages/
Wassist Conversations API → WhatsApp
```

One inbound path (signed platform events). One outbound path (REST). Scout is the only voice on WhatsApp. Tools are role-split: Scout coaches on WhatsApp; Sage owns clinical eMed reads.

## Onboarding (in WhatsApp)

New numbers start with an empty durable profile (`emedSetupStatus: pending`).

1. Welcome + disclose you're not a doctor (Scout; Sage partners; eMed can connect)  
2. One question at a time: name (typed) → medication → dose → week → diet → protein → **check-in frequency** → **eMed setup**  
3. Almost everything uses WhatsApp **quick-reply buttons** (`offer_choices`, max 3) — only name needs typing  
4. **eMed step (required):** Connect eMed / I don't have one / Not now (`emed_connect`, `emed_no_device`, `emed_skip`)  
5. Connect writes that user’s device + readings into durable state (stand-in until live eMed API)  
6. Saves via `update_onboarding` until complete  
7. One confirmation summary: cadence + eMed outcome (linked / no device / skipped)  

Coaching, meal vision, and risk scoring unlock only after onboarding completes.

## Stack

| Piece | Role |
| --- | --- |
| Wassist webhooks + Conversations API | WhatsApp pipe, media, quick replies |
| Vercel Eve | Durable agent, tools, schedules, `defineState`, subagents |
| Scout (root) | Patient companion on WhatsApp (no eMed reading tools) |
| Sage (subagent) | AI clinician — briefs, eMed device/biomarker tools |
| Eve `defineState` | Patient DB incl. eMed device link + readings |
| OpenAI via AI Gateway | Coach + meal vision |
| Runware FLUX | Higher-protein meal visuals |

## Setup

Requires **Node 24+**.

```bash
cp .env.example .env
# AI_GATEWAY_API_KEY, WASSIST_API_KEY, WASSIST_WEBHOOK_SECRET, RUNWARE_API_KEY

npm install
npm run dev
```

### eMed device (onboarding)

Patients explicitly choose during onboarding. **Connect** links a per-user eMed monitor and stores readings in Eve state (sync stand-in). Skip / no device leaves them unlinked. **Sage** reads linked data via `get_emed_device` / `get_emed_biomarkers`. Scout connects via `update_onboarding` only — no clinical read tools.

### Wire Wassist

1. Create a webhook at [wassist.app/developers/webhooks](https://wassist.app/developers/webhooks)  
2. URL: your deploy host + `/webhook` (e.g. `https://steadfast-olive.vercel.app/webhook` until the project is renamed)  
3. Subscribe to `message.received`  
4. Copy the signing secret into `WASSIST_WEBHOOK_SECRET`  
5. Point your number’s routing at this integration (**one** webhook — do not also attach a second BYOA/agent webhook to the same URL)  
6. Set `WASSIST_API_KEY` so replies can be sent via the Conversations API  

## Deploy

```bash
npx eve deploy
```

Env vars:

- `AI_GATEWAY_API_KEY` (or Gateway OIDC on Vercel)
- `WASSIST_API_KEY`
- `WASSIST_WEBHOOK_SECRET` (required in production — HMAC `x-wassist-signature`)
- `RUNWARE_API_KEY`
- `CLINICIAN_WEBHOOK_URL` (optional; **future** human escalation sink — unused by Scout/Sage today)

Health: `GET /health` → `{"ok":true,"service":"scout-sage-wassist","webhook":"/webhook"}`  
Eve: `GET /eve/v1/health`

## Demo (live WhatsApp)

1. New chat → onboarding with quick replies (incl. eMed Connect) → confirm profile  
2. Agent-initiated check-in on their cadence (or `POST /proactive-checkin`)  
3. “Rough week, nauseous, skipped a dose” → Scout coaches; may consult Sage on risk  
4. If they connected eMed → Scout consults Sage → Sage pulls that user’s biomarkers  
5. Lunch photo → protein estimate + Runware upgrade image  
6. “Bad stomach pain” → Scout stops coaching → consults Sage → patient-safe next steps (no human handoff yet)  

## Safety

- Adherence & nutrition only — never diagnoses or changes doses  
- Red flags → Scout consults **Sage** + emergency-care messaging when appropriate  
- Human clinician escalation is deferred (tool kept dormant for later)  
- Shell / web / file built-ins disabled  

## Pitch close

`$1,000/mo drug × ~50% churn wastes millions per employer cohort. Scout keeps the ritual where patients already are — WhatsApp — while Sage keeps the clinical picture sharp.`
