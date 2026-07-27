/**
 * Production entry point: the API in front of the built client.
 *
 * `npm run dev` does not come through here — Vite serves the page and mounts
 * the same API middleware itself (see vite.config.js). This is `npm start`,
 * which expects `npm run build` to have produced dist/.
 *
 * `--https` (or SSL_KEY/SSL_CERT) serves TLS instead, which is the only way a
 * phone on the LAN reaches the microphone. `npm run preview:lan` is that.
 */

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadTls } from './tls.js';

const config = loadConfig();
const tls = await loadTls({ https: process.argv.includes('--https') });

createApp(config, { tls }).listen(config.port, () => {
  const scheme = tls ? 'https' : 'http';
  console.log(`slime orb → ${scheme}://localhost:${config.port}`);
  if (tls) {
    // Vite prints the LAN address itself; on this path nothing would.
    console.log(`          → ${scheme}://<this machine on the wifi>:${config.port}`);
  }
  if (!config.apiKey) {
    console.warn('OPENAI_API_KEY is not set — /api/* will fail until it is.');
  }
});
