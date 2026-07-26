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
 * Audio never touches the proxy. `/api/session` mints an ephemeral client
 * secret, the browser negotiates SDP with OpenAI directly, and the mic and the
 * model's voice both terminate here in the page.
 */

const REALTIME_URL = 'https://api.openai.com/v1/realtime/calls';

function createEmitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) fn(payload);
    },
  };
}

/** Longer tokens deserve a bigger wobble, but the range stays narrow so the
 *  surface reads as a steady simmer rather than a strobe. */
function tokenWeight(text) {
  return Math.min(0.34, 0.16 + text.length * 0.018);
}

/** RMS of one analyser frame, mapped to the orb's 0..1 energy. Speech sits
 *  around 0.05–0.2 RMS, so the gain lifts a normal speaking voice to most of
 *  the range without pinning it. */
function amplitude(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buffer.length) * 7);
}

export function createVoiceSession({ endpoint = '/api/session', model } = {}) {
  const { on, emit } = createEmitter();
  const messages = [];
  let current = model;

  let pc = null;
  let channel = null;
  let audioEl = null;
  let audio = null;              // AudioContext
  let micStream = null;
  let micAnalyser = null;
  let outAnalyser = null;
  let frame = 0;
  let level = 0;

  let state = 'idle';
  let responding = false;
  let connecting = false;
  let transcript = '';

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', next);
  }

  function fail(message) {
    emit('error', { message });
  }

  /* --- audio metering ------------------------------------------------------
     One rAF loop reads whichever side is live. Attack is faster than release,
     which is what makes the surface feel like it's tracking a voice rather than
     chasing it. */

  function meter() {
    frame = requestAnimationFrame(meter);
    const source = state === 'speaking' ? outAnalyser : state === 'listening' ? micAnalyser : null;
    const target = source ? amplitude(source, source.buffer) : 0;
    level += (target - level) * (target > level ? 0.45 : 0.12);
    emit('level', level);
  }

  function analyserFor(stream) {
    const node = audio.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.4;
    audio.createMediaStreamSource(stream).connect(node);
    // Parked on the node so the meter loop doesn't reallocate 60 times a second.
    node.buffer = new Float32Array(node.fftSize);
    return node;
  }

  /* --- server events -------------------------------------------------------
     Only the handful that change what the orb is doing. The GA event names are
     `response.output_*`; the older `response.audio*` aliases are still what some
     model snapshots emit, so both are accepted. */

  function handle(event) {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        // Barge-in: the server truncates its own playback, we just follow.
        transcript = '';
        setState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        setState('thinking');
        break;

      case 'response.created':
        responding = true;
        setState('thinking');
        break;

      case 'response.output_audio.delta':
      case 'response.audio.delta':
        setState('speaking');
        break;

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
      case 'response.output_text.delta':
      case 'response.text.delta':
        setState('speaking');
        transcript += event.delta;
        emit('text', event.delta);
        emit('pulse', tokenWeight(event.delta));
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) {
          messages.push({ role: 'user', content: event.transcript.trim() });
          emit('user', event.transcript.trim());
        }
        break;

      case 'response.done': {
        responding = false;
        const response = event.response ?? {};
        if (transcript) messages.push({ role: 'assistant', content: transcript });
        transcript = '';
        if (response.status === 'failed') {
          fail(response.status_details?.error?.message ?? 'the response failed');
        }
        emit('done', { model: current, usage: response.usage });
        setState('listening');
        break;
      }

      case 'error':
        fail(event.error?.message ?? 'realtime error');
        break;
    }
  }

  /* --- lifecycle ----------------------------------------------------------- */

  async function start() {
    if (pc || connecting) return;
    connecting = true;
    try {
      // Prompted before the token is spent, so a denied mic costs nothing.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: current }),
      });
      const secret = await res.json();
      if (!res.ok) throw new Error(secret.error ?? `proxy returned ${res.status}`);
      current = secret.model ?? current;

      pc = new RTCPeerConnection();
      audio = new AudioContext();
      micAnalyser = analyserFor(micStream);

      // The model's voice: played through an element, metered off the same track.
      audioEl = new Audio();
      audioEl.autoplay = true;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        outAnalyser = analyserFor(e.streams[0]);
      };

      pc.addTrack(micStream.getAudioTracks()[0], micStream);

      channel = pc.createDataChannel('oai-events');
      channel.addEventListener('message', (e) => {
        try {
          handle(JSON.parse(e.data));
        } catch {
          /* a frame we can't parse is a frame we don't animate */
        }
      });

      pc.addEventListener('connectionstatechange', () => {
        if (pc && ['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
          if (pc.connectionState === 'failed') fail('the call dropped');
          stop();
        }
      });

      await pc.setLocalDescription(await pc.createOffer());
      const answer = await fetch(REALTIME_URL, {
        method: 'POST',
        body: pc.localDescription.sdp,
        headers: { authorization: `Bearer ${secret.value}`, 'content-type': 'application/sdp' },
      });
      if (!answer.ok) throw new Error(`realtime handshake failed (${answer.status})`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });

      frame = requestAnimationFrame(meter);
      setState('listening');
    } catch (err) {
      fail(err?.message ?? String(err));
      stop();
    } finally {
      connecting = false;
    }
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    channel?.close();
    pc?.close();
    micStream?.getTracks().forEach((track) => track.stop());
    audio?.close();
    if (audioEl) audioEl.srcObject = null;
    channel = pc = micStream = audio = audioEl = null;
    micAnalyser = outAnalyser = null;
    responding = false;
    transcript = '';
    level = 0;
    emit('level', 0);
    setState('idle');
  }

  /** Typed input, for when speaking out loud isn't an option. Same conversation,
   *  same voice coming back. */
  function send(text) {
    const content = text.trim();
    if (!content || !channel || channel.readyState !== 'open') return;
    messages.push({ role: 'user', content });
    channel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] },
    }));
    channel.send(JSON.stringify({ type: 'response.create' }));
    setState('thinking');
  }

  return {
    on,
    start,
    stop,
    send,
    get messages() { return messages; },
    get connected() { return channel?.readyState === 'open'; },
    get busy() { return responding; },
    get state() { return state; },
    get model() { return current; },
    set model(next) { current = next; },
    /** Manual barge-in — the VAD covers the spoken case on its own. */
    cancel() {
      if (responding && channel?.readyState === 'open') {
        channel.send(JSON.stringify({ type: 'response.cancel' }));
      }
    },
  };
}
