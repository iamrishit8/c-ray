// Pipeline environment for Node (tests, benchmarks, scripts). The browser
// equivalent lives in src/workers/.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { configureL1 } from './l1/treesitter';
import type { PipelineEnv } from './pipeline';
import { processUnit } from '../workers/process';
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

export function nodeEnv(opts: { l2?: boolean } = {}): PipelineEnv {
  const wasmDir = join(dirname(createRequire(import.meta.url).resolve('tree-sitter-wasms/package.json')), 'out');
  configureL1({ grammarUrl: (g) => join(wasmDir, `tree-sitter-${g}.wasm`) });
  const processFiles: PipelineEnv['processFiles'] = async (units, o, onFile) => {
    const out = [];
    for (const u of units) {
      out.push(await processUnit(u, o));
      onFile(u.path);
    }
    return out;
  };
  return { stages: defaultStages({ ...(opts.l2 === false ? {} : nodeDeps()), processFiles }), processFiles };
}
