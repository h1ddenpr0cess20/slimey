# Slime Orb

An AI assistant avatar: a translucent colour-shifting slime whose deformation,
glow and colour drift are driven by a live Claude Messages stream.

## Run

```sh
npm install
npm start          # → http://localhost:5173
```

Credentials resolve the way every Anthropic SDK resolves them — `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile. Nothing else to configure.
The key stays in the Node process; the browser only ever talks to the proxy.

`three.js` loads from unpkg via the pinned import map, so the page needs network
access on first load.

## Layout

| File | Role |
|---|---|
| `slime-orb.html` | Markup, styles, and the wiring between session and orb |
| `orb.js` | The orb. Owns all geometry and animation; knows nothing about transports |
| `session.js` | Conversation transport. Owns history, emits transport-agnostic events |
| `server.js` | Static host + `/api/models` + `/api/chat` (SSE) |
| `three-d-stage.js` | Unmodified starter component (renderer, lighting, camera, controls) |

## States

`idle` · `listening` · `thinking` · `speaking` — each a set of targets for wobble
amplitude, lobe speed, hue drift, breathing, spin, core glow and rim halo. The orb
eases between them, so transitions read as the same creature changing mood rather
than a cut.

## Swapping in voice

The orb takes audio-shaped input already, which is the whole point of the split:

```js
orb.setState('speaking')  // idle | listening | thinking | speaking
orb.setLevel(0.62)        // sustained amplitude 0..1, sampled per frame
orb.pulse(0.4)            // transient impulse 0..1, one per discrete event
```

Text drives `pulse`, because tokens are discrete. Audio drives `setLevel`, because
waveforms are continuous. Both land on the same internal energy value, so the
surface deforms identically either way.

To go voice, write a `createVoiceSession()` with the same surface as
`createTextSession()` — `on`, `send`, `cancel`, `messages`, `busy`, `model` — plus
`start()` / `stop()`, and emit:

- `'level'` from a mic `AnalyserNode` while listening, and from the TTS
  `AnalyserNode` while speaking
- `'state'`, `'text'`, `'done'`, `'error'` exactly as the text session does

`slime-orb.html` already subscribes to `'level'`, and `session.cancel()` already
aborts the proxy's upstream request, which is the barge-in path. The wiring block
in the page should not need to change.
