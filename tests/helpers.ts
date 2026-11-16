import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InputSource } from '../src/core/ingest/ingest';
import { runPipeline, type PipelineEnv, type PipelineOutput } from '../src/core/pipeline';
import type { AnalysisOptions } from '../src/core/types';
import { nodeEnv } from '../src/core/node-env';

export const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
export const FIXTURE_NAMES = ['express-mongoose', 'nestjs-prisma', 'django-app', 'spring-boot', 'legacy-php', 'monorepo'] as const;

export function readDir(dir: string): { path: string; bytes: Uint8Array }[] {
  const out: { path: string; bytes: Uint8Array }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f !== 'ground-truth.json') out.push({ path: relative(dir, p).replace(/\\/g, '/'), bytes: new Uint8Array(readFileSync(p)) });
    }
  };
  walk(dir);
  return out;
}

export function fixtureSource(name: string): InputSource {
  return { kind: 'memory', files: readDir(join(FIXTURES, name)) };
}

export function groundTruth(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES, name, 'ground-truth.json'), 'utf8'));
}

export function fixtureText(name: string, file: string): string {
  return readFileSync(join(FIXTURES, name, file), 'utf8');
}

const cache = new Map<string, Promise<PipelineOutput>>();
/** Analyse a fixture once per test process (results are shared between test files' suites). */
export function analyzeFixture(name: string, opts: Partial<AnalysisOptions> = {}, env?: PipelineEnv): Promise<PipelineOutput> {
  const key = name + JSON.stringify(opts);
  if (!env && cache.has(key)) return cache.get(key)!;
  const p = runPipeline(fixtureSource(name), name, opts, env ?? nodeEnv());
  if (!env) cache.set(key, p);
  return p;
}

export function memSource(files: Record<string, string>): InputSource {
  return { kind: 'memory', files: Object.entries(files).map(([path, text]) => ({ path, text })) };
}

export async function analyzeMem(files: Record<string, string>, name = 'mem', opts: Partial<AnalysisOptions> = {}) {
  return runPipeline(memSource(files), name, opts, nodeEnv());
}
