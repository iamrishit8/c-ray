// Bundled sample project for the Home page ("Try a sample"): the express-mongoose test fixture,
// inlined at build time. Loaded with a dynamic import so it costs nothing until it is used.
import type { Picked } from './input';

const raw = import.meta.glob(['/tests/fixtures/express-mongoose/**/*', '/tests/fixtures/express-mongoose/**/.*', '!**/ground-truth.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ROOT = '/tests/fixtures/express-mongoose/';

export const SAMPLE_NAME = 'sample-express-api';

export function samplePicked(): Picked {
  const files = Object.entries(raw).map(([path, text]) => ({ path: path.slice(ROOT.length), text }));
  return { source: { kind: 'memory', files }, name: SAMPLE_NAME };
}
