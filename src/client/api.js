/**
 * The proxy's two endpoints, as functions.
 *
 * Both throw on failure with the proxy's own message, which is written to be
 * shown to a person — the caption renders it verbatim.
 */

async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `${url} returned ${res.status}`);
  }
  return body;
}

/** @returns {Promise<{ models: {id: string, display_name: string}[], model: string, voices: string[], voice: string }>} */
export function fetchCatalog() {
  return json('/api/models');
}

/** A client secret for one call. The proxy has the last word on model and voice. */
export function fetchClientSecret({ model, voice }) {
  return json('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, voice }),
  });
}
