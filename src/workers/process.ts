// Shared by the pool workers and the inline fallback: scan + L1 parse one file.
import { parseL1 } from '../core/l1/treesitter';
import type { FileResult } from '../core/pipeline';
import { scanFile } from '../core/scan';
import type { AnalysisOptions, FileUnit } from '../core/types';

export async function processUnit(u: FileUnit, opts: AnalysisOptions): Promise<FileResult> {
  let scan;
  try {
    scan = scanFile(u.text, u.lang, u.path);
  } catch {
    scan = { loc: u.text.split('\n').length, sloc: 0, todos: [], smells: [], unresolved: [], lineHashes: [] };
  }
  return { scan, parse: await parseL1(u, opts) };
}
