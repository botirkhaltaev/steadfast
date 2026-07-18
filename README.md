# Scout & Sage — WhatsApp Dual AI Care Companion

WhatsApp-native dual AI for chronic care programmes: **Scout** (patient companion) and **Sage** (AI clinician) improve the patient experience and save clinician time.

**UI = WhatsApp only.** Conversational onboarding, frequency-based proactive check-ins, side-effect and adherence coaching, optional meal-photo nutrition support, quick-reply choices, dropout-risk awareness, and Sage consults on red flags / complex cases.

Built with [Wassist](https://wassist.app) webhooks + [Vercel Eve](https://eve.dev).

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
   │ POST /webhook
   │ event: message.received
   │ contact.phoneNumber, message.body, conversationId
   ▼
Eve root agent — Scout
   instructions.md   — onboarding + coach + when to call Sage
   defineState       — durable patient (+ condition, sageBriefs, emedSetupStatus, emedDevice, emedReadings)
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
| Wassist webhooks + Conversations API | WhatsApp pipe, media, quick replies |
| Vercel Eve | Durable agent, tools, schedules, `defineState`, subagents |
| Scout (root) | Patient companion on WhatsApp (no eMed reading tools) |
| Sage (subagent) | AI clinician — briefs, eMed biomarker tools |
| Eve `defineState` | Patient DB incl. condition + eMed link/readings |
| OpenAI via AI Gateway | Coach + meal vision |
| Runware FLUX | Optional higher-protein meal visuals |

## Setup

Requires **Node 24+**.

```bash
cp .env.example .env
# AI_GATEWAY_API_KEY, WASSIST_API_KEY, WASSIST_WEBHOOK_SECRET, RUNWARE_API_KEY

npm install
npm run dev
```

### eMed health data (onboarding)

Patients explicitly choose during onboarding. **Connect** links per-user eMed health data and stores readings in Eve state. Skip / no device leaves them unlinked. **Sage** reads linked data via `get_emed_device` / `get_emed_biomarkers`. Scout connects via `update_onboarding` only — no clinical read tools.

### Wire Wassist

1. Create a webhook at [wassist.app/developers/webhooks](https://wassist.app/developers/webhooks)  
2. URL: your deploy host + `/webhook`  

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
- `DEMO_RESET_SECRET` (required for `POST /reset-all` demo wipe)
- `CLINICIAN_WEBHOOK_URL` (optional; **future** human escalation sink — unused by Scout/Sage today)

Health: `GET /health` → `{"ok":true,"service":"scout-sage-wassist","webhook":"/webhook","resetAll":"/reset-all",...}`  
Eve: `GET /eve/v1/health`

### Demo reset (wipe all sessions)

Patient data lives in Eve durable **sessions** (not a separate Postgres). Restarting the app does **not** clear them. To demo from scratch:

```bash
curl -X POST https://<your-host>/reset-all \
  -H "x-demo-reset-secret: $DEMO_RESET_SECRET"
```

This bumps a session epoch so every phone gets a **new** Eve session on the next WhatsApp message (blank onboarding / eMed). Set `DEMO_RESET_SECRET` in env.

## Demo (live WhatsApp)

1. New chat → onboarding with quick replies (condition, frequency, eMed Connect) → confirm profile  
2. Agent-initiated check-in on their cadence (or `POST /proactive-checkin`)  
3. “Rough week, side effects, skipped a dose” → Scout coaches; may consult Sage on risk  
4. If they connected eMed → Scout consults Sage → Sage pulls that user’s biomarkers  
5. Optional: lunch photo → protein estimate + Runware upgrade image  
6. “Bad stomach pain” → Scout stops coaching → consults Sage → patient-safe next steps (no human handoff yet)  

## Safety

- Adherence & behaviour coaching only — never diagnoses or changes doses  
- Red flags → Scout consults **Sage** + emergency-care messaging when appropriate  
- Shell / web / file built-ins disabled  

## Pitch close

Scout makes onboarding easy and runs warm check-ins where patients already are: WhatsApp. Sage handles clinical review in the background so clinicians are not pulled in unless it matters.
