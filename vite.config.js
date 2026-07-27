import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

import { createApiMiddleware } from './src/server/api.js';
import { loadConfig } from './src/server/config.js';
import { CERT_DIR } from './src/server/tls.js';

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

  // `npm run dev:lan`, for talking to the orb from a phone on the same wifi.
  //
  // getUserMedia is only exposed on a secure origin, and a LAN address over
  // plain HTTP is not one — the mic isn't refused there, the whole
  // navigator.mediaDevices namespace is missing. So the LAN dev server serves
  // HTTPS with a self-signed certificate, which no browser trusts: the phone
  // shows a warning, and tapping through it once per device is the price of a
  // secure context without a real certificate. The mic works after that.
  const lan = mode === 'lan';

  return {
    plugins: [slimeApi(env), ...(lan ? [basicSsl({ certDir: CERT_DIR })] : [])],
    server: {
      port: Number(env.PORT) || 5173,
      // Phones on the same wifi. Without `dev:lan` this is layout work only.
      host: true,
    },
    resolve: {
      // What the starter component's import map called three's example modules.
      alias: { 'three/addons/': 'three/examples/jsm/' },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      // three is ~180 kB gzipped and it is the entire point of the page, so the
      // default 500 kB warning has nothing useful to tell us. The stage's OBJ
      // and GLTF exporters stay dynamically imported and are never fetched
      // while the export toolbar is hidden.
      chunkSizeWarningLimit: 800,
    },
  };
});
