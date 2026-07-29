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

const SECRET_TTL = 600;

export function loadConfig(env = process.env) {
  const defaultVoice = env.OPENAI_VOICE || KNOWN_VOICES[0];

  return {
    port: Number(env.PORT) || 5173,
    baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY,
    defaultModel: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
    defaultVoice,
    voices: KNOWN_VOICES.includes(defaultVoice)
      ? [...KNOWN_VOICES]
      : [defaultVoice, ...KNOWN_VOICES],
    secretTtl: SECRET_TTL,
  };
}
