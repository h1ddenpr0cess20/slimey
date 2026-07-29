export function createEventHandler({ setState, emit, fail, messages, getModel }) {
  let responding = false;
  let transcript = '';

  function flush() {
    if (transcript) record({ role: 'assistant', content: transcript });
    transcript = '';
  }

  function record(message) {
    messages.push(message);
    emit('message', message);
  }

  function setResponding(next) {
    if (responding === next) return;
    responding = next;
    emit('busy', next);
  }

  function handle(event) {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        flush();
        setState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        setState('thinking');
        break;

      case 'response.created':
        setResponding(true);
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
          record({ role: 'user', content: event.transcript.trim() });
          emit('user', event.transcript.trim());
          emit('pulse', 0.22);
        }
        break;

      case 'response.done': {
        setResponding(false);
        const response = event.response ?? {};
        flush();
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
