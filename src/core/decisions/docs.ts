// Reads what the team wrote down: Architecture Decision Records (Nygard and MADR layouts) and
// rationale sentences in README/docs ("We chose Express because …"). Pure text in, claims out.
import type { Claim, FileUnit } from '../types';
import { lineOf } from '../util';

export interface ParsedAdr {
  file: string;
  title: string;
  number?: number;
  status?: string;
  date?: string;
  context?: { text: string; line: number };
  decision?: { text: string; line: number };
  consequences: string[];
  consequencesLine: number;
}

const SECTION_KINDS: [RegExp, 'context' | 'decision' | 'consequences' | 'status' | 'date'][] = [
  // "Decision Drivers" belongs to the context, not to the decision itself (MADR)
  [/^(decision drivers?|context|problem|background|forces|considered options)/, 'context'],
  [/^(decision|outcome|resolution|chosen option)/, 'decision'],
  [/^(consequences?|results?|implications|trade-?offs|pros and cons)/, 'consequences'],
  [/^status/, 'status'],
  [/^date/, 'date'],
];

const clean = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** Split a consequences section into short items: bullets first, sentences otherwise. */
function items(body: string): string[] {
  const bullets = body.split('\n').map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l)?.[1]).filter((x): x is string => !!x);
  const parts = bullets.length ? bullets : body.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  return parts.map((p) => clean(p, 220)).filter((p) => p.length > 3).slice(0, 5);
}

export function parseAdr(file: string, text: string): ParsedAdr {
  const lines = text.split('\n');
  const heads: { level: number; title: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ level: m[1].length, title: m[2], line: i + 1 });
  });
  const rawTitle = heads.find((h) => h.level === 1)?.title ?? file.split('/').pop()!.replace(/\.\w+$/, '');
  const number = /^\s*(?:adr[-_ ]*)?(\d+)\s*[.:)\-–—]/i.exec(rawTitle)?.[1] ?? /(?:^|\/)(?:adr[-_]?)?(\d{2,5})[-_]/i.exec(file)?.[1];
  const out: ParsedAdr = { file, title: rawTitle.replace(/^\s*(?:adr[-_ ]*)?\d+\s*[.:)\-–—]\s*/i, '').trim() || rawTitle, number: number ? Number(number) : undefined, consequences: [], consequencesLine: 1 };

  // Sections: body = lines up to the next heading of any level.
  heads.forEach((h, i) => {
    const kind = SECTION_KINDS.find(([re]) => re.test(h.title.toLowerCase()))?.[1];
    if (!kind) return;
    const end = i + 1 < heads.length ? heads[i + 1].line - 1 : lines.length;
    const body = lines.slice(h.line, end).join('\n').trim();
    if (!body) return;
    if (kind === 'status') out.status ??= clean(body.split('\n')[0], 60);
    else if (kind === 'date') out.date ??= /\d{4}-\d{2}-\d{2}/.exec(body)?.[0];
    else if (kind === 'consequences' && out.consequences.length === 0) {
      out.consequences = items(body);
      out.consequencesLine = h.line;
    } else if (kind === 'context' && !out.context) out.context = { text: clean(body, 420), line: h.line };
    else if (kind === 'decision' && !out.decision) out.decision = { text: clean(body, 420), line: h.line };
  });

  // Inline metadata ("Status: Accepted", "Date: 2023-03-14", front matter) in the first lines.
  const top = lines.slice(0, 30).join('\n');
  out.status ??= /^\s*\**status\**\s*[:=]\s*\**([^\n*]{3,60}?)\**\s*$/im.exec(top)?.[1];
  out.date ??= /^\s*\**date\**\s*[:=]\s*\**(\d{4}-\d{2}-\d{2})/im.exec(top)?.[1] ?? /\b(\d{4}-\d{2}-\d{2})\b/.exec(top)?.[1];

  // No recognisable sections: the first paragraph after the title is the best statement of the decision.
  if (!out.decision) {
    const t = heads.find((h) => h.level === 1)?.line ?? 0;
    const para = lines.slice(t).join('\n').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|status|date)/i.test(p));
    if (para) out.decision = { text: clean(para, 420), line: lineOf(text, text.indexOf(para)) };
  }
  return out;
}

// ---- rationale in prose ----

const CUE = /\b(?:chose|chosen|choose|picked|decided|opted|went with|because|instead of|rather than|so that|in order to)\b/i;

/** First sentence in the project's docs that mentions one of `terms` together with a "why" cue. */
export function findRationale(units: FileUnit[], docFiles: string[], terms: string[]): Claim | undefined {
  const wanted = terms.map((t) => t.toLowerCase()).filter((t) => t.length > 2);
  if (wanted.length === 0) return undefined;
  const byPath = new Map(units.map((u) => [u.path, u]));
  for (const file of docFiles.slice(0, 12)) {
    const u = byPath.get(file);
    if (!u || u.text.length > 200_000) continue;
    const lines = u.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^\s*(#|```|\||[-*]\s*\[)/.test(l)) continue;
      // sentences within one line; a rationale rarely spans lines in a README
      for (const sentence of l.split(/(?<=[.!?])\s+/)) {
        const s = sentence.toLowerCase();
        if (CUE.test(sentence) && wanted.some((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(s))) {
          return { text: clean(sentence, 240), conf: 'resolved', file, line: i + 1 };
        }
      }
    }
  }
  return undefined;
}
