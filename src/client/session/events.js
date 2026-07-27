/**
 * Realtime server events → the session's own vocabulary.
 *
 * Only the handful that change what the orb is doing. The GA event names are
 * `response.output_*`; the older `response.audio*` aliases are still what some
 * model snapshots emit, so both are accepted.
 *
 * This module owns the two pieces of state that only the event stream can
 * advance: whether a response is in flight, and the transcript accumulating
 * for the current turn.
 */

export function createEventHandler({ setState, emit, fail, messages, getModel }) {
  let responding = false;
  let transcript = '';

  /* Announced rather than just recorded. A response can begin and end well
     inside a single 'listening' or 'thinking', so anything drawing itself from
     `busy` — the send button — would never hear about it on 'state' alone. */
  function setResponding(next) {
    if (responding === next) return;
    responding = next;
    emit('busy', next);
  }

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
        setResponding(true);
        // Audio drives sustain from here on; impulses are reserved for the two
        // moments a turn changes hands, where a discrete wobble reads as a beat.
        emit('pulse', 0.32);
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
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) {
          messages.push({ role: 'user', content: event.transcript.trim() });
          emit('user', event.transcript.trim());
          emit('pulse', 0.22);
        }
        break;

      case 'response.done': {
        setResponding(false);
        const response = event.response ?? {};
        if (transcript) messages.push({ role: 'assistant', content: transcript });
        transcript = '';
        if (response.status === 'failed') {
          fail(response.status_details?.error?.message ?? 'the response failed');
        }
        emit('done', { model: getModel(), usage: response.usage });
        setState('listening');
        break;
      }

      case 'error':
        fail(event.error?.message ?? 'realtime error');
        break;
    }
  }

  return {
    handle,
    get responding() { return responding; },
    reset() {
      setResponding(false);
      transcript = '';
    },
  };
}
