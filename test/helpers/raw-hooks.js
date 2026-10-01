import { readFile } from 'node:fs/promises';

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('?raw')) return nextLoad(url, context);
  const text = await readFile(new URL(url.slice(0, -'?raw'.length)), 'utf8');
  return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
}
