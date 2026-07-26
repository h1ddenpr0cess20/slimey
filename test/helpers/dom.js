/**
 * A jsdom document built from the real index.html.
 *
 * Parsing the shipped markup rather than a fixture means a test fails when an
 * id is renamed out from under a module — which is the whole risk with code
 * that reaches into the DOM by selector.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const INDEX = fileURLToPath(new URL('../../index.html', import.meta.url));

let markup;

export async function loadPage() {
  markup ??= await readFile(INDEX, 'utf8');

  const dom = new JSDOM(markup, {
    // Loading /src/client/main.js would pull in three and a WebGL context.
    // These tests are about the modules in isolation.
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  return {
    dom,
    document: dom.window.document,
    window: dom.window,
    $: (sel) => dom.window.document.querySelector(sel),
    close: () => dom.window.close(),
  };
}

/**
 * The handful of browser globals the client modules reach for directly.
 * Returns a restore function.
 */
export function withGlobals(values) {
  const saved = new Map();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, key in globalThis ? globalThis[key] : undefined);
    globalThis[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}
