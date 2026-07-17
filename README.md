# Steadfast — GLP-1 Persistence Companion

WhatsApp-native AI companion that keeps people on their GLP-1 programme: conversational onboarding, weekly check-ins, side-effect coaching, meal-photo protein support, dropout-risk awareness, and human escalation on red flags.

**UI = WhatsApp.** No patient web app. Built with [Wassist](https://wassist.app) BYOA + [Vercel Eve](https://eve.dev).

## Why

- 46.5% of T2D and 64.8% of non-diabetic patients discontinue GLP-1s within 12 months (*JAMA Netw Open* 2025, n=125,474); quitters regain ~⅔ of weight.
- 25–40% of weight lost can be lean mass; real-world users often under-eat protein.
- Health apps retain ~4% at 30 days — WhatsApp is where patients already live.
- Supervision drives adherence (eMed’s model); AI makes that playbook scale.

## Architecture

```
WhatsApp  ⇄  Wassist BYOA sandbox/number
                │ POST /eve/v1/wassist/webhook
                │ { message, image?, phone_number, reply_callback }
                ▼
         Eve agent (Vercel)
           instructions.md  — onboarding + coach + safety
           tools/           — onboarding, check-in, vision, Runware, escalate
           schedules/       — weekly check-in cron
                │
                ▼ reply_callback / Conversations API
         WhatsApp (patient)
```

## Onboarding (in WhatsApp)

New numbers start with empty profiles. The agent:

1. Introduces itself (not a doctor)
2. Asks **one question at a time**: name → medication → dose → week → diet → protein target (+ optional motivation)
3. Saves via `update_onboarding`
4. Confirms a summary and explains the weekly ritual

Only then does weekly coaching / meal photos / risk scoring unlock.

## Stack

| Piece | Role |
| --- | --- |
| Wassist BYOA | WhatsApp pipe, typing, media, 24h window |
| Vercel Eve | Durable agent, tools, schedules, deploy |
| OpenAI via AI Gateway | Coach + meal vision |
| Runware FLUX | Personalized higher-protein meal visuals |

## Setup

Requires **Node 24+**.

```bash
cp .env.example .env
# fill AI_GATEWAY_API_KEY (or OPENAI_API_KEY), WASSIST_API_KEY, RUNWARE_API_KEY

npm install
npm run dev          # or: npx eve dev --no-ui
```

### Wire Wassist

1. Sign up at [wassist.app](https://wassist.app/login) (phone OTP).
2. Create a **Bring Your Own Agent** with webhook:

   `https://<your-host>/eve/v1/wassist/webhook`

3. Message the sandbox / test number — first messages run **onboarding**.

Deploy:

```bash
npx eve deploy
# or: vercel deploy
```

Health check: `GET /eve/v1/wassist/health`  
Open escalations (ops JSON): `GET /eve/v1/wassist/escalations`

## Demo script (live WhatsApp)

1. New chat → onboarding questions → confirm profile  
2. “Rough week, nauseous, skipped Tuesday” → empathy + coaching + `log_checkin`  
3. Send lunch photo → protein estimate + Runware upgrade image  
4. “Bad stomach pain since yesterday” → stop coaching → escalate  

## Safety

- Coaches adherence & nutrition only — never diagnoses or changes doses  
- Red flags → immediate escalation tool + patient told a human is being connected  
- Shell / web fetch / write tools disabled on the agent  

## Pitch close

`$1,000/mo drug × ~50% churn wastes millions per employer cohort. Steadfast runs the supervision ritual where patients already are — WhatsApp — so the drug isn’t wasted.`
