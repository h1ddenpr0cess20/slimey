/**
 * Production entry point: the API in front of the built client.
 *
 * `npm run dev` does not come through here — Vite serves the page and mounts
 * the same API middleware itself (see vite.config.js). This is `npm start`,
 * which expects `npm run build` to have produced dist/.
 */

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();

createApp(config).listen(config.port, () => {
  console.log(`slime orb → http://localhost:${config.port}`);
  if (!config.apiKey) {
    console.warn('OPENAI_API_KEY is not set — /api/* will fail until it is.');
  }
});
