# Slime Orb

A voice agent rendered as a slime: translucent and colour-shifting, with its
wobble, glow and hue drift driven by a live OpenAI Realtime call. You talk, it
talks back, and the surface moves with whichever of you is making sound.

## Run

```sh
git clone https://github.com/h1ddenpr0cess20/slimey
cd slimey
npm install
cp .env.example .env      # add your OPENAI_API_KEY
npm run dev               # → http://localhost:5173
```

Click the mic, allow the browser's microphone prompt, and start talking.

| Script | |
|---|---|
| `npm run dev` | Vite, with the proxy mounted as middleware — one process |
| `npm run dev:lan` | The same, over HTTPS on the network — for a phone |
| `npm run build` | Bundles the client to `dist/` |
| `npm start` | Serves `dist/` with the same proxy in front |
| `npm run preview` | `build` then `start` |
| `npm run preview:lan` | `build` then `start`, over HTTPS on the network |
| `npm test` | `node:test` over the server |
| `npm run lint` | ESLint |

CI runs the lint, the tests on Node 22.12 and 24, and a build that then has to
boot and serve itself over both HTTP and HTTPS.

## Configuration

Both `npm run dev` and `npm start` read `.env`.

| Variable | Default | Role |
|---|---|---|
| `OPENAI_API_KEY` | — | Required. Stays in the Node process. |
| `OPENAI_VOICE` | `ballad` | Which voice the picker opens on (`ballad`, `marin`, `cedar`, `verse`, …) |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` | Preselected in the picker when the key can reach it |
| `OPENAI_BASE_URL` | OpenAI | Points the proxy at a gateway or a stub |
| `PORT` | `5173` | |
| `SSL_KEY`, `SSL_CERT` | — | Paths to a real certificate; `npm start` then serves HTTPS |

### On a phone

```sh
npm run dev:lan           # → https://192.168.x.x:5173, printed on start
```

Microphone access needs a secure context. `localhost` is one; a LAN address over
plain HTTP is not — `navigator.mediaDevices` doesn't exist there, so the page
can't even raise the mic prompt. The `:lan` scripts serve HTTPS with a
self-signed certificate.

No browser trusts that certificate, so the phone shows a warning the first time
("Advanced" → proceed on Chrome, "Show details" → "visit this website" on
Safari). Tap through it once per device. The certificate is cached in
`node_modules/.vite/` and shared by both `:lan` scripts.

To skip the warning, bring a certificate the device already trusts —
[mkcert](https://github.com/FiloSottile/mkcert) issues one for a LAN IP — and
point `SSL_KEY` and `SSL_CERT` at it. `npm start` then serves HTTPS without the
`--https` flag.

## Docker

```sh
docker run --rm -p 5173:5173 -e OPENAI_API_KEY=sk-... h1ddenpr0cess20/slimey
```

Images go to Docker Hub on every push to `main` (`latest`) and on `v*` tags
(`1.2.3`, `1.2`), built for `linux/amd64` and `linux/arm64`. Configuration is the
same set of variables as `.env` — pass them with `-e` or `--env-file .env`.

The container serves HTTP on `PORT` (5173 by default) and expects TLS to be
terminated in front of it. To serve TLS from the container instead, mount a
certificate and point `SSL_KEY` and `SSL_CERT` at it; the self-signed `--https`
path needs a devDependency that the production image doesn't carry.

To build it yourself:

```sh
docker build -t slimey .
```

Publishing from a fork needs a `DOCKERHUB_TOKEN` repository secret, plus a
`DOCKERHUB_USERNAME` repository variable if your Docker Hub account isn't
`h1ddenpr0cess20`.

## How the call is wired

The API key never reaches the browser, and the audio never reaches the proxy:

1. The page asks `POST /api/session` for a client secret, naming the model and
   voice it wants. The proxy mints one from `/v1/realtime/client_secrets` with
   the persona, voice and turn detection already attached, valid for ten minutes.
2. The page opens an `RTCPeerConnection`, adds the mic track, and POSTs its SDP
   offer straight to `/v1/realtime/calls` with that secret.
3. Audio flows browser ↔ OpenAI over WebRTC. Events flow over an `oai-events`
   data channel alongside it.

Turn-taking is server-side semantic VAD, so barge-in is free: speak over the
slime and the model truncates its own playback. `Escape` cancels the current
response for the typed path.

The picker lists every realtime model the key can reach, minus the ones that
can't hold a conversation — the `translate` and `whisper` tiers are streaming
translation and speech-to-text.

Both pickers are pinned into the client secret, so changing the model or the
voice mid-call hangs up and dials again. The conversation doesn't carry over,
since the new voice has no memory of what the old one said.

The proxy is connect-style middleware rather than a server, so there's only one
implementation of `/api/*`: `vite.config.js` mounts it in development and
`src/server/app.js` mounts it in front of the static handler in production. No
second process, and the key lives in one place either way.

## Tools — not yet

The slime has no tools. It answers from what the model already knows: no web
search, no retrieval, no function calls. Ask it about this morning and it should
say it doesn't know, which is what the system prompt asks for.

That's a choice rather than a limitation. A realtime session takes tools two
ways, and both are cheap here:

- **Function tools**, which we execute — declare them in `session.tools`, handle
  `response.function_call_arguments.done` on the data channel, and post a
  `function_call_output` back.
- **Remote MCP servers**, which the Realtime API executes itself. Point
  `session.tools` at a server URL and its tools are live. Anything needing auth
  headers belongs in the server-side `/v1/realtime/client_secrets` payload, which
  is where `sessionConfig()` already lives — a few lines in
  `src/server/persona.js` and nothing in the page.

The plan is to pick this up when GPT-Live reaches the API and move onto that at
the same time, rather than fitting tools to a pipeline that's due to be replaced.

## Layout

```
Dockerfile              Build the client, then serve it from src/server
index.html              Markup only — Vite's entry
src/
  client/
    main.js             The wiring, and nothing else
    styles.css          The HUD around the orb
    api.js              The proxy's two endpoints, as functions
    orb/                Geometry and animation. Knows nothing about transports
      index.js            The controller and the per-frame loop
      modes.js            Targets per conversational state
      parts.js            Shell, core, glow, bubbles
      deform.js           The displacement kernel both surfaces run
      lobes.js            The directional sines that make it bulge
      palette.js          The colours it drifts through
      environment.js      Studio env map, so the shell has something to refract
    session/            The call. Emits transport-agnostic events
      index.js            Lifecycle: mic, secret, connect, meter, tear down
      webrtc.js           Peer connection, data channel, SDP handshake
      events.js           Realtime server events → this vocabulary
      metering.js         Two analysers → one 0..1 number per frame
      emitter.js
    ui/
      hud.js              Status chip, transcript, caption
      controls.js         Mic, text field, send, pickers
      viewport.js         Keeps the composer above the on-screen keyboard
    vendor/
      three-d-stage.js    Starter component (renderer, lighting, camera, controls)
  server/
    index.js            Entry point
    app.js              The middleware chain
    api.js              /api/models + /api/session
    openai.js           The two calls it makes
    persona.js          Who the slime is, and the session config
    config.js           The environment, resolved once
    static.js           Hosting for dist/ — production only
test/                   node:test, against a stub OpenAI
.github/workflows/      CI (lint, tests, build smoke test) and the Docker publish
```

`src/client/vendor/three-d-stage.js` is a copied starter component with two
local changes, listed at the top of the file — re-copying it drops them.

## States

`idle` · `listening` · `thinking` · `speaking` — each a set of targets for
wobble amplitude, lobe speed, hue drift, breathing, spin, core glow and rim halo.
The orb eases between them, so transitions read as the same creature changing
mood rather than a cut.

The call maps onto them directly: `listening` from `speech_started` and between
turns, `thinking` from `speech_stopped` until the first audio frame, `speaking`
while the model's track is live, `idle` when there is no call.

## The transport seam

`session/index.js` exposes `on`, `start`, `stop`, `send`, `cancel`, `messages`,
`connected`, `busy`, `stale`, `state`, `model`, `voice` — and emits:

```
'state'  listening | thinking | speaking | idle
'text'   a chunk of assistant transcript
'user'   a completed transcript of what the person said
'level'  0..1 sustained amplitude, per frame
'pulse'  0..1 transient, one per discrete event
'busy'   whether a response is in flight
'done'   { model, usage }
'error'  { message }
```

The orb takes audio-shaped input:

```js
orb.setState('speaking')  // idle | listening | thinking | speaking
orb.setLevel(0.62)        // sustained amplitude 0..1, sampled per frame
orb.pulse(0.4)            // transient impulse 0..1, one per discrete event
```

Both land on the same internal energy value. `setLevel` carries the voice — two
`AnalyserNode`s, one on the mic and one on the model's track, read per frame and
smoothed with a fast attack and a slow release. `pulse` is for the beats where a
turn changes hands, so the wobble punctuates instead of strobing.

Swapping providers means writing a different `createVoiceSession()` with that
surface. `main.js` and the orb don't change.
