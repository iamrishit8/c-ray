// Report generation: Markdown sections (with Mermaid diagrams) that feed the
// Markdown export, the Notion ZIP, the print/PDF view and the in-app docs.
import { traceFlow, flowToMermaid } from './flow';
import { CODE_LANGS } from './l0/languages';
import { langName } from './orientation';
import { ROLE_LABEL } from './roles';
import { diffSnapshots } from './git/diff';
import { erToMermaid } from './schema';
import type { Analysis, Confidence, Finding } from './types';
import { dirname, fmtNum, groupBy } from './util';

export interface ReportSection {
  id: string;
  title: string;
  /** Returns Markdown, or '' when the section has nothing to say for this project. */
  build: (a: Analysis) => string;
}

/** Escape text that originates from analysed source so it cannot inject Markdown/HTML. */
export function md(text: string | number | undefined): string {
  return String(text ?? '').replace(/[\\`*_{}\[\]<>|#]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '\\' + c)).replace(/\r?\n/g, ' ');
}
export const code = (text: string | number | undefined) => '`' + String(text ?? '').replace(/`/g, "'").replace(/\r?\n/g, ' ') + '`';
export const loc = (file: string, line?: number) => code(line ? `${file}:${line}` : file);
const conf = (c: Confidence) => `_${c}_`;

export function table(headers: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return '';
  const cell = (c: string | number) => String(c).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}
export const mermaid = (src: string) => '```mermaid\n' + src + '\n```';

/** Module-level dependency diagram: top directories as nodes, aggregated import edges. */
export function moduleDiagram(a: Analysis, maxNodes = 24): string {
  const depth = (() => {
    // pick the directory depth that yields a readable number of modules
    for (const d of [1, 2, 3]) {
      const n = new Set(a.files.filter((f) => CODE_LANGS.has(f.lang)).map((f) => moduleOf(f.path, d))).size;
      if (n >= 4 || d === 3) return d;
    }
    return 2;
  })();
  const loc = new Map<string, number>();
  for (const f of a.files) if (CODE_LANGS.has(f.lang)) loc.set(moduleOf(f.path, depth), (loc.get(moduleOf(f.path, depth)) ?? 0) + f.loc);
  const top = [...loc].sort((x, y) => y[1] - x[1]).slice(0, maxNodes).map((x) => x[0]);
  const idx = new Map(top.map((m, i) => [m, i]));
  const edges = new Map<string, { n: number; heuristic: boolean }>();
  for (const e of a.imports) {
    if (e.to < 0) continue;
    const s = idx.get(moduleOf(a.files[e.from].path, depth));
    const t = idx.get(moduleOf(a.files[e.to].path, depth));
    if (s === undefined || t === undefined || s === t) continue;
    const k = `${s}>${t}`;
    const cur = edges.get(k) ?? { n: 0, heuristic: false };
    cur.n++;
    if (e.conf !== 'resolved') cur.heuristic = true;
    edges.set(k, cur);
  }
  if (top.length < 2) return '';
  const lines = ['flowchart LR'];
  top.forEach((m, i) => lines.push(`  m${i}["${m.replace(/["\[\]]/g, '') || '(root)'}<br/>${fmtNum(loc.get(m)!)} lines"]`));
  for (const [k, v] of edges) {
    const [s, t] = k.split('>');
    lines.push(`  m${s} ${v.heuristic ? '-.->' : '-->'}|${v.n}| m${t}`);
  }
  return lines.join('\n');
}

export function moduleOf(path: string, depth: number): string {
  const parts = dirname(path).split('/').filter(Boolean);
  return parts.slice(0, depth).join('/') || '(root)';
}

function orientation(a: Analysis): string {
  const out: string[] = [md(a.orientation.summary), ''];
  const code_ = a.l0.languages.filter((l) => CODE_LANGS.has(l.lang));
  out.push('### Size', '', table(['Language', 'Files', 'Lines'], code_.slice(0, 12).map((l) => [langName(l.lang), l.files, fmtNum(l.loc)])), '');
  out.push(`Coverage: ${fmtNum(a.coverage.analyzed)} of ${fmtNum(a.coverage.discovered)} discovered files analysed (${a.coverage.pctFiles}% of files, ${a.coverage.pctBytes}% of bytes). Exact (L2) analysis on ${a.coverage.l2Files} files, heuristic (L1) on ${a.coverage.l1Files}.`, '');
  if (a.l0.tech.length) {
    out.push('### Stack', '');
    for (const [cat, items] of groupBy(a.l0.tech, (t) => t.category)) out.push(`- **${cat}**: ${items.map((t) => `${md(t.name)}${t.evidence[0]?.file ? ` (${loc(t.evidence[0].file, t.evidence[0].line)})` : ''}`).join(', ')}`);
    out.push('');
  }
  if (a.frameworks.length) out.push('Frameworks detected in code: ' + a.frameworks.map((f) => `${md(f.name)} (${conf(f.conf)})`).join(', ') + '.', '');
  const mains = a.entries.filter((e) => e.kind !== 'route' && e.kind !== 'page');
  if (mains.length) out.push('### Entry points', '', table(['Kind', 'Location', 'What', 'Confidence'], mains.slice(0, 30).map((e) => [e.kind, loc(e.file, e.line), md(e.label), e.conf])), '');
  out.push('### Read these files first', '', ...a.orientation.readFirst.map((r, i) => `${i + 1}. ${loc(r.file)} — ${md(r.reasons.join('; '))}`), '');
  if (a.notices.length) out.push('### Notices', '', ...a.notices.map((n) => `- ${md(n)}`), '');
  return out.join('\n');
}

function architecture(a: Analysis): string {
  const out: string[] = [];
  if (a.orientation.styles.length) {
    out.push('### Architecture style (inferred)', '');
    for (const s of a.orientation.styles) {
      out.push(`- **${md(s.name)}** — ${conf(s.conf)}, score ${Math.round(s.score * 100)}%`);
      for (const e of s.evidence.slice(0, 4)) out.push(`  - ${md(e.note)}${e.file ? ` (${loc(e.file, e.line)})` : ''}`);
    }
    out.push('');
  }
  const diagram = moduleDiagram(a);
  if (diagram) out.push('### Module dependencies', '', 'Solid arrows are compiler-resolved imports; dashed arrows include heuristic edges. Labels count import statements.', '', mermaid(diagram), '');
  const roles = [...groupBy(a.files.filter((f) => f.role !== 'unknown' && !f.test), (f) => f.role)].sort((x, y) => y[1].length - x[1].length);
  if (roles.length) out.push('### Roles', '', table(['Role', 'Files', 'Examples'], roles.map(([r, fs]) => [ROLE_LABEL[r], fs.length, fs.slice(0, 3).map((f) => code(f.path)).join(', ')])), '');
  return out.join('\n');
}

function flows(a: Analysis): string {
  const routes = a.routes.filter((r) => r.kind === 'http');
  const out: string[] = [];
  if (routes.length) {
    out.push('### Routes', '', table(['Method', 'Path', 'Handler', 'Middleware', 'Declared at', 'Confidence'], routes.slice(0, 200).map((r) => [r.method, code(r.path), r.hFile ? `${md(r.handler ?? '')} (${loc(r.hFile, r.hLine)})` : md(r.handler ?? '—'), r.middleware.map((m) => md(m.name)).join(' → ') || '—', loc(r.file, r.line), r.conf])), '');
    if (routes.length > 200) out.push(`_${routes.length - 200} more routes omitted._`, '');
  }
  // trace the most informative flows: prefer distinct handler files and deeper traces
  const traced = a.entries.slice(0, 300).map((e) => ({ e, f: traceFlow(a, e.id, { maxDepth: 6, maxSteps: 60 }) })).filter((x) => x.f && x.f.steps.length > 2);
  traced.sort((x, y) => y.f!.files.length - x.f!.files.length || y.f!.steps.length - x.f!.steps.length);
  const seen = new Set<string>();
  const picked = traced.filter((x) => {
    const k = x.f!.steps[Math.min(1, x.f!.steps.length - 1)].file + '|' + x.e.kind;
    if (seen.has(k) && seen.size >= 3) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
  for (const { e, f } of picked) {
    out.push(`### Flow: ${md(e.label)}`, '');
    f!.steps.forEach((s, i) => out.push(`${'  '.repeat(Math.max(0, s.depth - 1))}${s.depth === 0 ? `${i + 1}.` : '-'} **${s.kind}** ${md(s.label)} — ${loc(s.file, s.line)} (${s.conf})`));
    out.push('', mermaid(flowToMermaid(a, f!, 30)), '');
  }
  if (!out.length) return '';
  return out.join('\n');
}

function schema(a: Analysis): string {
  const { entities, relations, access } = a.schema;
  if (entities.length === 0) return '';
  const out: string[] = [`${entities.length} entities and ${relations.length} relations were reconstructed from ${[...new Set(entities.map((e) => e.source))].join(', ')} definitions.`, '', mermaid(erToMermaid(a.schema)), ''];
  for (const e of entities.slice(0, 80)) {
    out.push(`### ${md(e.name)}`, '', `Defined at ${loc(e.file, e.line)} (${e.source}, ${e.conf})${e.table ? `, table ${code(e.table)}` : ''}.`, '');
    out.push(table(['Field', 'Type', 'Constraints'], e.fields.map((f) => [code(f.name), code(f.type), [f.pk ? 'PK' : '', f.unique ? 'unique' : '', f.nullable === false ? 'not null' : '', f.ref ? `→ ${md(f.ref)}` : ''].filter(Boolean).join(', ')])), '');
    if (e.indexes.length) out.push('Indexes: ' + e.indexes.map((ix) => `(${ix.fields.map(md).join(', ')})${ix.unique ? ' unique' : ''}`).join('; ') + '.', '');
    const acc = access.filter((x) => x.entity === e.name);
    if (acc.length) {
      const fmt = (op: 'read' | 'write') => [...new Set(acc.filter((x) => x.op === op).map((x) => loc(x.file, x.line)))].slice(0, 12).join(', ');
      if (fmt('read')) out.push(`Read by: ${fmt('read')}.`, '');
      if (fmt('write')) out.push(`Written by: ${fmt('write')}.`, '');
    }
  }
  return out.join('\n');
}

function dependencies(a: Analysis): string {
  const d = a.deps;
  const out: string[] = [];
  out.push(`${a.imports.filter((e) => e.to >= 0).length} internal imports, ${d.cycles.length} circular path(s), ${d.violations.length} layering violation(s), ${d.godModules.length} god module(s), ${d.packages.filter((p) => p.uses.length).length} external packages in use.`, '');
  if (d.cycles.length) {
    out.push('### Circular dependencies', '');
    d.cycles.slice(0, 40).forEach((c, i) => {
      out.push(`${i + 1}. ${c.files.map((f) => code(f)).join(' → ')} → ${code(c.files[0])}`);
      for (const e of c.edges) out.push(`   - ${loc(e.from, e.line)} imports ${code(e.to)} (${e.conf})`);
    });
    out.push('');
  }
  if (d.violations.length) out.push('### Layering violations', '', table(['Location', 'From → to', 'Detail', 'Confidence'], d.violations.slice(0, 100).map((v) => [loc(v.file, v.line), `${v.fromRole} → ${v.toRole}`, md(v.detail), v.conf])), '');
  if (d.godModules.length) out.push('### God modules', '', table(['File', 'Why'], d.godModules.map((g) => [loc(g.file), md(g.reasons.join('; '))])), '');
  const top = [...d.metrics].sort((x, y) => y.fanIn - x.fanIn).slice(0, 15).filter((m) => m.fanIn > 0);
  if (top.length) out.push('### Most depended-on files', '', table(['File', 'Fan-in', 'Fan-out', 'Instability'], top.map((m) => [loc(m.file), m.fanIn, m.fanOut, m.instability.toFixed(2)])), '');
  const pk = d.packages.filter((p) => p.uses.length && !/^[a-z]+:/.test(p.name)).slice(0, 60);
  if (pk.length) out.push('### External packages', '', table(['Package', 'Version', 'Declared', 'Files using it'], pk.map((p) => [code(p.name), md(p.version ?? ''), p.declared ? 'yes' : 'not in a manifest', new Set(p.uses.map((u) => u.file)).size])), '');
  return out.join('\n');
}

const CAT_TITLE: Record<Finding['cat'], string> = {
  hotspot: 'Hotspots (churn × complexity)', secret: 'Possible hardcoded secrets', 'tls-disabled': 'TLS verification disabled', 'sql-concat': 'SQL built by concatenation', eval: 'Dynamic code execution',
  complexity: 'High complexity', nesting: 'Deep nesting', 'oversize-function': 'Long functions', 'oversize-file': 'Large files', clone: 'Duplicated code', 'dead-export': 'Unused exports', todo: 'TODO / FIXME / HACK',
};

function hotspots(a: Analysis): string {
  if (a.findings.length === 0) return 'No health signals were raised.';
  const out: string[] = ['These are signals to review, not verdicts. Pattern-based items are heuristic and can be false positives.', ''];
  const groups = groupBy(a.findings, (f) => f.cat);
  for (const cat of Object.keys(CAT_TITLE) as Finding['cat'][]) {
    const items = groups.get(cat);
    if (!items) continue;
    out.push(`### ${CAT_TITLE[cat]} (${items.length})`, '', table(['Severity', 'Location', 'Signal', 'Confidence'], items.slice(0, 40).map((f) => [f.sev, loc(f.file, f.line), md(f.msg), f.conf])), '');
    if (items.length > 40) out.push(`_${items.length - 40} more not shown._`, '');
  }
  return out.join('\n');
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function history(a: Analysis): string {
  const g = a.git;
  if (!g) return '';
  const out: string[] = [
    `Read from the uploaded \`.git\` folder (branch ${code(g.branch)}, HEAD ${code(g.head.slice(0, 7))}): ${g.totalCommits} commit(s)${g.truncated ? ' (the most recent ones only; history was truncated)' : ''} by ${g.authors.length} author(s). Counts are exact (_resolved_); what they suggest (coupling, ownership risk) is _heuristic_.`, '',
    `**Bus factor: ${g.busFactor.overall}.** The fewest authors who are the main author of more than half of the files that still exist.`, '',
  ];
  for (const n of g.notes) out.push(`- ${md(n)}`);
  if (g.notes.length) out.push('');
  if (g.churn.length) out.push('### Most changed files', '', table(['File', 'Commits', 'Authors', 'Main author', 'Last change'], g.churn.slice(0, 20).map((c) => [loc(c.file), c.commits, c.authors, `${md(c.topAuthor)} (${Math.round(c.topAuthorShare * 100)}%)`, day(c.lastTime)])), '');
  if (g.cochange.length) {
    out.push('### Files that change together', '', 'Pairs that were changed in the same commits. A pair with no import between them is likely hidden coupling: a change to one usually needs a change to the other, and nothing in the code says so.', '');
    out.push(table(['File A', 'File B', 'Together', 'Score', 'Import between them'], g.cochange.slice(0, 25).map((c) => [loc(c.a), loc(c.b), c.count, c.score.toFixed(2), c.linked === undefined ? 'unknown' : c.linked ? 'yes' : 'no: hidden coupling'])), '');
  }
  if (g.busFactor.risky.length) out.push('### Single-owner files', '', 'Code files with at least 3 commits where one author made 80% or more of the changes.', '', table(['File', 'Owner', 'Share', 'Commits'], g.busFactor.risky.map((r) => [loc(r.file), md(r.author), `${Math.round(r.share * 100)}%`, r.commits])), '');
  if (g.renames?.length) out.push('### Renamed and moved files', '', 'History of the old path is counted under the current name. Identical content is _resolved_; an edited move (50% or more shared lines) is _heuristic_.', '', table(['From', 'To', 'Similarity', 'When', 'Confidence'], g.renames.slice(0, 25).map((r) => [loc(r.from), loc(r.to), `${Math.round(r.similarity * 100)}%`, day(r.time), conf(r.conf)])), '');
  const types = Object.entries(g.messages.types).sort((x, y) => y[1] - x[1]);
  if (types.length) out.push('### Commit types', '', types.map(([t, n]) => `${t} ${n}`).join(' · ') + '.', '', g.messages.keywords.length ? `Frequent words in commit subjects: ${g.messages.keywords.slice(0, 15).map((k) => `${md(k.word)} (${k.count})`).join(', ')}.` : '', '');
  if (g.snapshots.length) {
    out.push('### Architecture over time', '', table(['Snapshot', 'Code files', 'Lines', 'Modules', 'Avg. function complexity'], g.snapshots.map((s) => [md(s.label), s.files, fmtNum(s.loc), s.modules.length, s.avgComplexity])), '');
    if (g.snapshots.length >= 2) {
      const first = g.snapshots[0];
      const last = g.snapshots[g.snapshots.length - 1];
      const d = diffSnapshots(first, last);
      out.push(`From ${md(first.label)} to ${md(last.label)}: ${d.files[0]} → ${d.files[1]} code files, ${fmtNum(d.loc[0])} → ${fmtNum(d.loc[1])} lines.`, '');
      if (d.addedModules.length) out.push(`- Modules added: ${d.addedModules.map((m) => code(m.name)).join(', ')}`);
      if (d.removedModules.length) out.push(`- Modules removed: ${d.removedModules.map((m) => code(m.name)).join(', ')}`);
      if (d.addedEdges.length) out.push(`- New module dependencies: ${d.addedEdges.slice(0, 20).map((e) => `${code(e.from)} → ${code(e.to)}`).join(', ')}`);
      if (d.removedEdges.length) out.push(`- Dropped module dependencies: ${d.removedEdges.slice(0, 20).map((e) => `${code(e.from)} → ${code(e.to)}`).join(', ')}`);
      out.push('');
    }
  }
  return out.join('\n');
}

export const SECTIONS: ReportSection[] = [
  { id: 'orientation', title: 'Orientation', build: orientation },
  { id: 'architecture', title: 'Architecture', build: architecture },
  { id: 'flows', title: 'Routes and flows', build: flows },
  { id: 'schema', title: 'Data model', build: schema },
  { id: 'dependencies', title: 'Dependencies', build: dependencies },
  { id: 'hotspots', title: 'Hotspots and health', build: hotspots },
  { id: 'history', title: 'History', build: history },
];

export interface BuiltSection {
  id: string;
  title: string;
  markdown: string;
}

export function buildSections(a: Analysis, ids?: string[]): BuiltSection[] {
  const out: BuiltSection[] = [];
  for (const s of SECTIONS) {
    if (ids && !ids.includes(s.id)) continue;
    let body = '';
    try {
      body = s.build(a).trim();
    } catch (e) {
      body = `_This section could not be generated: ${md(e instanceof Error ? e.message : String(e))}_`;
    }
    if (body) out.push({ id: s.id, title: s.title, markdown: body });
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function fullMarkdown(a: Analysis, ids?: string[]): string {
  const sections = buildSections(a, ids);
  const out = [
    `# ${md(a.name)} — codebase report`, '',
    `Generated by imex on ${new Date(a.createdAt).toISOString().slice(0, 10)}. Everything below was inferred statically, in the browser; each fact is labelled _resolved_ (exact), _heuristic_ (inferred) or _unresolved_.`, '',
    '## Contents', '', ...sections.map((s) => `- [${s.title}](#${slug(s.title)})`), '',
  ];
  for (const s of sections) out.push(`## ${s.title}`, '', s.markdown, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/** Notion-importable ZIP layout: an index page plus one page per section in a sub-folder named after the index. */
export function notionPages(a: Analysis, ids?: string[]): { path: string; content: string }[] {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|#%]/g, ' ').replace(/\s+/g, ' ').trim();
  const root = safe(`${a.name} imex report`);
  const sections = buildSections(a, ids);
  const file = (i: number, title: string) => `${String(i + 1).padStart(2, '0')} ${safe(title)}.md`;
  const pages = sections.map((s, i) => ({
    path: `${root}/${file(i, s.title)}`,
    content: `# ${s.title}\n\n[← ${root}](../${encodeURI(root)}.md)${i > 0 ? ` · [Previous: ${sections[i - 1].title}](${encodeURI(file(i - 1, sections[i - 1].title))})` : ''}${i < sections.length - 1 ? ` · [Next: ${sections[i + 1].title}](${encodeURI(file(i + 1, sections[i + 1].title))})` : ''}\n\n${s.markdown}\n`,
  }));
  const index = [
    `# ${md(root)}`, '', md(a.orientation.summary), '',
    `Generated by imex on ${new Date(a.createdAt).toISOString().slice(0, 10)}. Facts are labelled resolved (exact), heuristic (inferred) or unresolved.`, '',
    '## Pages', '', ...sections.map((s, i) => `- [${s.title}](${encodeURI(root)}/${encodeURI(file(i, s.title))})`), '',
  ].join('\n');
  return [{ path: `${root}.md`, content: index }, ...pages];
}
