// Full-text + symbol search (MiniSearch / BM25). Lives in the analysis worker.
import MiniSearch from 'minisearch';
import type { Analysis } from './types';
import { camelWords } from './util';

export interface SymbolHit {
  sym: number;
  score: number;
}
export interface FileHit {
  path: string;
  score: number;
  lines: { line: number; text: string }[];
  pathMatch: boolean;
}
export interface SearchResult {
  symbols: SymbolHit[];
  files: FileHit[];
  /** Number of files whose content could not be indexed (index budget). */
  unindexed: number;
}
export interface Occurrence {
  file: string;
  line: number;
  text: string;
}

const CONTENT_BUDGET = 30 * 1024 * 1024;

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9_$]+/)) {
    if (!raw || raw.length > 60) continue;
    const lower = raw.toLowerCase();
    out.push(lower);
    if (/[A-Z_]/.test(raw) && raw.length > 3) {
      const parts = camelWords(raw);
      if (parts.length > 1) for (const p of parts) if (p.length > 1) out.push(p);
    }
  }
  return out;
}

export class SearchIndex {
  private mini: MiniSearch;
  unindexed = 0;

  constructor(private a: Analysis, private sources: Map<string, string>) {
    this.mini = new MiniSearch({
      fields: ['name', 'path', 'content'],
      storeFields: [],
      tokenize,
      processTerm: (t) => t,
      searchOptions: { tokenize, processTerm: (t: string) => t.toLowerCase() },
    });
    const docs: { id: string; name?: string; path?: string; content?: string }[] = [];
    a.symbols.forEach((s, i) => docs.push({ id: 's' + i, name: s.parent ? `${s.parent} ${s.name}` : s.name }));
    let budget = CONTENT_BUDGET;
    a.files.forEach((f, i) => {
      const text = sources.get(f.path);
      let content: string | undefined;
      if (text !== undefined && text.length <= budget) {
        content = text;
        budget -= text.length;
      } else if (text !== undefined) this.unindexed++;
      docs.push({ id: 'f' + i, path: f.path, content });
    });
    this.mini.addAll(docs);
  }

  search(query: string, kind: 'all' | 'symbol' | 'text' = 'all', limit = 40): SearchResult {
    const q = query.trim();
    const out: SearchResult = { symbols: [], files: [], unindexed: this.unindexed };
    if (!q) return out;
    let hits: { id: string; score: number; match: Record<string, string[]> }[] = [];
    try {
      hits = this.mini.search(q, { prefix: true, fuzzy: (term) => (term.length > 5 ? 0.15 : 0), boost: { name: 3, path: 2 }, combineWith: 'AND' }) as never;
    } catch {
      hits = [];
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const exact = q.toLowerCase();
    for (const h of hits) {
      if (h.id[0] === 's') {
        if (kind === 'text' || out.symbols.length >= limit * 2) continue;
        const i = Number(h.id.slice(1));
        const name = this.a.symbols[i].name.toLowerCase();
        out.symbols.push({ sym: i, score: h.score * (name === exact ? 4 : name.startsWith(exact) ? 2 : 1) });
      } else {
        if (kind === 'symbol' || out.files.length >= limit) continue;
        const path = this.a.files[Number(h.id.slice(1))].path;
        const text = this.sources.get(path);
        const lines: FileHit['lines'] = [];
        if (text) {
          const ls = text.split('\n');
          for (let n = 0; n < ls.length && lines.length < 5; n++) {
            const low = ls[n].toLowerCase();
            if (low.includes(exact) || (terms.length > 1 && terms.every((t) => low.includes(t)))) lines.push({ line: n + 1, text: ls[n].trim().slice(0, 200) });
          }
          if (lines.length === 0) {
            for (let n = 0; n < ls.length && lines.length < 3; n++) {
              const low = ls[n].toLowerCase();
              if (terms.some((t) => low.includes(t))) lines.push({ line: n + 1, text: ls[n].trim().slice(0, 200) });
            }
          }
        }
        const pathMatch = terms.every((t) => path.toLowerCase().includes(t));
        if (lines.length || pathMatch) out.files.push({ path, score: h.score, lines, pathMatch });
      }
    }
    out.symbols.sort((x, y) => y.score - x.score);
    out.symbols = out.symbols.slice(0, limit);
    return out;
  }

  /** Whole-word textual occurrences of an identifier (the "unresolved" fallback for find-references). */
  occurrences(name: string, limit = 300): Occurrence[] {
    const out: Occurrence[] = [];
    if (!name) return out;
    const re = new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_$]|$)`);
    for (const f of this.a.files) {
      const text = this.sources.get(f.path);
      if (!text || !text.includes(name)) continue;
      const ls = text.split('\n');
      for (let n = 0; n < ls.length; n++) {
        if (ls[n].includes(name) && re.test(ls[n])) {
          out.push({ file: f.path, line: n + 1, text: ls[n].trim().slice(0, 200) });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }
}
