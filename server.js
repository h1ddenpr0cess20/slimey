/**
 * Slime Orb — local proxy.
 *
 * Serves the static prototype and brokers two endpoints so the API key never
 * reaches the browser:
 *
 *   GET  /api/models  → the live model list from /v1/models, plus the per-model
 *                       capability flags the chat endpoint needs.
 *   POST /api/chat    → SSE. Normalises the Messages stream into the small
 *                       event vocabulary the orb animates against.
 *
 * Credentials resolve the way every Anthropic SDK resolves them: ANTHROPIC_API_KEY,
 * then ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile. Nothing to configure
 * if you've already logged in.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const client = new Anthropic();

const SYSTEM = `You are Slime — a small translucent colour-shifting slime who works as an AI assistant, in the spirit of the slimes from Japanese RPGs.

Voice:
- Cheerful and bouncy, quietly proud of being a slime. Warm, never saccharine.
- Short. Two or three sentences unless the question genuinely needs more — you live in a caption bubble, not a document.
- At most one soft slime sound per reply (*blub*, *squish*, a wobble), and only when it lands. Don't open every message the same way.
- Adventurers, parties, quests and level-ups are fair metaphors when they fit. Don't force them.

Substance first. You are genuinely helpful and accurate; the persona is how you talk, never a licence to be vague, to guess, or to pad. If you don't know, say so plainly — a slime that bluffs gets popped.`;

/* Capabilities decide which optional request fields are safe to send for the
   model the user picked, so the picker can list everything the key can reach. */
let capabilities = null;

async function loadModels() {
  const models = [];
  const page = await client.models.list(
    { limit: 100 },
    { headers: { 'anthropic-beta': FALLBACK_BETA } },
  );
  for await (const model of page) {
    const caps = model.capabilities ?? {};
    models.push({
      id: model.id,
      display_name: model.display_name,
      max_tokens: model.max_tokens,
      adaptive_thinking: caps.thinking?.types?.adaptive?.supported === true,
      effort: caps.effort?.medium?.supported === true,
      // Published only under the fallback beta; empty for models with no route.
      fallbacks: (model.allowed_fallback_models ?? []).length > 0,
    });
  }
  capabilities = new Map(models.map((m) => [m.id, m]));
  return models;
}

function buildParams(model, messages) {
  const caps = capabilities?.get(model);
  const params = {
    model,
    // Room for adaptive thinking plus the reply; thinking counts against this.
    max_tokens: Math.min(caps?.max_tokens ?? 16000, 16000),
    system: SYSTEM,
    messages,
  };
  if (caps?.adaptive_thinking) {
    // `summarized` is what gives us thinking deltas to drive the thinking state —
    // under the default `omitted` the blocks stream empty and the orb sees a stall.
    params.thinking = { type: 'adaptive', display: 'summarized' };
  }
  if (caps?.effort) {
    params.output_config = { effort: 'medium' };
  }
  if (caps?.fallbacks) {
    // A safety decline otherwise just stops the turn; this re-serves it.
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

async function streamChat(req, res, { model, messages }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    if (!capabilities) await loadModels();
    const stream = client.beta.messages.stream(buildParams(model, messages));
    // Barge-in: when the browser drops the connection, stop generating rather
    // than billing out a reply nobody is listening to.
    req.on('close', () => stream.abort());

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'thinking') send({ type: 'thinking' });
        else if (event.content_block.type === 'text') send({ type: 'speaking' });
      } else if (event.type === 'content_block_delta') {
        // Thinking text is never rendered — only its cadence is, as motion.
        if (event.delta.type === 'thinking_delta') {
          send({ type: 'pulse', weight: event.delta.thinking.length });
        } else if (event.delta.type === 'text_delta') {
          send({ type: 'text', text: event.delta.text });
        }
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send({
        type: 'error',
        message: 'That one is outside what this slime will squish. Ask me something else?',
      });
    }
    send({ type: 'done', model: final.model, usage: final.usage });
  } catch (err) {
    // An abort is the client leaving, not a failure worth reporting back.
    if (err?.name !== 'APIUserAbortError') {
      send({ type: 'error', message: err?.message ?? String(err) });
    }
  }
  res.end();
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
  if (req.url === '/api/models') {
    try {
      sendJSON(res, 200, { models: await loadModels() });
    } catch (err) {
      sendJSON(res, 502, { error: err?.message ?? String(err) });
    }
    return;
  }

  if (req.url === '/api/chat' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      return sendJSON(res, 400, { error: 'malformed request body' });
    }
    if (!payload.model || !Array.isArray(payload.messages)) {
      return sendJSON(res, 400, { error: 'model and messages are required' });
    }
    return streamChat(req, res, payload);
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`slime orb → http://localhost:${PORT}`);
});
