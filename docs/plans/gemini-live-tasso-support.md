# Feature Plan: Gemini Live "Tasso+ Device Helper" (voice + vision browser session)

Status: **PLAN ONLY — no implementation yet**

## 1. Summary

Scout (the WhatsApp agent) manages the patient relationship. When a patient needs
hands-on help using their **Tasso+ blood collection device** at home, Scout sends
them a **one-time browser link**. The link opens a lightweight web page served by
this same eve app that:

1. Asks for **camera and microphone permission**.
2. Connects **directly from the browser to the Gemini Live API** (voice in, voice
   out, camera frames in) using a short-lived **ephemeral token** minted by our
   backend.
3. Runs a Tasso-specific live troubleshooting assistant, grounded in the official
   Tasso+ Instructions For Use, that can *see* what the patient is doing (device
   placement, tube fill level, adhesive problems) and talk them through each step.
4. Reports the outcome back to Scout so the WhatsApp thread continues seamlessly
   ("Looks like you finished the collection — remember to ship the kit today.").

WhatsApp remains the product surface; the browser page is a single-purpose,
ephemeral "video call with the device expert" that Scout opens on demand.

## 2. Why this architecture

### Gemini Live API: client-to-server with ephemeral tokens

The Live API ([docs](https://ai.google.dev/gemini-api/docs/live-api)) is a
stateful WebSocket that accepts continuous audio (16-bit PCM, 16 kHz) and images
(JPEG ≤ 1 FPS) and returns audio (24 kHz PCM). Two integration approaches exist:

- **Server-to-server**: browser → our backend → Gemini. Requires us to proxy the
  realtime media stream. Our deploy target is Vercel serverless with
  `maxDuration: 60` (`vercel.json`), which cannot hold a long-lived duplex
  WebSocket proxy. **Not viable here.**
- **Client-to-server** (chosen): the browser connects straight to Gemini's
  WebSocket. Google explicitly recommends this for latency and simplicity, with
  **[ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)**
  instead of exposing the real API key. Our backend only does one short HTTP call
  to mint the token — a perfect fit for serverless.

Ephemeral tokens also support **`liveConnectConstraints`**: we lock the token to
our model + system instruction + response modality **server-side**, so even if a
token leaks it can only be used for one Tasso-support session with our prompt,
for a few minutes.

### Serving the browser page from this app

The repo has no frontend framework (README: "WhatsApp is the product UI"), and we
don't need one. Eve **custom channels** can serve arbitrary HTTP routes returning
any `Response`, including HTML (`node_modules/eve/docs/channels/custom.mdx`).
The existing `agent/channels/wassist.ts` already demonstrates the pattern with
`POST /webhook` and `GET /health`. We add one new channel file that serves:

- the static support page (single-file HTML + inline JS, no build step), and
- a small JSON API to validate the link token and mint the Gemini ephemeral token.

This keeps the feature self-contained: no Next.js, no separate deploy.

## 3. User flow

```
WhatsApp (Scout)                       Browser page                    Gemini Live API
────────────────                       ────────────                    ───────────────
Patient: "The blood isn't
flowing into the tube"
        │
Scout calls tool
start_device_support_session
        │  mints link token, saves to
        │  patient state, returns URL
        ▼
"Tap this link and I'll get our
device helper on a live video
call with you: https://<host>/
device-support?t=<token>"
        │
        │ patient taps link ─────────► GET /device-support (HTML)
                                       - shows intro + big "Start" button
                                       - requests camera + mic permission
                                       - POST /device-support/api/live-token
                                         { t: <link token> }
                                         ◄─ backend validates token,
                                            marks it "started", mints
                                            Gemini ephemeral token
                                       - opens WSS to Gemini with the
                                         ephemeral token ──────────────► live session
                                       - streams mic audio + 1 FPS
                                         camera JPEGs; plays audio out ◄─► voice+vision
                                       - on-screen: live captions
                                         (output transcription), step
                                         indicator, "End session"
                                       - on end: POST /device-support/
                                         api/outcome { t, summary }
        ◄──────────────────────────── backend resumes the patient's
        Scout receives a [system]      WhatsApp session via send()
        outcome message, follows up
        in the WhatsApp thread
```

## 4. Changes by file

### 4.1 New: `agent/channels/device-support.ts`

Custom eve channel (file stem = channel id `device-support`). Routes:

| Route | Purpose |
| --- | --- |
| `GET /device-support` | Serve the single-file HTML/JS page (`content-type: text/html`). Reads `?t=` client-side; no auth needed to *view* the shell. |
| `POST /device-support/api/live-token` | Body `{ t }`. Validates the signed link token (HMAC, unexpired, not already consumed), then calls `@google/genai` `authTokens.create` with `uses: 1`, short `expireTime` (~30 min), `newSessionExpireTime` (~2 min), and `liveConnectConstraints` locking model, `systemInstruction` (Tasso prompt, personalized with patient first name), `responseModalities: ['AUDIO']`, `outputAudioTranscription`, and `sessionResumption`. Returns `{ token, model }`. |
| `POST /device-support/api/outcome` | Body `{ t, outcome, summary }` where `outcome ∈ completed \| abandoned \| escalate` and `summary` is a short model-authored recap (from the live session's final "wrap up" turn transcription). Validates `t`, persists to patient state, then resumes the patient's WhatsApp session with a `[system] Device support session ended…` message via this channel's `send()` using the same phone-derived continuation token format as the wassist channel (`normalizePhone`), so Scout can follow up in the thread. |

CORS stays off (same-origin page). The channel needs no `events` handlers — it
never produces model turns of its own; the outcome route resumes the *wassist*
session using cross-channel hand-off (`receive(wassist, …)`) so replies flow out
through the existing WhatsApp flush pipeline.

Link-token design (no new storage system needed):

- Token = `base64url(payload).signature` where payload is
  `{ phone, conversationId, exp, nonce }` and signature is
  `HMAC-SHA256(payload, DEVICE_SUPPORT_LINK_SECRET)`.
- Expiry ~60 min from issuance; single-use enforcement via the patient state
  record (see 4.4): the nonce is stored on issuance and flipped to `used` when
  `live-token` succeeds.

### 4.2 New: `agent/tools/start_device_support_session.ts`

`defineTool` following the existing pattern (`send_whatsapp_message.ts`):

- **Input**: `{ phoneNumber, reason?: string }`.
- **Behavior**: requires a known patient (`getPatient`); builds the signed link
  token; records a `DeviceSupportSession` entry in patient state
  (`status: "link_sent"`, reason, issuedAt, expiry); returns
  `{ url, expiresInMinutes }` for Scout to include in its normal reply text
  (links go out as plain text — Wassist buttons are quick-replies, not URL
  buttons).
- **Config**: base URL from `PUBLIC_BASE_URL` env (falls back to the Vercel
  deployment URL).

No proactive send inside the tool — Scout writes the message itself so the tone
stays conversational, same as every other reply.

### 4.3 New: `agent/lib/device-support.ts` + `agent/lib/tasso-live-prompt.ts`

- `device-support.ts`: token mint/verify helpers, ephemeral-token minting via
  `@google/genai`, outcome-message builder. Kept in `lib/` so both the tool and
  the channel share it (mirrors `lib/wassist.ts` / `lib/proactive-checkin.ts`).
- `tasso-live-prompt.ts`: exports the live assistant's system instruction as a
  constant (server-side only — it ships inside `liveConnectConstraints`, never
  to the browser). Content in section 5.

### 4.4 Modified: `agent/lib/store.ts`

Add to `Patient`:

```ts
export type DeviceSupportSession = {
  id: string;              // nonce from the link token
  reason: string | null;   // what the patient was struggling with
  status: "link_sent" | "started" | "completed" | "abandoned" | "escalate";
  summary: string | null;  // model recap posted from the page
  issuedAt: string;
  expiresAt: string;
  startedAt?: string;
  endedAt?: string;
};

// on Patient:
deviceSupportSessions: DeviceSupportSession[];  // keep last ~10
```

Plus helpers `createDeviceSupportSession`, `markDeviceSupportStarted` (enforces
single use), `recordDeviceSupportOutcome`. Existing patients get the field via
the usual spread-with-default in `blankPatient` (state is per-session and
already tolerant of additive fields).

### 4.5 Modified: `agent/instructions.md`

New section **"Tasso+ device support (live video helper)"**:

- Trigger: patient mentions trouble with their Tasso/Tasso+ blood collection kit
  (device won't stick, no blood flowing, pressed the button twice, tube
  questions, "how do I use this thing"), or asks for help during an eMed/lab
  collection.
- First try one short text tip if the issue is trivial; if hands-on help would
  clearly be better (or they ask), call `start_device_support_session` and send
  the link with a one-line explanation: it opens a live voice + camera helper,
  works in their phone browser, and they should be seated with the kit in front
  of them.
- After the `[system] Device support session ended` message arrives: acknowledge
  the outcome, remind about same-day UPS shipping if collection completed, and
  log a check-in note. If outcome is `escalate` (e.g. prolonged bleeding,
  faintness, device failure), follow the existing Safety rules / consult Sage.
- Never send a support link for red-flag medical symptoms — those follow the
  HARD SAFETY RULES, not device troubleshooting.

### 4.6 New: browser page (inline in the channel, sourced from `agent/lib/device-support-page.ts`)

Single HTML document with inline JS (template string exported from a lib module
so the channel file stays readable). No bundler; the only external dependency is
the `@google/genai` browser build via ESM CDN import, or — to avoid CDN risk — a
hand-rolled WebSocket client speaking the documented Live API `v1alpha`
BidiGenerateContent protocol (ephemeral token passed as `access_token` query
param). **Decision: use the `@google/genai` ESM CDN build first** (fastest,
officially supported for ephemeral tokens); fall back to raw WS only if CSP/CDN
becomes a problem.

Page responsibilities:

- **Pre-flight screen**: what this is, "you'll need your Tasso+ kit", seated
  warning (fainting precaution from the IFU), Start button. Tapping Start calls
  `getUserMedia({ video: { facingMode: "environment" }, audio: true })`.
- **Audio in**: `AudioContext` + `AudioWorklet` downsampling mic to 16 kHz
  16-bit PCM chunks → `session.sendRealtimeInput({ audio })`.
- **Video in**: draw the camera `<video>` to a canvas, JPEG-encode at 1 FPS,
  `sendRealtimeInput({ video })`. Rear camera default (patient points phone at
  their arm), with a flip-camera button.
- **Audio out**: queue 24 kHz PCM from the model into `AudioContext` playback;
  handle barge-in via the API's `interrupted` signal (clear playback queue).
- **UI**: live caption strip from `outputAudioTranscription`, connection status,
  mute, flip camera, End session. Mobile-first single column; large tap targets
  (many users are older adults, and the PD instruction sheet audience has motor
  symptoms — big buttons, high contrast).
- **Session end**: an explicit End button, plus auto-teardown on `GoAway` /
  token expiry. Before closing, send a final text turn asking the model to emit
  a 1–2 sentence outcome summary tagged `completed | abandoned | escalate`
  (parsed from output transcription), then `POST /device-support/api/outcome`.
  If the parse fails, post `outcome: "abandoned", summary: null` — Scout just
  asks the patient how it went.
- **Failure paths**: permission denied → text instructions + Tasso phone support
  number (1-800-257-2370) and "go back to WhatsApp"; WS drop → auto-reconnect
  once via `sessionResumption` handle, then give up gracefully.

### 4.7 Config / dependencies

- `package.json`: add `@google/genai` (used server-side for `authTokens.create`;
  also the pinned version the page's CDN import should match).
- `.env.example` additions:

```bash
# Gemini Live device-support helper
GEMINI_API_KEY=
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview   # native-audio live model
PUBLIC_BASE_URL=            # e.g. https://steadfast-olive.vercel.app
DEVICE_SUPPORT_LINK_SECRET= # HMAC secret for one-time links
```

Note: the Live API + ephemeral tokens are **Preview** and `v1alpha` only; pin
the model via env so we can move when Google promotes/renames it.

## 5. Live assistant system instruction (grounded in the official IFU)

Source material (verified):
- [Tasso+ / Tasso Mini Instructions For Use (PN0897)](https://static1.squarespace.com/static/60da6eca05215e687a479088/t/67cb844f7ee9543f3f363ba2/1741390927569/Tasso%2B_DeviceFamilyInstructions.pdf)
- [Parkinson's Foundation PD GENEration Tasso+ guide](https://www.parkinson.org/sites/default/files/documents/Tasso-person-with-pd-instructions.pdf)
- [Product page](https://www.tassoinc.com/tasso-plus)

The prompt (in `tasso-live-prompt.ts`) will encode:

**Role & scope** — "You are the Tasso+ device helper on a live voice + video
call. You help with *using the device* only. You are not a clinician; you never
interpret results, diagnose, or give medical advice. Patient's name: {name}."

**Procedure knowledge (the 3 phases from the IFU):**

1. **Prepare** — wash hands; device goes on the *upper arm*, 2–3 finger widths
   below the shoulder; shave excess hair (adhesion failure is the top preventable
   error); twist cap off the compatible tube; press tube into device *fill lines
   facing out* until snug; activate heat pack (or use a warm hand) and rub the
   site for **2 minutes**; clean with alcohol pad and let dry; remove the clear
   cover from the red button.
2. **Collect** — peel adhesive tab, stick device to upper arm, hang arm straight
   down; press the button all the way down **ONCE for ~2 seconds** and release —
   never press twice; set a **5-minute timer**; blood may not appear for the
   first 1–2 minutes (reassure, keep arm hanging, stay relaxed); remove at 5
   minutes or earlier if blood reaches the top fill line; peel off from one side
   like a sticker; bandage vertically with slight pressure; twist-and-pull the
   tube off; snap the cap fully; **gently invert ~10 times** (never shake).
3. **Ship & dispose** — label the tube, bag it, box it, ship **same day** via
   UPS; lancet auto-retracts so the used device is safe for regular trash unless
   local rules say otherwise; wash hands.

**Vision behaviors** — use the camera actively: confirm device placement before
they press the button; check the tube's fill lines face outward; visually check
tube fill level against the top line during the 5-minute wait; spot adhesion
problems (hair, wet skin); confirm the cap is fully snapped.

**Troubleshooting playbook** — no blood after 2+ min (warm site longer, arm
lower, stay still; if a tremor is present, note collection may be slower — from
the PD guide); device won't stick (dry/shave site, fresh spot); pressed the
button twice or device already fired (single-use lancet — it cannot fire again;
if no/insufficient sample, the kit is spent: contact the kit provider / Tasso
support at **1-800-257-2370** for a replacement); tube half full at 5 minutes
(follow the kit's minimum-fill guidance; when unsure, cap and note it for the
lab).

**Hard safety rules (escalate + end)** — user feels faint/dizzy (sit or lie
down immediately — the IFU requires collecting while seated); bleeding that
doesn't stop with pressure (blood-thinner warning from the IFU); signs of skin
infection/broken skin at the site (do not collect there); any request for
medical interpretation → decline and defer to Scout/their clinician. In all of
these, tag the outcome `escalate` so Scout and (via Scout) Sage follow up.

**Style** — one step at a time; wait for visual/verbal confirmation before the
next step; short sentences; never rush the 2-minute warm or 5-minute fill
timers (offer to keep them company / count down).

## 6. Security & privacy

- **Real API key never leaves the server.** The browser only ever holds a
  single-use, ~30-minute ephemeral token locked to our model + prompt.
- **Link tokens** are HMAC-signed, patient-bound, expiring, single-use; the
  `live-token` endpoint is the consumption point. A forwarded/expired link shows
  a friendly "ask Scout for a fresh link" screen.
- **Prompt stays server-side** via `liveConnectConstraints` — the page receives
  only the opaque token.
- **Media**: camera/mic streams go browser → Google only; our backend never
  touches audio/video. Only the short outcome summary string is persisted (in
  patient state, alongside existing check-in data). State this on the pre-flight
  screen.
- **Rate limiting**: minting is bounded naturally (one mint per link, links only
  minted by Scout's tool); add a per-phone cap (e.g. 5 links/day) in the tool.
- **HTTPS** is required for `getUserMedia`; Vercel provides it. Local dev uses
  `eve dev` on localhost (exempt from the secure-context rule).

## 7. Implementation order

1. **Store + tool** — `DeviceSupportSession` state, link token helpers,
   `start_device_support_session` tool, `.env.example`, instructions.md update.
   Verifiable via `eve dev` + existing webhook flow (link appears in WhatsApp).
2. **Channel + token API** — `device-support.ts` channel: HTML shell route,
   `live-token` mint (against real Gemini API with a dev key), `outcome` route
   resuming the WhatsApp session. Verify token single-use/expiry with `curl`.
3. **Browser client** — media capture, Live API connect, audio pipeline,
   captions, end-of-session summary post. This is the bulk of the work and the
   main risk area (audio worklet resampling, iOS Safari autoplay/mic quirks).
4. **Prompt tuning** — iterate the Tasso system instruction against the real
   device flow (test with any small adhesive object + tube stand-in on camera).
5. **Polish** — reconnection via `sessionResumption`, escalation outcomes wired
   into Scout follow-ups, per-phone link cap, accessibility pass (font size,
   contrast, captions always on).

## 8. Risks & open questions

| Risk | Mitigation |
| --- | --- |
| Live API + ephemeral tokens are Preview (`v1alpha`); model names churn | Model + API version behind env vars; single lib module owns the mint call |
| iOS Safari audio quirks (AudioWorklet, autoplay, echo) | Start audio only from the user's tap; test matrix in step 3; echoCancellation on mic constraints |
| Vercel 60 s function limit | Irrelevant to the media path (client-to-server); mint + outcome calls are sub-second |
| Patient on WhatsApp desktop without camera | Page detects no camera and runs voice-only (Live API works audio-only); Scout's message says "open on your phone" |
| Model gives medical advice | Locked server-side prompt with hard refusal rules; `escalate` outcome path; page footer shows Tasso support phone + "return to WhatsApp" |
| Wassist can't send tappable URL buttons | Links go in plain message text (WhatsApp auto-links); acceptable |
| eMed integration is currently a seeded stand-in | Out of scope: this feature is device-usage support, not readings; no eMed coupling needed |

Open questions for product:
1. Should Sage automatically review every `escalate` outcome, or only when Scout
   judges it clinical? (Plan assumes: Scout applies existing "when to consult
   Sage" rules to the outcome summary.)
2. Session cap / cost budget per patient for Live API minutes?
3. Do we want input transcription stored (full transcript) or summary-only
   (current plan: summary-only, privacy-first)?
