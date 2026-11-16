// Read-only indexes over an Analysis. Cheap to build; used by core stages and the UI.
import type { Analysis, FileInfo, ImportEdge, RefEdge, SymbolDef } from './types';

export class Model {
  readonly fileIdx = new Map<string, number>();
  readonly symsByFile: number[][];
  readonly out: ImportEdge[][];
  readonly inn: ImportEdge[][];
  private _refsTo: Map<number, RefEdge[]> | null = null;
  private _refsFrom: Map<number, RefEdge[]> | null = null;

  constructor(readonly a: Analysis) {
    a.files.forEach((f, i) => this.fileIdx.set(f.path, i));
    this.symsByFile = a.files.map(() => []);
    a.symbols.forEach((s, i) => this.symsByFile[s.file]?.push(i));
    this.out = a.files.map(() => []);
    this.inn = a.files.map(() => []);
    for (const e of a.imports) {
      if (e.to < 0 || e.to === e.from) continue;
      this.out[e.from].push(e);
      this.inn[e.to].push(e);
    }
  }

  file(path: string): FileInfo | undefined {
    const i = this.fileIdx.get(path);
    return i === undefined ? undefined : this.a.files[i];
  }

  path(i: number): string {
    return this.a.files[i]?.path ?? '';
  }

  /** Distinct internal files this file depends on. */
  deps(i: number): number[] {
    return [...new Set(this.out[i].map((e) => e.to))];
  }

  dependents(i: number): number[] {
    return [...new Set(this.inn[i].map((e) => e.from))];
  }

  get refsTo(): Map<number, RefEdge[]> {
    if (!this._refsTo) {
      this._refsTo = new Map();
      for (const r of this.a.refs) {
        const arr = this._refsTo.get(r.to);
        if (arr) arr.push(r);
        else this._refsTo.set(r.to, [r]);
      }
    }
    return this._refsTo;
  }

  get refsFrom(): Map<number, RefEdge[]> {
    if (!this._refsFrom) {
      this._refsFrom = new Map();
      for (const r of this.a.refs) {
        if (r.from < 0) continue;
        const arr = this._refsFrom.get(r.from);
        if (arr) arr.push(r);
        else this._refsFrom.set(r.from, [r]);
      }
    }
    return this._refsFrom;
  }

  sym(i: number): SymbolDef {
    return this.a.symbols[i];
  }

  symLabel(i: number): string {
    const s = this.a.symbols[i];
    return s ? (s.parent ? `${s.parent}.${s.name}` : s.name) : '?';
  }

  /** Innermost symbol whose range contains the line. */
  symbolAt(file: number, line: number): number {
    let best = -1;
    let bestSpan = Infinity;
    for (const si of this.symsByFile[file] ?? []) {
      const s = this.a.symbols[si];
      if (s.line <= line && line <= s.endLine && s.endLine - s.line < bestSpan && (s.kind === 'function' || s.kind === 'method')) {
        best = si;
        bestSpan = s.endLine - s.line;
      }
    }
    return best;
  }

  findSymbol(file: string, name: string, parent?: string): number {
    const fi = this.fileIdx.get(file);
    if (fi === undefined) return -1;
    for (const si of this.symsByFile[fi]) {
      const s = this.a.symbols[si];
      if (s.name === name && (parent === undefined || s.parent === parent)) return si;
    }
    return -1;
  }
}

const cache = new WeakMap<Analysis, { model: Model; stamp: string }>();
/** Memoised per analysis object; rebuilt automatically when the pipeline adds graph data. */
export function modelOf(a: Analysis): Model {
  const stamp = `${a.files.length}:${a.symbols.length}:${a.imports.length}:${a.refs.length}`;
  const hit = cache.get(a);
  if (hit && hit.stamp === stamp) return hit.model;
  const model = new Model(a);
  cache.set(a, { model, stamp });
  return model;
}
