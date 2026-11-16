// Lazy tree-sitter runtime: grammars are loaded on first use per language.
import Parser from 'web-tree-sitter';
import { grammarFor } from '../l0/languages';
import type { AnalysisOptions, FileParse, FileUnit } from '../types';
import { extract, extractSql } from './extract';

export interface L1Config {
  /** Where the tree-sitter runtime wasm lives (browser only). */
  runtimeUrl?: string;
  /** Returns a URL (browser) or file path (Node) for a grammar wasm. */
  grammarUrl: (grammar: string) => string;
}

let config: L1Config | null = null;
let init: Promise<void> | null = null;
let parser: Parser | null = null;
const languages = new Map<string, Promise<Parser.Language | null>>();
const failed = new Map<string, string>();
const CHUNK = 16 * 1024;

export function configureL1(c: L1Config): void {
  config = c;
}

function ensureInit(): Promise<void> {
  if (!init) {
    init = Parser.init(config?.runtimeUrl ? { locateFile: () => config!.runtimeUrl! } : undefined).then(() => {
      parser = new Parser();
    });
  }
  return init;
}

function language(grammar: string): Promise<Parser.Language | null> {
  let p = languages.get(grammar);
  if (!p) {
    p = Parser.Language.load(config!.grammarUrl(grammar)).catch((e: unknown) => {
      failed.set(grammar, e instanceof Error ? e.message : String(e));
      return null;
    });
    languages.set(grammar, p);
  }
  return p;
}

/** Parse one file. Returns null when no L1 parser exists for the language. Never throws. */
export async function parseL1(u: FileUnit, opts: AnalysisOptions): Promise<FileParse | null> {
  if (u.lang === 'sql') {
    try {
      return extractSql(u.text);
    } catch (e) {
      return { defs: [], imports: [], calls: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
  const grammar = grammarFor(u.path);
  if (!grammar || !config) return null;
  try {
    await ensureInit();
    const lang = await language(grammar);
    if (!lang || !parser) return { defs: [], imports: [], calls: [], error: `grammar "${grammar}" could not be loaded: ${failed.get(grammar) ?? 'unknown error'}` };
    parser.setLanguage(lang);
    // The WASM build of tree-sitter ignores setTimeoutMicros, so the time limit is
    // enforced by feeding the source in chunks and cutting the input off at the deadline.
    const started = Date.now();
    const limit = opts.parseTimeoutMs;
    const text = u.text;
    let timedOut = false;
    let tree: Parser.Tree | null = null;
    try {
      tree = parser.parse((index: number) => {
        if (Date.now() - started > limit) {
          timedOut = true;
          return null;
        }
        return index < text.length ? text.slice(index, index + CHUNK) : null;
      });
    } catch {
      tree = null;
    }
    if (!tree || timedOut) {
      tree?.delete();
      parser.reset();
      return { defs: [], imports: [], calls: [], timedOut: true, error: `parse exceeded the ${limit} ms limit` };
    }
    try {
      return extract(tree.rootNode, grammar, Date.now() + limit);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { defs: [], imports: [], calls: [], timedOut: msg.includes('limit') || undefined, error: msg };
    } finally {
      tree.delete();
    }
  } catch (e) {
    return { defs: [], imports: [], calls: [], error: e instanceof Error ? e.message : String(e) };
  }
}
