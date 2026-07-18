# Steadfast — GLP-1 Persistence Companion

WhatsApp-native AI companion that keeps people on their GLP-1 programme.

**UI = WhatsApp only.** Conversational onboarding, weekly check-ins, side-effect coaching, meal-photo protein support, quick-reply choices, dropout-risk awareness, and human escalation on red flags.

Built with [Wassist](https://wassist.app) BYOA + [Vercel Eve](https://eve.dev).

## Why

- 46.5% of T2D and 64.8% of non-diabetic patients discontinue GLP-1s within 12 months (*JAMA Netw Open* 2025, n=125,474); quitters regain ~⅔ of weight.
- 25–40% of weight lost can be lean mass; real-world users often under-eat protein.
- Health apps retain ~4% at 30 days — WhatsApp is where patients already live.

## Architecture

```
WhatsApp  ⇄  Wassist BYOA
                │ POST /webhook
                │ { message, image?, phone_number, reply_callback }
                ▼
         Eve agent (Vercel)
           instructions.md     — onboarding + coach + safety
           defineState         — durable per-phone patient profile
           tools/              — onboarding, choices, check-in, vision, Runware, escalate
           schedules/          — weekly check-in cron
                │
                ▼ reply_callback (text / quick replies / image)
         WhatsApp
```

## Onboarding (in WhatsApp)

New numbers start with an empty durable profile (no seeded personas).

1. Welcome + disclose you're not a doctor  
2. One question at a time: name → medication → dose → week → diet → protein target  
3. Diet / protein use WhatsApp **quick-reply buttons** (`offer_choices`)  
4. Saves via `update_onboarding` until complete  
5. Confirms summary + explains the weekly ritual  

Coaching, meal vision, and risk scoring unlock only after onboarding completes.

## Stack

| Piece | Role |
| --- | --- |
| Wassist BYOA | WhatsApp pipe, media, 24h window, quick replies |
| Vercel Eve | Durable agent, tools, schedules, `defineState` |
| OpenAI via AI Gateway | Coach + meal vision |
| Runware FLUX | Higher-protein meal visuals |

## Setup

Requires **Node 24+**.

```bash
cp .env.example .env
# AI_GATEWAY_API_KEY or OPENAI_API_KEY, WASSIST_API_KEY, RUNWARE_API_KEY

npm install
npm run dev          # interactive: npm exec -- eve dev
                     # headless:    npm exec -- eve dev --no-ui
```

### Wire Wassist

1. Sign up at [wassist.app](https://wassist.app/login).  
2. Create **Bring Your Own Agent** with webhook:

   `https://<your-host>/webhook`

   Production: `https://steadfast-olive.vercel.app/webhook`

3. Message the sandbox number — first turns run **onboarding**.

### Deploy

```bash
npx eve deploy
# or: npx vercel --yes
```

Set env on Vercel:
- `AI_GATEWAY_API_KEY` (or Gateway OIDC)
- `WASSIST_API_KEY`
- `RUNWARE_API_KEY`
- `WASSIST_WEBHOOK_SECRET` (HMAC via `x-wassist-signature`, or `X-Wassist-Secret`; BYOA allows unsigned)
- `CLINICIAN_WEBHOOK_URL` (Slack/PagerDuty for red-flag escalations)

Health: `GET /health` → `{"ok":true,"webhook":"/webhook"}`  
Eve: `GET /eve/v1/health`

Eve custom channels mount authored paths as-is (`/webhook`), not under `/eve/v1/wassist/…`.

## Demo (live WhatsApp)

1. New chat → onboarding with quick replies → confirm profile  
2. “Rough week, nauseous, skipped a dose” → coaching + check-in log  
3. Lunch photo → protein estimate + Runware upgrade image  
4. “Bad stomach pain” → stop coaching → escalate  

## Safety

- Adherence & nutrition only — never diagnoses or changes doses  
- Red flags → `escalate_to_clinician` + patient told a human is being connected  
- Shell / web / file built-ins disabled  

## Pitch close

`$1,000/mo drug × ~50% churn wastes millions per employer cohort. Steadfast runs the supervision ritual where patients already are — WhatsApp.`
