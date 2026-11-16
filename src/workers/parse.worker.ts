/// <reference lib="webworker" />
// Pool worker: per-file scan (+ L1 parsing once tree-sitter is loaded).
import { processUnit } from './process';
import type { AnalysisOptions, FileUnit } from '../core/types';

self.onmessage = async (e: MessageEvent<{ id: number; units: FileUnit[]; opts: AnalysisOptions }>) => {
  const { id, units, opts } = e.data;
  const results = [];
  for (const u of units) results.push(await processUnit(u, opts));
  (self as unknown as Worker).postMessage({ id, results });
};
