// Shared by the pool workers and the inline fallback.
import type { FileResult } from '../core/pipeline';
import { scanFile } from '../core/scan';
import type { AnalysisOptions, FileUnit } from '../core/types';

export async function processUnit(u: FileUnit, _opts: AnalysisOptions): Promise<FileResult> {
  try {
    return { scan: scanFile(u.text, u.lang, u.path), parse: null };
  } catch (e) {
    return {
      scan: { loc: u.text.split('\n').length, sloc: 0, todos: [], smells: [], unresolved: [], lineHashes: [] },
      parse: { defs: [], imports: [], calls: [], error: e instanceof Error ? e.message : String(e) },
    };
  }
}
