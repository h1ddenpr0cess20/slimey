/**
 * The realtime event mapping — the layer most exposed to OpenAI renaming
 * things, and the one that decides what the orb is doing.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { createEventHandler } from '../../src/client/session/events.js';

function harness() {
  const states = [];
  const emitted = [];
  const failures = [];
  const messages = [];

  const handler = createEventHandler({
    setState: (s) => states.push(s),
    emit: (event, payload) => emitted.push([event, payload]),
    fail: (message) => failures.push(message),
    messages,
    getModel: () => 'gpt-realtime-2.1',
  });

  return {
    handler,
    states,
    emitted,
    failures,
    messages,
    of: (name) => emitted.filter(([e]) => e === name).map(([, p]) => p),
    feed: (...events) => events.forEach((e) => handler.handle(e)),
  };
}

describe('turn taking', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('listens when speech starts and thinks when it stops', () => {
    h.feed(
      { type: 'input_audio_buffer.speech_started' },
      { type: 'input_audio_buffer.speech_stopped' },
    );
    assert.deepEqual(h.states, ['listening', 'thinking']);
  });

  it('pulses once when a response is created, not per token', () => {
    h.feed(
      { type: 'response.created' },
      { type: 'response.output_audio_transcript.delta', delta: 'Bloop' },
      { type: 'response.output_audio_transcript.delta', delta: '!' },
    );
    assert.deepEqual(h.of('pulse'), [0.32]);
  });

  it('speaks on the first audio frame', () => {
    h.feed({ type: 'response.created' }, { type: 'response.output_audio.delta' });
    assert.equal(h.states.at(-1), 'speaking');
  });

  it('returns to listening when the response is done', () => {
    h.feed(
      { type: 'response.created' },
      { type: 'response.output_audio.delta' },
      { type: 'response.done', response: {} },
    );
    assert.equal(h.states.at(-1), 'listening');
  });
});

describe('event name aliases', () => {
  // The GA names are response.output_*; some model snapshots still emit the
  // older response.audio* spellings. Dropping either would silently stop the
  // caption or freeze the orb mid-turn.
  const transcriptAliases = [
    'response.output_audio_transcript.delta',
    'response.audio_transcript.delta',
    'response.output_text.delta',
    'response.text.delta',
  ];

  for (const type of transcriptAliases) {
    it(`accumulates transcript from ${type}`, () => {
      const h = harness();
      h.feed({ type, delta: 'Blo' }, { type, delta: 'op!' });
      assert.deepEqual(h.of('text'), ['Blo', 'op!']);
      assert.equal(h.states.at(-1), 'speaking');

      h.feed({ type: 'response.done', response: {} });
      assert.deepEqual(h.messages, [{ role: 'assistant', content: 'Bloop!' }]);
    });
  }

  for (const type of ['response.output_audio.delta', 'response.audio.delta']) {
    it(`switches to speaking on ${type}`, () => {
      const h = harness();
      h.feed({ type });
      assert.deepEqual(h.states, ['speaking']);
    });
  }
});

describe('transcripts', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('records what the person said and pulses for it', () => {
    h.feed({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '  what are you?  ',
    });
    assert.deepEqual(h.messages, [{ role: 'user', content: 'what are you?' }]);
    assert.deepEqual(h.of('user'), ['what are you?']);
    assert.deepEqual(h.of('pulse'), [0.22]);
  });

  it('ignores an empty transcription rather than logging a blank turn', () => {
    h.feed({ type: 'conversation.item.input_audio_transcription.completed', transcript: '   ' });
    h.feed({ type: 'conversation.item.input_audio_transcription.completed' });
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.of('user'), []);
  });

  it('does not record an assistant message for a turn that said nothing', () => {
    h.feed({ type: 'response.created' }, { type: 'response.done', response: {} });
    assert.deepEqual(h.messages, []);
  });

  it('drops the in-flight transcript when the person barges in', () => {
    h.feed(
      { type: 'response.output_text.delta', delta: 'I was saying' },
      { type: 'input_audio_buffer.speech_started' },
      { type: 'response.done', response: {} },
    );
    // The interrupted half-sentence never becomes a message.
    assert.deepEqual(h.messages, []);
  });
});

describe('completion and failure', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('reports the model and usage when done', () => {
    h.feed({ type: 'response.done', response: { usage: { total_tokens: 42 } } });
    assert.deepEqual(h.of('done'), [{ model: 'gpt-realtime-2.1', usage: { total_tokens: 42 } }]);
  });

  it('surfaces a failed response and still returns to listening', () => {
    h.feed({
      type: 'response.done',
      response: { status: 'failed', status_details: { error: { message: 'the model gave up' } } },
    });
    assert.deepEqual(h.failures, ['the model gave up']);
    assert.equal(h.states.at(-1), 'listening');
  });

  it('has something to say about a failure with no message', () => {
    h.feed({ type: 'response.done', response: { status: 'failed' } });
    assert.deepEqual(h.failures, ['the response failed']);
  });

  it('survives a response.done with no response object at all', () => {
    assert.doesNotThrow(() => h.feed({ type: 'response.done' }));
    assert.equal(h.states.at(-1), 'listening');
  });

  it('forwards a transport error', () => {
    h.feed({ type: 'error', error: { message: 'session expired' } });
    assert.deepEqual(h.failures, ['session expired']);
  });

  it('falls back to a generic message for a shapeless error', () => {
    h.feed({ type: 'error' });
    assert.deepEqual(h.failures, ['realtime error']);
  });

  it('ignores event types it does not model', () => {
    const h2 = harness();
    h2.feed({ type: 'rate_limits.updated' }, { type: 'session.created' });
    assert.deepEqual(h2.states, []);
    assert.deepEqual(h2.emitted, []);
  });
});

describe('responding', () => {
  it('tracks whether a response is in flight, which is what gates barge-in', () => {
    const h = harness();
    assert.equal(h.handler.responding, false);

    h.feed({ type: 'response.created' });
    assert.equal(h.handler.responding, true);

    h.feed({ type: 'response.done', response: {} });
    assert.equal(h.handler.responding, false);
  });

  it('clears both response state and transcript on reset', () => {
    const h = harness();
    h.feed({ type: 'response.created' }, { type: 'response.output_text.delta', delta: 'half a' });

    h.handler.reset();
    assert.equal(h.handler.responding, false);

    // The abandoned transcript must not resurface on the next call's first turn.
    h.feed({ type: 'response.done', response: {} });
    assert.deepEqual(h.messages, []);
  });
});
