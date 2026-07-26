/**
 * Conversation transport — the seam the voice pipeline replaces.
 *
 * A session owns the message history and emits a small, transport-agnostic event
 * vocabulary. The page wires those events to the orb once; swapping text for
 * voice means constructing a different session, not rewriting the UI.
 *
 *   'state'  'listening' | 'thinking' | 'speaking' | 'idle'
 *   'text'   a chunk of assistant text (rendered as caption)
 *   'pulse'  0..1 transient — a discrete event worth a wobble
 *   'level'  0..1 sustained amplitude — emitted by audio transports, per frame
 *   'done'   { model, usage }
 *   'error'  { message }
 *
 * A voice session implements the same surface plus `start()` / `stop()`:
 * mic RMS → 'level' while listening, TTS analyser → 'level' while speaking,
 * transcript → 'text'. Nothing downstream changes, because the orb already
 * treats 'pulse' and 'level' as two ways of describing the same energy.
 */

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

export function createTextSession({ endpoint = '/api/chat', model } = {}) {
  const { on, emit } = createEmitter();
  const messages = [];
  let current = model;
  let inFlight = null;

  async function send(text) {
    const content = text.trim();
    if (!content || inFlight) return;

    messages.push({ role: 'user', content });
    emit('state', 'thinking');

    const controller = new AbortController();
    inFlight = controller;
    let reply = '';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: current, messages }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`proxy returned ${res.status}`);

      // SSE frames are `data: {...}\n\n`; a chunk can split one, so carry the tail.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, cut).replace(/^data: /, '');
          buffer = buffer.slice(cut + 2);
          if (!frame) continue;

          const event = JSON.parse(frame);
          switch (event.type) {
            case 'thinking':
            case 'speaking':
              emit('state', event.type);
              break;
            case 'pulse':
              // Thinking churns below the surface — softer than spoken tokens.
              emit('pulse', Math.min(0.2, 0.09 + event.weight * 0.011));
              break;
            case 'text':
              reply += event.text;
              emit('text', event.text);
              emit('pulse', tokenWeight(event.text));
              break;
            case 'error':
              emit('error', event);
              break;
            case 'done':
              emit('done', event);
              break;
          }
        }
      }
      // The assistant turn has to land in history even if it was cut short,
      // or the next request replays a user turn with no answer between.
      if (reply) messages.push({ role: 'assistant', content: reply });
    } catch (err) {
      if (err.name !== 'AbortError') emit('error', { message: err.message });
    } finally {
      inFlight = null;
      emit('state', 'idle');
    }
  }

  return {
    on,
    send,
    get messages() { return messages; },
    get busy() { return inFlight !== null; },
    get model() { return current; },
    set model(next) { current = next; },
    /** Voice will need this for barge-in; text uses it when the model changes. */
    cancel() { inFlight?.abort(); },
  };
}
