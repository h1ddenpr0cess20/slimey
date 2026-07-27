/**
 * Conversation transport — the voice pipeline.
 *
 * A session owns the call and emits a small, transport-agnostic event
 * vocabulary. The page wires those events to the orb once; the orb never learns
 * what a WebRTC peer connection is.
 *
 *   'state'  'listening' | 'thinking' | 'speaking' | 'idle'
 *   'text'   a chunk of assistant transcript (rendered as caption)
 *   'user'   a completed transcript of what the person said
 *   'level'  0..1 sustained amplitude — mic while listening, model while speaking
 *   'pulse'  0..1 transient — a discrete event worth a wobble
 *   'done'   { model, usage }
 *   'error'  { message }
 *
 * Swapping providers means writing a different module with this surface. The
 * page's wiring block and the orb do not change.
 *
 * Audio never touches the proxy. `/api/session` mints an ephemeral client
 * secret, the browser negotiates SDP with OpenAI directly, and the mic and the
 * model's voice both terminate here in the page.
 */

import { fetchClientSecret } from '../api.js';
import { createEmitter } from './emitter.js';
import { createEventHandler } from './events.js';
import { createAnalyser, createMeter } from './metering.js';
import { connect } from './webrtc.js';

const MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

export function createVoiceSession({ model, voice } = {}) {
  const { on, emit } = createEmitter();
  const messages = [];

  let current = model;
  let currentVoice = voice;

  let call = null;
  let audio = null;              // AudioContext
  let audioEl = null;
  let micStream = null;
  let micAnalyser = null;
  let outAnalyser = null;

  let state = 'idle';
  let connecting = false;
  /* Dialling spans a permission prompt, a mint and a handshake, and stop() can
     land in the middle of any of them — a `pagehide`, or the page redialling on
     a new voice. Every stop() retires the generation start() is building, so
     the loser tidies up after itself instead of finishing into a torn-down
     session. */
  let generation = 0;

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', next);
  }

  function fail(message) {
    emit('error', { message });
  }

  const events = createEventHandler({
    setState,
    emit,
    fail,
    messages,
    getModel: () => current,
  });

  const meter = createMeter(
    () => (state === 'speaking' ? outAnalyser : state === 'listening' ? micAnalyser : null),
    (level) => emit('level', level),
  );

  /* --- lifecycle ----------------------------------------------------------- */

  async function start() {
    if (call || connecting) return;
    connecting = true;
    const mine = ++generation;
    const abandoned = () => mine !== generation;
    try {
      // Prompted before the token is spent, so a denied mic costs nothing.
      micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (abandoned()) return stop();

      const secret = await fetchClientSecret({ model: current, voice: currentVoice });
      if (abandoned()) return stop();
      // The proxy has the last word on both — it falls back to its own defaults
      // for anything it doesn't recognise.
      current = secret.model ?? current;
      currentVoice = secret.voice ?? currentVoice;

      audio = new AudioContext();
      micAnalyser = createAnalyser(audio, micStream);

      // The model's voice: played through an element, metered off the same track.
      audioEl = new Audio();
      audioEl.autoplay = true;

      call = await connect({
        secret: secret.value,
        micStream,
        onEvent: events.handle,
        onTrack: (stream) => {
          // Arrives on a WebRTC event rather than in the chain below, so a
          // hangup can land first — and there'd be no audio element left.
          if (abandoned()) return;
          audioEl.srcObject = stream;
          outAnalyser = createAnalyser(audio, stream);
        },
        onClose: (reason) => {
          if (!call) return; // our own stop() closing the connection
          if (reason) fail(reason);
          stop();
        },
      });
      if (abandoned()) return stop();

      meter.start();
      setState('listening');
    } catch (err) {
      fail(err?.message ?? String(err));
      stop();
    } finally {
      connecting = false;
    }
  }

  function stop() {
    generation++; // retires any dial still in flight
    const closing = call;
    call = null; // before close(), so onClose knows this teardown is ours
    meter.stop();
    closing?.close();
    micStream?.getTracks().forEach((track) => track.stop());
    audio?.close();
    if (audioEl) audioEl.srcObject = null;
    micStream = audio = audioEl = null;
    micAnalyser = outAnalyser = null;
    events.reset();
    setState('idle');
  }

  /** Typed input, for when speaking out loud isn't an option. Same conversation,
   *  same voice coming back. */
  function send(text) {
    const content = text.trim();
    if (!content || !call?.open) return;
    messages.push({ role: 'user', content });
    call.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] },
    });
    call.send({ type: 'response.create' });
    setState('thinking');
  }

  return {
    on,
    start,
    stop,
    send,
    get messages() { return messages; },
    get connected() { return call?.open ?? false; },
    get busy() { return events.responding; },
    get state() { return state; },
    get model() { return current; },
    set model(next) { current = next; },
    /** Both are pinned into the client secret, so changing either only takes
     *  effect on the next call — the page redials. */
    get voice() { return currentVoice; },
    set voice(next) { currentVoice = next; },
    /** Manual barge-in — the VAD covers the spoken case on its own. */
    cancel() {
      if (events.responding) call?.send({ type: 'response.cancel' });
    },
  };
}
