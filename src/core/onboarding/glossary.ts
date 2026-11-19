// A glossary of the project's own vocabulary: entity names, the nouns in route paths and the words that
// recur in class and file names. Plumbing words ("service", "controller", "util") are dropped, because
// every project has them and they teach a newcomer nothing.
import { CODE_LANGS } from '../l0/languages';
import type { Analysis, GlossaryTerm } from '../types';
import { basename, stripExt } from '../util';

const MAX_TERMS = 40;
const SYMBOL_KINDS = new Set(['class', 'interface', 'enum', 'struct', 'trait', 'type']);

const STOP = new Set(`index main app apps util utils helper helpers service services controller controllers handler handlers route routes router routers
model models config configs configuration test tests spec specs base common type types interface interfaces manager factory client clients server api data default
error errors middleware module modules component components page pages view views repository repositories dto entity entities schema schemas lib libs src dist
build create update delete list find get set add remove new old init setup start stop run job jobs task tasks event events query queries input output result
response request props state store hook hooks context provider providers wrapper impl abstract builder adapter mapper converter validator validation constants
constant shared core domain function functions class object value values item items option options param params env settings setting health version`.split(/\s+/));

/** "OrderItem" / "order_item" / "order-items" → ["order", "item"]. */
export function splitWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter(Boolean);
}

/** Crude singular so "invoices" and "Invoice" count as one word. */
export function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

const usable = (w: string) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w) && !STOP.has(singular(w));
const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

interface Acc {
  word: string;
  routes: Analysis['routes'];
  symbols: { name: string; file: string; line: number }[];
  files: Set<string>;
}

export function buildGlossary(a: Analysis): GlossaryTerm[] {
  const acc = new Map<string, Acc>();
  const get = (w: string): Acc => {
    let x = acc.get(w);
    if (!x) acc.set(w, (x = { word: w, routes: [], symbols: [], files: new Set() }));
    return x;
  };
  for (const r of a.routes) {
    if (r.kind !== 'http' && r.kind !== 'page') continue;
    const words = new Set(r.path.split(/[/?&=]/).filter((s) => s && !/^[:{<]/.test(s) && !/[}>]$/.test(s)).flatMap(splitWords).map(singular).filter(usable));
    for (const w of words) {
      const x = get(w);
      x.routes.push(r);
      x.files.add(r.file);
    }
  }
  for (const s of a.symbols) {
    if (!SYMBOL_KINDS.has(s.kind)) continue;
    const f = a.files[s.file];
    if (!f || f.test || !CODE_LANGS.has(f.lang)) continue;
    for (const w of new Set(splitWords(s.name).map(singular).filter(usable))) {
      const x = get(w);
      x.symbols.push({ name: s.name, file: f.path, line: s.line });
      x.files.add(f.path);
    }
  }
  for (const f of a.files) {
    if (f.test || !CODE_LANGS.has(f.lang)) continue;
    for (const w of new Set(splitWords(stripExt(basename(f.path))).map(singular).filter(usable))) get(w).files.add(f.path);
  }

  const out: GlossaryTerm[] = [];
  const describe = (x: Acc | undefined) => {
    if (!x) return '';
    const srcFiles = new Set(x.symbols.map((s) => s.file));
    return [x.routes.length ? `${x.routes.length} route${x.routes.length === 1 ? '' : 's'}` : '', srcFiles.size ? `${srcFiles.size} source file${srcFiles.size === 1 ? '' : 's'} (${[...new Set(x.symbols.map((s) => s.name))].slice(0, 3).join(', ')})` : ''].filter(Boolean).join(' and ');
  };
  // every data entity is a term, even when its name is made of plumbing words ("OrderItem")
  const entityWords = new Set<string>();
  for (const e of a.schema.entities) {
    const words = splitWords(e.name).map(singular);
    const x = words.length === 1 ? acc.get(words[0]) : undefined;
    if (words.length === 1) entityWords.add(words[0]);
    const more = describe(x);
    out.push({
      term: e.name, kind: 'entity', file: e.file, line: e.line, count: new Set([e.file, ...(x?.files ?? [])]).size, conf: e.conf,
      meaning: `Data entity (${e.source}) with ${e.fields.length ? `fields ${e.fields.slice(0, 5).map((f) => f.name).join(', ')}${e.fields.length > 5 ? ', …' : ''}` : 'no fields found'}.${more ? ` Also appears in ${more}.` : ''}`,
    });
  }
  for (const x of acc.values()) {
    // a word needs a reason to be in the glossary: a route noun, or repeated use across files
    if (entityWords.has(x.word) || (x.routes.length === 0 && x.files.size < 2)) continue;
    const more = describe(x);
    if (x.routes.length) {
      const r = x.routes[0];
      out.push({ term: title(x.word), kind: 'route', file: r.file, line: r.line, count: x.files.size, conf: 'heuristic', meaning: `A noun in the URLs: ${more}, e.g. ${r.method} ${r.path}.` });
    } else if (x.symbols.length) {
      const s = x.symbols[0];
      out.push({ term: title(x.word), kind: 'symbol', file: s.file, line: s.line, count: x.files.size, conf: 'heuristic', meaning: `A word that recurs in the code's own names: ${more}.` });
    }
  }
  const ORDER = { entity: 0, route: 1, symbol: 2 };
  return out.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || y.count - x.count || (x.term < y.term ? -1 : 1)).slice(0, MAX_TERMS);
}
