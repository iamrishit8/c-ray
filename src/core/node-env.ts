// Pipeline environment for Node (tests, benchmarks, scripts). The browser
// equivalent lives in src/workers/.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { PipelineEnv } from './pipeline';
import { defaultStages, type StageDeps } from './stages';

let libs: Record<string, string> | null = null;
export function tsLibs(): Record<string, string> {
  if (!libs) {
    libs = {};
    const dir = dirname(createRequire(import.meta.url).resolve('typescript'));
    for (const f of readdirSync(dir)) {
      if (/^lib\.(es5|es20(15|16|17|18|19|20)(\..+)?|decorators(\.legacy)?)\.d\.ts$/.test(f) && existsSync(join(dir, f))) libs[f] = readFileSync(join(dir, f), 'utf8');
    }
  }
  return libs;
}

export function nodeDeps(): StageDeps {
  return {
    runL2: async (input) => (await import('./l2/tsgraph')).runL2({ ...input, libs: tsLibs() }),
  };
}

export function nodeEnv(): PipelineEnv {
  return { stages: defaultStages(nodeDeps()) };
}
