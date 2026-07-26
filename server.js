/**
 * Slime Orb — local proxy.
 *
 * Serves the static prototype and brokers two endpoints so the API key never
 * reaches the browser:
 *
 *   GET  /api/models   → the realtime-capable models the key can reach.
 *   POST /api/session  → mints a short-lived client secret for one WebRTC call,
 *                        with the slime's persona and audio config baked in.
 *
 * The browser negotiates SDP with OpenAI directly using that ephemeral secret;
 * audio never passes through here. Credentials: OPENAI_API_KEY (required),
 * OPENAI_VOICE and OPENAI_REALTIME_MODEL optional.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

// Same variable the OpenAI SDKs honour, for gateways and for testing against a stub.
const API = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
/* The secret only has to survive the SDP handshake, which is one round trip. */
const SECRET_TTL = 600;

/* There is no voices endpoint to ask, so this is the published set. `ballad`
   leads because it has the light, playful lift a slime wants; `marin` and
   `cedar` are the realtime-native pair and the most naturalistic, the rest
   predate them and read flatter. An unrecognised OPENAI_VOICE is still honoured
   and shows up in the picker — the list here goes stale, the API doesn't. */
const VOICES = ['ballad', 'marin', 'cedar', 'alloy', 'ash', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
const DEFAULT_VOICE = process.env.OPENAI_VOICE || VOICES[0];
const voices = VOICES.includes(DEFAULT_VOICE) ? VOICES : [DEFAULT_VOICE, ...VOICES];

const SYSTEM = `You are Slime — a small translucent colour-shifting slime who works as an AI assistant, in the spirit of the slimes from Japanese RPGs.

Voice:
- Cheerful and bouncy, quietly proud of being a slime. Warm, never saccharine.
- You are speaking out loud, so keep it short: two or three sentences unless the question genuinely needs more. No markdown, no lists, no stage directions — anything you write gets said.
- A soft wobble or squelch in the delivery is welcome when it lands. Don't open every turn the same way.
- Adventurers, parties, quests and level-ups are fair metaphors when they fit. Don't force them.
- If the audio is unclear, say so and ask them to repeat it rather than guessing at what was said.

Substance first. You are genuinely helpful and accurate; the persona is how you talk, never a licence to be vague, to guess, or to pad. If you don't know, say so plainly — a slime that bluffs gets popped.`;

/** Session config shared by the client secret and any later session.update.
 *
 *  No `tools` here on purpose — the slime answers from what the model knows.
 *  Web search would have to be a hand-rolled function tool today, since the
 *  hosted one is Responses-API only. Revisit when gpt-live is available and we
 *  upgrade to it; if it exposes hosted tools to a live session, this is where
 *  they go. See the README. */
function sessionConfig(model, voice) {
  return {
    type: 'realtime',
    model,
    instructions: SYSTEM,
    audio: {
      input: {
        // A laptop mic in a room, not a headset — worth telling the model.
        noise_reduction: { type: 'near_field' },
        transcription: { model: 'gpt-4o-mini-transcribe' },
        // Semantic VAD waits for a finished thought instead of a silence timer,
        // so the slime stops cutting people off mid-sentence.
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice },
    },
  };
}

async function openai(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${KEY}`,
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

/* `gpt-realtime` first when it's there, then everything else the key can see —
   dated snapshots and the mini/preview tiers sort under it. */
function rankModel(id) {
  if (id === DEFAULT_MODEL) return 0;
  if (id.includes('preview')) return 2;
  return 1;
}

async function loadModels() {
  const { data } = await openai('/models');
  return data
    .filter((m) => m.id.includes('realtime'))
    .sort((a, b) => rankModel(a.id) - rankModel(b.id) || a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, display_name: m.id }));
}

async function mintSecret({ model, voice }) {
  // Only voices we know about get proxied through; anything else is a typo that
  // would come back as an opaque 400 halfway through the handshake.
  const chosen = voices.includes(voice) ? voice : DEFAULT_VOICE;
  const secret = await openai('/realtime/client_secrets', {
    method: 'POST',
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: SECRET_TTL },
      session: sessionConfig(model || DEFAULT_MODEL, chosen),
    }),
  });
  return {
    value: secret.value,
    expires_at: secret.expires_at,
    model: secret.session?.model ?? model ?? DEFAULT_MODEL,
    voice: chosen,
  };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

async function serveStatic(req, res) {
  const path = req.url === '/' ? '/slime-orb.html' : req.url.split('?')[0];
  // normalize() collapses any ../ before it can escape the project directory.
  const file = join(ROOT, normalize(path));
  if (!file.startsWith(ROOT)) return send404(res);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    send404(res);
  }
}

function send404(res) {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url.startsWith('/api/') && !KEY) {
    return sendJSON(res, 500, { error: 'OPENAI_API_KEY is not set' });
  }

  if (url === '/api/models') {
    try {
      sendJSON(res, 200, { models: await loadModels(), voices, voice: DEFAULT_VOICE });
    } catch (err) {
      sendJSON(res, 502, { error: err?.message ?? String(err) });
    }
    return;
  }

  if (url === '/api/session' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload = {};
    if (chunks.length) {
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        return sendJSON(res, 400, { error: 'malformed request body' });
      }
    }
    try {
      sendJSON(res, 200, await mintSecret(payload));
    } catch (err) {
      sendJSON(res, 502, { error: err?.message ?? String(err) });
    }
    return;
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`slime orb → http://localhost:${PORT}`);
  if (!KEY) console.warn('OPENAI_API_KEY is not set — /api/* will fail until it is.');
});
