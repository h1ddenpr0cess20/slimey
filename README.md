# Slime Orb

A voice agent with a face: a translucent colour-shifting slime whose deformation,
glow and colour drift are driven by a live OpenAI Realtime call. You talk, it
talks back, and the surface moves with whichever of you is making sound.

## Run

```sh
export OPENAI_API_KEY=sk-...
npm start          # → http://localhost:5173
```

No dependencies — the proxy is plain `node:http` and `fetch`, so Node 18+ is all
it needs. Click the mic, allow the browser's microphone prompt, and start talking.

| Variable | Default | Role |
|---|---|---|
| `OPENAI_API_KEY` | — | Required. Stays in the Node process. |
| `OPENAI_VOICE` | `ballad` | Which voice the picker opens on (`ballad`, `marin`, `cedar`, `verse`, …) |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Preselected in the picker when the key can reach it |
| `PORT` | `5173` | |

`three.js` loads from unpkg via the pinned import map, so the page needs network
access on first load.

## How the call is wired

The API key never reaches the browser, but the audio never reaches the proxy either:

1. The page asks `POST /api/session` for a client secret, naming the model and
   voice it wants. The proxy mints one from `/v1/realtime/client_secrets` with the
   persona, voice and turn detection already attached, valid for ten minutes.
2. The page opens an `RTCPeerConnection`, adds the mic track, and POSTs its SDP
   offer straight to `/v1/realtime/calls` with that secret.
3. Audio flows browser ↔ OpenAI over WebRTC. Events flow over an `oai-events`
   data channel alongside it.

Turn-taking is server-side semantic VAD, so barge-in is free: speak over the slime
and the model truncates its own playback. `Escape` cancels the current response
for the typed path.

Both pickers are pinned into that secret, so changing the model or the voice
mid-call hangs up and dials again — the conversation doesn't carry over, since the
new voice has no memory of what the old one said. `OPENAI_BASE_URL` redirects the
proxy at a gateway or a stub if you need one.

## Tools — not yet

The slime has no tools. It answers from what the model already knows: no web
search, no retrieval, no function calls. Ask it about this morning and it should
tell you it doesn't know, which is the behaviour the system prompt asks for.

That's deliberate for now. A realtime session can only call functions you define
yourself — OpenAI's hosted web search is a Responses API tool and isn't reachable
from a realtime call — so wiring search today means declaring the tool, handling
`response.function_call_arguments.done` on the data channel, running the query
server-side, and posting a `function_call_output` back. Doable, but it's a real
subsystem and it would need a search backend chosen for it.

**The plan: pick this up when gpt-live is available and we move onto it.** If it
brings hosted tools to a live session, most of the above collapses into session
config and the work is worth doing then rather than twice.

## Layout

| File | Role |
|---|---|
| `slime-orb.html` | Markup, styles, and the wiring between session and orb |
| `orb.js` | The orb. Owns all geometry and animation; knows nothing about transports |
| `session.js` | The call. Owns the peer connection, emits transport-agnostic events |
| `server.js` | Static host + `/api/models` + `/api/session` |
| `three-d-stage.js` | Unmodified starter component (renderer, lighting, camera, controls) |

## States

`idle` · `listening` · `thinking` · `speaking` — each a set of targets for wobble
amplitude, lobe speed, hue drift, breathing, spin, core glow and rim halo. The orb
eases between them, so transitions read as the same creature changing mood rather
than a cut.

The call maps onto them directly: `listening` from `speech_started` and between
turns, `thinking` from `speech_stopped` until the first audio frame, `speaking`
while the model's track is live, `idle` when there is no call.

## The transport seam

`session.js` exposes `on`, `start`, `stop`, `send`, `cancel`, `messages`,
`connected`, `busy`, `state`, `model` — and emits:

```
'state'  listening | thinking | speaking | idle
'text'   a chunk of assistant transcript
'user'   a completed transcript of what the person said
'level'  0..1 sustained amplitude, per frame
'pulse'  0..1 transient, one per discrete event
'done'   { model, usage }
'error'  { message }
```

The orb takes audio-shaped input, which is the whole point of the split:

```js
orb.setState('speaking')  // idle | listening | thinking | speaking
orb.setLevel(0.62)        // sustained amplitude 0..1, sampled per frame
orb.pulse(0.4)            // transient impulse 0..1, one per discrete event
```

Both land on the same internal energy value. `setLevel` carries the voice —
two `AnalyserNode`s, one on the mic and one on the model's track, read per frame
and smoothed with a fast attack and a slow release. `pulse` is left for the beats
where a turn changes hands, so the wobble punctuates instead of strobing.

Swapping providers means writing a different `create*Session()` with that surface.
The page's wiring block and the orb do not change.
