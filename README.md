# Steadfast — GLP-1 Persistence Companion

WhatsApp-native AI companion that keeps people on their GLP-1 programme.

**UI = WhatsApp only.** Conversational onboarding, frequency-based proactive check-ins, side-effect coaching, meal-photo protein support, quick-reply choices, dropout-risk awareness, and human escalation on red flags.

Built with [Wassist](https://wassist.app) webhooks + [Vercel Eve](https://eve.dev).

## Why

- 46.5% of T2D and 64.8% of non-diabetic patients discontinue GLP-1s within 12 months (*JAMA Netw Open* 2025, n=125,474); quitters regain ~⅔ of weight.
- 25–40% of weight lost can be lean mass; real-world users often under-eat protein.
- Health apps retain ~4% at 30 days — WhatsApp is where patients already live.

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
Eve agent (Vercel)
   instructions.md   — onboarding + coach + safety
   defineState       — durable per-phone patient profile
   tools/            — onboarding, choices, check-in, vision, escalate
   schedules/        — daily sweep; check-ins honor chosen cadence
   │
   ▼ POST /conversations/{id}/messages/
Wassist Conversations API → WhatsApp
```

One inbound path (signed platform events). One outbound path (REST). No BYOA callback dual-stack.

## Onboarding (in WhatsApp)

New numbers start with an empty durable profile.

1. Welcome + disclose you're not a doctor  
2. One question at a time: name (typed) → medication → dose → week → diet → protein → **check-in frequency**  
3. Almost everything uses WhatsApp **quick-reply buttons** (`offer_choices`, max 3) — only name needs typing  
4. Saves via `update_onboarding` until complete  
5. Confirms summary + explains that **Steadfast will message them** on that cadence  

Coaching, meal vision, and risk scoring unlock only after onboarding completes.

## Stack

| Piece | Role |
| --- | --- |
| Wassist webhooks + Conversations API | WhatsApp pipe, media, quick replies |
| Vercel Eve | Durable agent, tools, schedules, `defineState` |
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

### Wire Wassist

1. Create a webhook at [wassist.app/developers/webhooks](https://wassist.app/developers/webhooks)  
2. URL: `https://steadfast-olive.vercel.app/webhook`  
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
- `CLINICIAN_WEBHOOK_URL` (optional escalation sink)

Health: `GET /health` → `{"ok":true,"webhook":"/webhook"}`  
Eve: `GET /eve/v1/health`

## Demo (live WhatsApp)

1. New chat → onboarding with quick replies (incl. check-in frequency) → confirm profile  
2. Agent-initiated check-in on their cadence (or `POST /proactive-checkin`)  
3. “Rough week, nauseous, skipped a dose” → coaching + check-in log  
4. Lunch photo → protein estimate + Runware upgrade image  
5. “Bad stomach pain” → stop coaching → escalate  

## Safety

- Adherence & nutrition only — never diagnoses or changes doses  
- Red flags → `escalate_to_clinician` + patient told a human is being connected  
- Shell / web / file built-ins disabled  

## Pitch close

`$1,000/mo drug × ~50% churn wastes millions per employer cohort. Steadfast runs the supervision ritual where patients already are — WhatsApp.`
