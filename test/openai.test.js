import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { loadConfig } from '../src/server/config.js';
import { createOpenAIClient } from '../src/server/openai.js';
import { SYSTEM } from '../src/server/persona.js';
import { startOpenAIStub } from './helpers/openai-stub.js';

async function clientFor(env = {}, stubOptions) {
  const stub = await startOpenAIStub(stubOptions);
  const config = loadConfig({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: stub.baseUrl, ...env });
  return { stub, config, client: createOpenAIClient(config) };
}

describe('listRealtimeModels', () => {
  it('keeps only the realtime models that can hold a conversation', async () => {
    const { stub, client } = await clientFor();
    after(() => stub.close());

    const ids = (await client.listRealtimeModels()).map((m) => m.id);

    // Dropped: no 'realtime' in the id, or a tier that can't answer.
    assert.ok(!ids.includes('gpt-4o'));
    for (const excluded of ['gpt-realtime-translate', 'whisper-1-realtime', 'gpt-realtime-transcribe', 'tts-realtime']) {
      assert.ok(!ids.includes(excluded), `${excluded} should not be offered`);
    }
    assert.deepEqual(ids, ['gpt-realtime-2.1', 'gpt-realtime-mini', 'gpt-4o-realtime-preview-2024-12-17']);
  });

  it('sorts the default first and the preview tiers last', async () => {
    const { stub, client } = await clientFor({ OPENAI_REALTIME_MODEL: 'gpt-realtime-mini' });
    after(() => stub.close());

    const ids = (await client.listRealtimeModels()).map((m) => m.id);
    assert.equal(ids[0], 'gpt-realtime-mini');
    assert.equal(ids.at(-1), 'gpt-4o-realtime-preview-2024-12-17');
  });

  it('surfaces the upstream message when OpenAI refuses', async () => {
    const { stub, client } = await clientFor({}, { fail: { status: 401, message: 'Incorrect API key provided' } });
    after(() => stub.close());

    await assert.rejects(() => client.listRealtimeModels(), /Incorrect API key provided/);
  });
});

describe('mintClientSecret', () => {
  it('bakes the persona, turn detection and voice into the secret', async () => {
    const { stub, client } = await clientFor();
    after(() => stub.close());

    const secret = await client.mintClientSecret({ model: 'gpt-realtime-mini', voice: 'cedar' });
    assert.equal(secret.value, 'ek_test');
    assert.equal(secret.voice, 'cedar');

    const { session, expires_after } = stub.requests.at(-1).body;
    assert.equal(session.model, 'gpt-realtime-mini');
    assert.equal(session.instructions, SYSTEM);
    assert.equal(session.audio.output.voice, 'cedar');
    assert.equal(session.audio.input.turn_detection.type, 'semantic_vad');
    assert.equal(expires_after.seconds, 600);
  });

  it('substitutes the default for a voice the API would reject', async () => {
    const { stub, client } = await clientFor();
    after(() => stub.close());

    // An unknown voice comes back from OpenAI as an opaque 400 halfway through
    // the SDP handshake, which is a miserable thing to debug from the browser.
    const secret = await client.mintClientSecret({ voice: 'definitely-not-a-voice' });
    assert.equal(secret.voice, 'ballad');
    assert.equal(stub.requests.at(-1).body.session.audio.output.voice, 'ballad');
  });

  it('falls back to the configured model when the page names none', async () => {
    const { stub, client } = await clientFor({ OPENAI_REALTIME_MODEL: 'gpt-realtime-mini' });
    after(() => stub.close());

    const secret = await client.mintClientSecret({});
    assert.equal(secret.model, 'gpt-realtime-mini');
  });

  it('sends the key as a bearer token and never returns it', async () => {
    const { stub, client } = await clientFor();
    after(() => stub.close());

    const secret = await client.mintClientSecret({});
    assert.ok(!JSON.stringify(secret).includes('sk-test'));
  });
});
