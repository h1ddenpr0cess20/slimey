/**
 * Lets the tests import what Vite imports: `?raw` hands back a file's text,
 * which is how the orb's shaders come in. Loaded with `--import` by `npm test`.
 */

import { register } from 'node:module';

register('./raw-hooks.js', import.meta.url);
