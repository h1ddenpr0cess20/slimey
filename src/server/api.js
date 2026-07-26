/**
 * The `/api` surface, as connect-style middleware.
 *
 * Middleware rather than a server so there is exactly one implementation of
 * these routes: the Vite dev server mounts it (see vite.config.js) and the
 * production server mounts it in front of the static handler. Anything that
 * isn't `/api/*` falls through to `next()`.
 *
 *   GET  /api/models   → the realtime models the key can reach, plus defaults.
 *   POST /api/session  → a client secret for one call, persona already baked in.
 */

import { createOpenAIClient } from './openai.js';

const BODY_LIMIT = 4096; // A model id and a voice name. Nothing legitimate is bigger.

function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJSON(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}

export function createApiMiddleware(config) {
  const openai = createOpenAIClient(config);

  return async function api(req, res, next) {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return next();

    if (!config.apiKey) {
      return sendJSON(res, 500, { error: 'OPENAI_API_KEY is not set' });
    }

    try {
      if (path === '/api/models' && req.method === 'GET') {
        return sendJSON(res, 200, {
          models: await openai.listRealtimeModels(),
          model: config.defaultModel,
          voices: config.voices,
          voice: config.defaultVoice,
        });
      }

      if (path === '/api/session' && req.method === 'POST') {
        let payload;
        try {
          payload = await readJSON(req);
        } catch {
          return sendJSON(res, 400, { error: 'malformed request body' });
        }
        return sendJSON(res, 200, await openai.mintClientSecret(payload));
      }
    } catch (err) {
      // Upstream failures are 502s: the proxy is fine, OpenAI wasn't.
      return sendJSON(res, 502, { error: err?.message ?? String(err) });
    }

    sendJSON(res, 404, { error: `no route for ${req.method} ${path}` });
  };
}
