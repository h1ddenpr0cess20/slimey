import { defineConfig, loadEnv } from 'vite';

import { createApiMiddleware } from './src/server/api.js';
import { loadConfig } from './src/server/config.js';

/**
 * The dev server runs the real proxy.
 *
 * Not a `server.proxy` entry pointing at a second process — the API is
 * middleware, so Vite mounts the same code `npm start` does. One process, one
 * implementation of `/api/*`, and the key never leaves it.
 */
function slimeApi(env) {
  const config = loadConfig({ ...process.env, ...env });
  return {
    name: 'slime-api',
    configureServer(server) {
      server.middlewares.use(createApiMiddleware(config));
      if (!config.apiKey) {
        server.config.logger.warn('OPENAI_API_KEY is not set — /api/* will fail until it is.');
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' as the prefix: these are server-side secrets, so they are deliberately
  // read here and never exposed to client code as import.meta.env.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [slimeApi(env)],
    server: {
      port: Number(env.PORT) || 5173,
      // Phones on the same wifi. Note that getUserMedia needs a secure context,
      // so a LAN address over plain HTTP still won't get past the mic prompt —
      // `npm run dev -- --host` is for layout work, not for talking to it.
      host: true,
    },
    resolve: {
      // What the starter component's import map called three's example modules.
      alias: { 'three/addons/': 'three/examples/jsm/' },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
