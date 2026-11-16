/// <reference lib="webworker" />
// Pool worker: per-file scan + L1 (tree-sitter) parsing.
import { configureL1 } from '../core/l1/treesitter';
import type { AnalysisOptions, FileUnit } from '../core/types';
import { processUnit } from './process';

let configured = '';
self.onmessage = async (e: MessageEvent<{ id: number; units: FileUnit[]; opts: AnalysisOptions; assetBase: string }>) => {
  const { id, units, opts, assetBase } = e.data;
  if (configured !== assetBase) {
    configureGrammars(assetBase);
    configured = assetBase;
  }
  const results = [];
  for (const u of units) results.push(await processUnit(u, opts));
  (self as unknown as Worker).postMessage({ id, results });
};

export function configureGrammars(assetBase: string) {
  configureL1({
    runtimeUrl: new URL('grammars/tree-sitter.wasm', assetBase).href,
    grammarUrl: (g) => new URL(`grammars/tree-sitter-${g}.wasm`, assetBase).href,
  });
}
