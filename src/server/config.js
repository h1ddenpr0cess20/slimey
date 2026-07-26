/**
 * Everything the proxy reads from the environment, resolved once.
 *
 * Kept as a function rather than module-level constants so the Vite dev server,
 * the production server and the tests can each build their own — the tests in
 * particular need to point `baseUrl` at a stub without mutating `process.env`.
 */

/* There is no voices endpoint to ask, so this is the published set. `ballad`
   leads because it has the light, playful lift a slime wants; `marin` and
   `cedar` are the realtime-native pair and the most naturalistic, the rest
   predate them and read flatter. An unrecognised OPENAI_VOICE is still honoured
   and shows up in the picker — the list here goes stale, the API doesn't. */
export const KNOWN_VOICES = Object.freeze([
  'ballad',
  'marin',
  'cedar',
  'alloy',
  'ash',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
]);

/** The secret only has to survive the SDP handshake, which is one round trip. */
const SECRET_TTL = 600;

export function loadConfig(env = process.env) {
  const defaultVoice = env.OPENAI_VOICE || KNOWN_VOICES[0];

  return {
    port: Number(env.PORT) || 5173,
    // Same variable the OpenAI SDKs honour, for gateways and for testing
    // against a stub.
    baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY,
    defaultModel: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
    defaultVoice,
    // An overridden voice we don't know about still belongs in the picker, at
    // the front, since it's the one the operator asked for.
    voices: KNOWN_VOICES.includes(defaultVoice)
      ? [...KNOWN_VOICES]
      : [defaultVoice, ...KNOWN_VOICES],
    secretTtl: SECRET_TTL,
  };
}
