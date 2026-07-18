/**
 * Single-file HTML + JS for the Tasso+ Gemini Live helper.
 * Served by GET /eve/v1/device-support — no bundler, no CDN dependency for the Live client.
 */

export function renderDeviceSupportPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>Tasso+ live helper</title>
  <style>
    :root {
      --bg0: #e8f1f0;
      --bg1: #f7f3ea;
      --ink: #1a2e2b;
      --muted: #4d635f;
      --accent: #0d6e63;
      --accent-ink: #ffffff;
      --danger: #9b2c2c;
      --panel: rgba(255, 255, 255, 0.82);
      --line: rgba(26, 46, 43, 0.12);
      --shadow: 0 18px 50px rgba(26, 46, 43, 0.12);
      --font: "Segoe UI", "Avenir Next", "Helvetica Neue", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; min-height: 100%;
      font-family: var(--font);
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 10% -10%, #cfe8e3 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #f0e2c8 0%, transparent 50%),
        linear-gradient(180deg, var(--bg0), var(--bg1));
    }
    body { display: flex; flex-direction: column; min-height: 100dvh; }
    header {
      padding: 1.25rem 1.25rem 0.5rem;
    }
    header .brand {
      font-size: clamp(1.6rem, 5vw, 2.1rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    header p {
      margin: 0.45rem 0 0;
      color: var(--muted);
      font-size: 1rem;
      max-width: 34rem;
      line-height: 1.45;
    }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 0.75rem 1.25rem 1.5rem;
    }
    .stage {
      position: relative;
      width: 100%;
      aspect-ratio: 3 / 4;
      max-height: min(58dvh, 560px);
      border-radius: 1.25rem;
      overflow: hidden;
      background: #10221f;
      box-shadow: var(--shadow);
    }
    video#preview {
      width: 100%; height: 100%;
      object-fit: cover;
      transform: scaleX(1);
      background: #10221f;
    }
    .overlay {
      position: absolute; inset: auto 0 0 0;
      padding: 1rem 1.1rem 1.15rem;
      background: linear-gradient(transparent, rgba(8, 20, 18, 0.82));
      color: #f4faf8;
    }
    #status {
      font-size: 0.85rem;
      opacity: 0.9;
      margin-bottom: 0.35rem;
    }
    #status.speaking::before {
      content: "";
      display: inline-block;
      width: 0.55rem; height: 0.55rem;
      margin-right: 0.4rem;
      border-radius: 50%;
      background: #6ee7b7;
      box-shadow: 0 0 0 0 rgba(110, 231, 183, 0.7);
      animation: pulse 1.2s ease-out infinite;
      vertical-align: middle;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(110, 231, 183, 0.7); }
      70% { box-shadow: 0 0 0 8px rgba(110, 231, 183, 0); }
      100% { box-shadow: 0 0 0 0 rgba(110, 231, 183, 0); }
    }
    #captions {
      font-size: 1.05rem;
      line-height: 1.35;
      min-height: 2.7em;
      font-weight: 560;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 1.1rem;
      padding: 1.1rem 1.15rem;
      backdrop-filter: blur(10px);
    }
    .panel h2 {
      margin: 0 0 0.45rem;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .panel p, .panel li {
      margin: 0;
      color: var(--muted);
      line-height: 1.45;
      font-size: 0.98rem;
    }
    .panel ul {
      margin: 0.65rem 0 0;
      padding-left: 1.15rem;
    }
    .panel li + li { margin-top: 0.35rem; }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      margin-top: 0.25rem;
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 0.9rem;
      padding: 0.95rem 1.2rem;
      font: inherit;
      font-weight: 650;
      font-size: 1.05rem;
      cursor: pointer;
      min-height: 3.2rem;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .primary {
      background: var(--accent);
      color: var(--accent-ink);
      flex: 1 1 12rem;
    }
    .secondary {
      background: #ffffff;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .danger {
      background: var(--danger);
      color: #fff;
    }
    .hidden { display: none !important; }
    footer {
      padding: 0 1.25rem 1.35rem;
      color: var(--muted);
      font-size: 0.85rem;
      line-height: 1.4;
    }
    footer a { color: var(--accent); }
    #error {
      color: var(--danger);
      font-weight: 600;
      margin-top: 0.75rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">Tasso+ live helper</div>
    <p>Voice + camera support for your at-home blood collection. Sit down, keep your kit nearby, and open this on your phone.</p>
  </header>

  <main>
    <section id="intro" class="panel">
      <h2>Before you start</h2>
      <ul>
        <li>Stay seated — blood collection can make some people feel faint.</li>
        <li>Allow camera and microphone when prompted so the helper can see your device.</li>
        <li>Audio and video go to Google Gemini for this live session only. We keep a short summary for Scout on WhatsApp.</li>
      </ul>
      <p id="error" class="hidden"></p>
      <div class="actions" style="margin-top:1rem">
        <button id="startBtn" class="primary" type="button">Start live help</button>
      </div>
    </section>

    <section id="live" class="hidden">
      <div class="stage">
        <video id="preview" playsinline muted autoplay></video>
        <div class="overlay">
          <div id="status">Connecting…</div>
          <div id="captions">The helper will speak here in captions.</div>
        </div>
      </div>
      <div class="actions">
        <button id="muteBtn" class="secondary" type="button">Mute mic</button>
        <button id="flipBtn" class="secondary" type="button">Flip camera</button>
        <button id="endBtn" class="danger" type="button">End session</button>
      </div>
    </section>

    <section id="done" class="panel hidden">
      <h2 id="doneTitle">Session ended</h2>
      <p id="doneBody">You can close this tab and return to WhatsApp — Scout will follow up.</p>
      <div class="actions" style="margin-top:1rem">
        <button id="againBtn" class="secondary" type="button">Ask Scout for a new link</button>
      </div>
    </section>
  </main>

  <footer>
    Device help only — not medical advice.
    Tasso support: <a href="tel:18002572370">1-800-257-2370</a>.
    Return to WhatsApp Scout for health questions.
  </footer>

  <script>
(function () {
  const params = new URLSearchParams(location.search);
  const linkToken = params.get("t") || "";

  const intro = document.getElementById("intro");
  const live = document.getElementById("live");
  const done = document.getElementById("done");
  const errorEl = document.getElementById("error");
  const statusEl = document.getElementById("status");
  const captionsEl = document.getElementById("captions");
  const preview = document.getElementById("preview");
  const startBtn = document.getElementById("startBtn");
  const muteBtn = document.getElementById("muteBtn");
  const flipBtn = document.getElementById("flipBtn");
  const endBtn = document.getElementById("endBtn");
  const againBtn = document.getElementById("againBtn");
  const doneTitle = document.getElementById("doneTitle");
  const doneBody = document.getElementById("doneBody");

  if (!linkToken) {
    showError("This link is missing its access token. Ask Scout on WhatsApp for a fresh device-help link.");
    startBtn.disabled = true;
  }

  let ws = null;
  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let sourceNode = null;
  let playbackTime = 0;
  let playbackCtx = null;
  let facingMode = "environment";
  let muted = false;
  let setupComplete = false;
  let ending = false;
  let outcomePosted = false;
  let frameTimer = null;
  let model = "";
  let captionBuffer = "";
  let lastOutcomeTag = null;
  let inputSampleRate = 16000;

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  }

  function setStatus(msg, opts) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("speaking", !!(opts && opts.speaking));
  }

  function setCaptions(msg) {
    captionsEl.textContent = msg || "";
  }

  function showDone(title, body) {
    intro.classList.add("hidden");
    live.classList.add("hidden");
    done.classList.remove("hidden");
    doneTitle.textContent = title;
    doneBody.textContent = body;
  }

  startBtn.addEventListener("click", () => startSession().catch((err) => {
    console.error(err);
    showError(err.message || "Could not start the live session.");
    teardownMedia();
  }));

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    if (mediaStream) {
      for (const track of mediaStream.getAudioTracks()) track.enabled = !muted;
    }
    muteBtn.textContent = muted ? "Unmute mic" : "Mute mic";
  });

  flipBtn.addEventListener("click", () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    restartCamera().catch((err) => console.warn("flip failed", err));
  });

  endBtn.addEventListener("click", () => endSession("abandoned"));
  againBtn.addEventListener("click", () => {
    doneBody.textContent = "Close this tab and message Scout on WhatsApp for a new live-help link.";
  });

  async function startSession() {
    showError("");
    startBtn.disabled = true;
    setStatus("Requesting camera and microphone…");
    intro.classList.add("hidden");
    live.classList.remove("hidden");

    await ensureMedia();

    setStatus("Getting secure session…");
    const tokenRes = await fetch("/eve/v1/device-support/api/live-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: linkToken }),
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      const err = tokenJson.error || ("token_failed_" + tokenRes.status);
      if (err === "expired" || err === "already_used") {
        showDone("Link no longer valid", "Ask Scout on WhatsApp for a fresh Tasso+ live-help link.");
        return;
      }
      if (err === "rate_limited" || tokenRes.status === 429) {
        showDone(
          "Live helper is busy",
          tokenJson.message ||
            "Google rate-limited this project (429). Wait about a minute, then ask Scout on WhatsApp for a fresh link.",
        );
        return;
      }
      throw new Error(tokenJson.message || ("Could not start live session (" + err + ")."));
    }

    model = tokenJson.model;
    const ephemeral = tokenJson.token;
    setStatus("Connecting to live helper…");
    await connectLive(ephemeral, model);
  }

  async function ensureMedia() {
    if (mediaStream) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
        video: {
          facingMode,
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
      });
    } catch (err) {
      // Voice-only fallback
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
          video: false,
        });
        setCaptions("Camera unavailable — continuing with voice only. Describe what you see.");
      } catch (err2) {
        throw new Error("Camera/microphone permission is required. Enable access and reload, or return to WhatsApp.");
      }
    }
    preview.srcObject = mediaStream;
    await preview.play().catch(() => {});
  }

  async function restartCamera() {
    if (!mediaStream) return;
    for (const track of mediaStream.getVideoTracks()) track.stop();
    const fresh = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 720 }, height: { ideal: 1280 } },
      audio: false,
    });
    const videoTrack = fresh.getVideoTracks()[0];
    mediaStream.addTrack(videoTrack);
    // Remove old ended video tracks
    for (const track of mediaStream.getVideoTracks()) {
      if (track !== videoTrack && track.readyState !== "live") {
        mediaStream.removeTrack(track);
      }
    }
    // Replace any previous live video tracks
    for (const track of mediaStream.getVideoTracks()) {
      if (track !== videoTrack) {
        track.stop();
        mediaStream.removeTrack(track);
      }
    }
    preview.srcObject = mediaStream;
  }

  function connectLive(ephemeralToken, modelName) {
    return new Promise((resolve, reject) => {
      // Do NOT encodeURIComponent the token: Google's gateway requires a literal
      // slash in auth_tokens/<id>. Encoding it as %2F breaks the handshake so
      // setupComplete never arrives (camera preview still works locally).
      const url =
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        ephemeralToken;

      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        clearTimeout(setupTimer);
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        clearTimeout(setupTimer);
        resolve();
      };

      const openTimer = setTimeout(() => {
        fail(new Error("Timed out connecting to the live helper."));
        try { ws.close(); } catch (_) {}
      }, 15000);

      const setupTimer = setTimeout(() => {
        fail(new Error("Live helper connected but never became ready. Try a fresh link."));
        try { ws.close(); } catch (_) {}
      }, 20000);

      ws.onopen = () => {
        clearTimeout(openTimer);
        // Config (system instruction, modalities, transcription) is locked in the
        // ephemeral token via liveConnectConstraints — send model only.
        const modelPath = modelName.startsWith("models/") ? modelName : ("models/" + modelName);
        ws.send(JSON.stringify({
          setup: {
            model: modelPath,
          },
        }));
      };

      ws.onmessage = async (ev) => {
        let msg;
        try {
          const text = typeof ev.data === "string" ? ev.data : await ev.data.text();
          msg = JSON.parse(text);
        } catch (err) {
          console.warn("bad ws message", err);
          return;
        }

        if (msg.setupComplete) {
          setupComplete = true;
          setStatus("Live — speak naturally, show the device on camera");
          startAudioPipeline().then(() => {
            // Nudge the model to greet and begin (Gemini 3.1: realtimeInput for live text).
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                realtimeInput: {
                  text: "Please greet me briefly and help me use my Tasso+ blood collection device. Ask me to show the kit on camera.",
                },
              }));
            }
            startVideoPipeline();
            succeed();
          }).catch((err) => {
            console.error("audio pipeline failed", err);
            fail(err);
          });
          return;
        }

        if (msg.serverContent) {
          handleServerContent(msg.serverContent);
        }
        if (msg.goAway) {
          setStatus("Session wrapping up…");
          endSession(lastOutcomeTag || "abandoned");
        }
      };

      ws.onerror = () => {
        if (!setupComplete) fail(new Error("Live connection failed. Check your network and try a fresh link."));
      };

      ws.onclose = (ev) => {
        if (!ending && !setupComplete) {
          const reason = (ev && ev.reason) ? String(ev.reason) : "";
          const code = ev && ev.code;
          if (code === 1008 || /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(reason)) {
            fail(new Error("Live helper rate-limited by Google (429). Wait a minute and ask Scout for a fresh link."));
            return;
          }
          fail(new Error("Live connection closed before ready (" + (reason || ("code " + code)) + "). Try a fresh link."));
          return;
        }
        if (!ending && setupComplete) {
          endSession(lastOutcomeTag || "abandoned");
        }
      };
    });
  }

  function handleServerContent(content) {
    if (content.interrupted) {
      stopPlayback();
      setStatus("Live — speak naturally, show the device on camera");
    }

    const parts = content.modelTurn && content.modelTurn.parts ? content.modelTurn.parts : [];
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        const mime = part.inlineData.mimeType || "audio/pcm;rate=24000";
        setStatus("Helper speaking…", { speaking: true });
        playPcmChunk(part.inlineData.data, mime);
      }
      if (part.text) {
        captionBuffer += part.text;
        setCaptions(captionBuffer.trim());
        detectOutcome(captionBuffer);
      }
    }

    if (content.outputTranscription && content.outputTranscription.text) {
      captionBuffer += content.outputTranscription.text;
      setCaptions(captionBuffer.trim());
      detectOutcome(captionBuffer);
      setStatus("Helper speaking…", { speaking: true });
    }

    if (content.turnComplete) {
      setStatus("Live — speak naturally, show the device on camera");
      // Keep a rolling caption window
      if (captionBuffer.length > 500) {
        captionBuffer = captionBuffer.slice(-400);
      }
    }
  }

  function detectOutcome(text) {
    const m = String(text).match(/OUTCOME:(completed|abandoned|escalate)/i);
    if (m) lastOutcomeTag = m[1].toLowerCase();
  }

  async function startAudioPipeline() {
    if (!mediaStream) return;
    // Prefer 16 kHz, but browsers often ignore the hint and stay at 48 kHz.
    // Always label outgoing PCM with the context's actual rate (or downsample).
    audioContext = new AudioContext({ sampleRate: 16000 });
    if (audioContext.state === "suspended") await audioContext.resume();
    playbackCtx = playbackCtx || new AudioContext({ sampleRate: 24000 });
    if (playbackCtx.state === "suspended") await playbackCtx.resume();

    inputSampleRate = audioContext.sampleRate || 16000;
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // ScriptProcessor is deprecated but available without worklet bundling.
    const bufferSize = 4096;
    processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    processor.onaudioprocess = (event) => {
      // Mute processor output — connecting to destination without this plays
      // the mic through the speaker, which barge-in-interrupts the model forever.
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);

      if (!ws || ws.readyState !== WebSocket.OPEN || !setupComplete || muted || ending) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = downsampleTo16k(input, inputSampleRate);
      if (!pcm || pcm.length === 0) return;
      const b64 = int16ToBase64(pcm);
      ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: b64,
            mimeType: "audio/pcm;rate=16000",
          },
        },
      }));
    };
    sourceNode.connect(processor);
    // Keep the graph alive but silent (required for ScriptProcessor to fire).
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    processor.connect(gain);
    gain.connect(audioContext.destination);
  }

  function startVideoPipeline() {
    if (frameTimer) clearInterval(frameTimer);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    frameTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !setupComplete || ending) return;
      if (!preview.videoWidth) return;
      const w = 640;
      const h = Math.round((preview.videoHeight / preview.videoWidth) * w) || 480;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(preview, 0, 0, w, h);
      canvas.toBlob(async (blob) => {
        if (!blob || !ws || ws.readyState !== WebSocket.OPEN) return;
        const buf = await blob.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        ws.send(JSON.stringify({
          realtimeInput: {
            video: {
              data: b64,
              mimeType: "image/jpeg",
            },
          },
        }));
      }, "image/jpeg", 0.7);
    }, 1000);
  }

  /** Linear-resample float32 PCM to 16 kHz Int16 when the AudioContext isn't 16 kHz. */
  function downsampleTo16k(float32, fromRate) {
    const target = 16000;
    if (!fromRate || fromRate === target) {
      return floatTo16BitPCM(float32);
    }
    const ratio = fromRate / target;
    const newLen = Math.max(1, Math.floor(float32.length / ratio));
    const down = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, float32.length - 1);
      const frac = idx - i0;
      down[i] = float32[i0] * (1 - frac) + float32[i1] * frac;
    }
    return floatTo16BitPCM(down);
  }

  function floatTo16BitPCM(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function int16ToBase64(int16) {
    // Use the Int16 view's exact byte range — .buffer alone can include padding.
    return arrayBufferToBase64(int16.buffer.slice(int16.byteOffset, int16.byteOffset + int16.byteLength));
  }

  function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function playPcmChunk(b64, mime) {
    try {
      if (!playbackCtx) playbackCtx = new AudioContext({ sampleRate: 24000 });
      if (playbackCtx.state === "suspended") playbackCtx.resume();
      const rateMatch = /rate=(\\d+)/.exec(mime || "");
      const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
      const pcm = new Int16Array(base64ToArrayBuffer(b64));
      const float32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) float32[i] = pcm[i] / 0x8000;
      const buffer = playbackCtx.createBuffer(1, float32.length, sampleRate);
      buffer.copyToChannel(float32, 0);
      const src = playbackCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(playbackCtx.destination);
      const now = playbackCtx.currentTime;
      if (playbackTime < now) playbackTime = now + 0.05;
      src.start(playbackTime);
      playbackTime += buffer.duration;
    } catch (err) {
      console.warn("playback error", err);
    }
  }

  function stopPlayback() {
    playbackTime = playbackCtx ? playbackCtx.currentTime : 0;
  }

  async function endSession(outcome) {
    if (ending) return;
    ending = true;
    setStatus("Ending session…");

    // Ask model for a final tagged summary if still connected.
    // Gemini 3.1: use realtimeInput for mid-session text (clientContent is history-only).
    if (ws && ws.readyState === WebSocket.OPEN && setupComplete) {
      try {
        ws.send(JSON.stringify({
          realtimeInput: {
            text: "Please wrap up in one short sentence for Scout, ending with OUTCOME:completed or OUTCOME:abandoned or OUTCOME:escalate.",
          },
        }));
        await wait(1200);
      } catch (_) {}
    }

    const finalOutcome = lastOutcomeTag || outcome || "abandoned";
    const summary = (captionBuffer || "").trim().slice(-400) || null;
    await postOutcome(finalOutcome, summary);
    teardownMedia();
    try { if (ws) ws.close(); } catch (_) {}
    ws = null;

    const titles = {
      completed: "Nice work",
      escalate: "Please return to WhatsApp",
      abandoned: "Session ended",
    };
    const bodies = {
      completed: "Collection help finished. Return to WhatsApp — Scout will remind you about same-day shipping if needed.",
      escalate: "Please go back to WhatsApp Scout now. If you feel unwell, seek emergency care.",
      abandoned: "You can close this tab and message Scout on WhatsApp if you want another live-help link.",
    };
    showDone(titles[finalOutcome] || titles.abandoned, bodies[finalOutcome] || bodies.abandoned);
  }

  async function postOutcome(outcome, summary) {
    if (outcomePosted) return;
    outcomePosted = true;
    try {
      await fetch("/eve/v1/device-support/api/outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          t: linkToken,
          outcome,
          summary,
        }),
        keepalive: true,
      });
    } catch (err) {
      console.warn("outcome post failed", err);
    }
  }

  function teardownMedia() {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
    try {
      if (processor) processor.disconnect();
      if (sourceNode) sourceNode.disconnect();
      if (audioContext) audioContext.close();
    } catch (_) {}
    processor = null;
    sourceNode = null;
    audioContext = null;
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) track.stop();
      mediaStream = null;
    }
    preview.srcObject = null;
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  window.addEventListener("pagehide", () => {
    if (setupComplete && !outcomePosted) {
      postOutcome(lastOutcomeTag || "abandoned", (captionBuffer || "").trim().slice(-400) || null);
    }
  });
})();
  </script>
</body>
</html>`;
}
