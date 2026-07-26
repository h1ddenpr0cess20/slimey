/**
 * The two OpenAI calls the proxy makes, and nothing else.
 *
 *   listRealtimeModels()  → the realtime-capable models this key can reach.
 *   mintClientSecret()    → a short-lived secret for one WebRTC call.
 *
 * Audio never comes through here. The browser negotiates SDP with OpenAI
 * directly using the secret this module mints.
 */

import { sessionConfig } from './persona.js';

/* Not every `*realtime*` model holds a conversation: the translate and whisper
   tiers are streaming translation and speech-to-text, and picking one would
   leave the orb listening to a slime that can't answer. */
const NOT_CONVERSATIONAL = /translate|whisper|transcribe|tts/;

export function createOpenAIClient({ baseUrl, apiKey, defaultModel, defaultVoice, voices, secretTtl }) {
  async function request(path, init = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error?.message ?? `OpenAI returned ${res.status}`);
    }
    return body;
  }

  /* The default first, then everything else the key can see — dated snapshots
     and the older preview tiers sort under it. */
  function rank(id) {
    if (id === defaultModel) return 0;
    if (id.includes('preview')) return 2;
    return 1;
  }

  return {
    async listRealtimeModels() {
      const { data } = await request('/models');
      return data
        .filter((m) => m.id.includes('realtime') && !NOT_CONVERSATIONAL.test(m.id))
        .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
        .map((m) => ({ id: m.id, display_name: m.id }));
    },

    async mintClientSecret({ model, voice } = {}) {
      // Only voices we know about get proxied through; anything else is a typo
      // that would come back as an opaque 400 halfway through the handshake.
      const chosen = voices.includes(voice) ? voice : defaultVoice;
      const secret = await request('/realtime/client_secrets', {
        method: 'POST',
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: secretTtl },
          session: sessionConfig(model || defaultModel, chosen),
        }),
      });
      return {
        value: secret.value,
        expires_at: secret.expires_at,
        model: secret.session?.model ?? model ?? defaultModel,
        voice: chosen,
      };
    },
  };
}
