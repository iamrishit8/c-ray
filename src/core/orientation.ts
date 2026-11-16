// Orientation: summary paragraph, architecture style guess (with evidence) and
// the ranked "read these files first" list. Works at every pipeline stage and
// simply gets better as more layers complete.
import type { Analysis, Confidence, EntryPoint, Evidence, FileUnit, Orientation } from './types';
import { CODE_LANGS } from './l0/languages';
import { modelOf } from './model';
import { basename, dirname, fmtNum, joinPath, lineOf } from './util';

const LANG_NAME: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python', java: 'Java', go: 'Go', c: 'C', cpp: 'C++',
  csharp: 'C#', php: 'PHP', ruby: 'Ruby', rust: 'Rust', kotlin: 'Kotlin', sql: 'SQL', swift: 'Swift', scala: 'Scala',
};
export function langName(l: string): string {
  return LANG_NAME[l] ?? l.charAt(0).toUpperCase() + l.slice(1);
}

const MAIN_PATTERNS: [string[], RegExp, string][] = [
  [['python'], /^if\s+__name__\s*==\s*["']__main__["']\s*:/m, 'Python __main__ guard'],
  [['go'], /^func\s+main\s*\(\s*\)/m, 'Go func main()'],
  [['java'], /public\s+static\s+void\s+main\s*\(/, 'Java main method'],
  [['kotlin'], /^fun\s+main\s*\(/m, 'Kotlin fun main()'],
  [['c', 'cpp'], /^\s*(?:int|void)\s+main\s*\(/m, 'C/C++ main()'],
  [['rust'], /^(?:pub\s+)?(?:async\s+)?fn\s+main\s*\(\s*\)/m, 'Rust fn main()'],
  [['csharp'], /static\s+(?:async\s+)?(?:void|int|Task(?:<int>)?)\s+Main\s*\(|WebApplication\.CreateBuilder\s*\(|Host\.CreateDefaultBuilder\s*\(/, '.NET entry point'],
  [['javascript', 'typescript'], /\.listen\s*\(\s*(?:[\w.]*port|process\.env|\d{2,5}|config|\{)/i, 'starts a server (.listen)'],
  [['javascript', 'typescript'], /\bcreateRoot\s*\(|ReactDOM\.render\s*\(|\bcreateApp\s*\([^)]*\)\s*\.mount|new\s+Vue\s*\(/, 'mounts the UI'],
];

/** Language-agnostic entry point detection: mains, shebang scripts, manifest-declared entries. */
export function detectGenericEntries(a: Analysis, units: FileUnit[]): EntryPoint[] {
  const out: EntryPoint[] = [];
  const seen = new Set<string>();
  const paths = new Set(a.files.map((f) => f.path));
  const add = (file: string, line: number, kind: EntryPoint['kind'], label: string, conf: Confidence) => {
    if (seen.has(file) || !paths.has(file)) return;
    seen.add(file);
    out.push({ id: `${kind}:${file}`, kind, label, file, line, conf });
  };
  for (const m of a.l0.manifests) {
    if (m.type !== 'package.json') continue;
    const dir = dirname(m.file);
    const unit = units.find((u) => u.path === m.file);
    try {
      const json = unit ? JSON.parse(unit.text) : {};
      const cands: string[] = [];
      if (typeof json.main === 'string') cands.push(json.main);
      if (typeof json.bin === 'string') cands.push(json.bin);
      else if (json.bin && typeof json.bin === 'object') cands.push(...(Object.values(json.bin) as string[]));
      for (const c of cands) {
        for (const p of [joinPath(dir, c), joinPath(dir, c + '.js'), joinPath(dir, c + '.ts')]) {
          if (paths.has(p)) add(p, 1, json.bin ? 'cli' : 'main', `${m.name ?? 'package'}: declared in ${basename(m.file)}`, 'resolved');
        }
      }
      const start = json.scripts?.start ?? json.scripts?.dev;
      const sm = typeof start === 'string' ? /(?:node|ts-node|tsx|nodemon|bun)\s+(?:-\S+\s+)*([\w./-]+\.[cm]?[jt]sx?)/.exec(start) : null;
      if (sm && paths.has(joinPath(dir, sm[1]))) add(joinPath(dir, sm[1]), 1, 'main', `start script: ${start}`, 'resolved');
    } catch {
      /* malformed manifest: ignore */
    }
  }
  for (const u of units) {
    if (!CODE_LANGS.has(u.lang)) continue;
    const f = modelOf(a).file(u.path);
    if (f?.test) continue;
    for (const [langs, re, label] of MAIN_PATTERNS) {
      if (!langs.includes(u.lang)) continue;
      const m = re.exec(u.text);
      if (m) {
        add(u.path, lineOf(u.text, m.index), 'main', label, 'heuristic');
        break;
      }
    }
    if (u.text.startsWith('#!') && !seen.has(u.path)) add(u.path, 1, 'cli', `executable script (${u.text.slice(2, u.text.indexOf('\n')).trim()})`, 'heuristic');
    if (u.lang === 'php' && /^(public\/|web\/|htdocs\/)?index\.php$/.test(u.path)) add(u.path, 1, 'main', 'PHP front controller', 'heuristic');
    if (basename(u.path) === 'config.ru') add(u.path, 1, 'main', 'Rack entry point', 'heuristic');
  }
  return out;
}

function ev(file: string, note: string, kind: Evidence['kind'] = 'structure', line = 1): Evidence {
  return { file, line, note, kind };
}

export function guessStyles(a: Analysis): Orientation['styles'] {
  const styles: Orientation['styles'] = [];
  const roleFiles = new Map<string, string[]>();
  for (const f of a.files) {
    const arr = roleFiles.get(f.role) ?? [];
    arr.push(f.path);
    roleFiles.set(f.role, arr);
  }
  const has = (r: string) => (roleFiles.get(r)?.length ?? 0) > 0;
  const sample = (r: string) => roleFiles.get(r)![0];
  const tech = new Set(a.l0.tech.map((t) => t.id));
  const fw = new Set(a.frameworks.map((f) => f.id));
  const push = (name: string, score: number, evidence: Evidence[], conf: Confidence = 'heuristic') => {
    if (score > 0 && evidence.length) styles.push({ name, conf, score: Math.min(1, score), evidence });
  };

  // Layered
  {
    const layers = ['controller', 'service', 'repository', 'model', 'route'].filter(has);
    const e = layers.map((r) => ev(sample(r), `${roleFiles.get(r)!.length} file(s) in the "${r}" layer, e.g. ${sample(r)}`));
    let score = layers.length >= 3 ? 0.5 + 0.1 * layers.length : layers.length === 2 ? 0.35 : 0;
    if (has('controller') && has('service')) score += 0.1;
    push('Layered (controllers → services → data access)', score, e);
  }
  // MVC
  {
    const e: Evidence[] = [];
    let score = 0;
    for (const id of ['django', 'rails', 'laravel', 'spring-boot', 'aspnet']) {
      const f = a.frameworks.find((x) => x.id === id) ?? a.l0.tech.find((x) => x.id === id);
      if (f) {
        score += 0.45;
        e.push({ ...f.evidence[0], note: `${f.name} is an MVC-style framework (${f.evidence[0].note})` });
      }
    }
    if (has('model') && has('view') && has('controller')) {
      score += 0.45;
      e.push(ev(sample('model'), 'models, views and controllers directories all present'));
    } else if (has('model') && has('controller')) {
      score += 0.2;
      e.push(ev(sample('controller'), 'controllers and models present'));
    }
    push('MVC', score, e);
  }
  // Microservices vs monolith
  {
    const svcManifests = a.l0.manifests.filter((m) => m.file.includes('/') && !['composer.json'].includes(m.type) && m.deps.length > 0);
    const dirs = new Set(svcManifests.map((m) => dirname(m.file)));
    const dockerDirs = new Set(a.l0.configs.filter((c) => c.kind === 'docker').map((c) => dirname(c.file)));
    const deployable = [...dirs].filter((d) => dockerDirs.has(d));
    const compose = a.l0.configs.find((c) => c.kind === 'compose');
    const e: Evidence[] = [];
    let score = 0;
    if (deployable.length >= 2) {
      score += 0.6;
      e.push(...deployable.slice(0, 4).map((d) => ev(d + '/Dockerfile', `independently deployable unit: ${d} (own manifest + Dockerfile)`, 'config')));
    }
    if (compose && /: (.+,.+,)/.test(compose.detail)) {
      score += 0.2;
      e.push(ev(compose.file, compose.detail, 'config'));
    }
    const entryDirs = new Set(a.entries.filter((x) => x.kind === 'main').map((x) => x.file.split('/').slice(0, 2).join('/')));
    if (dirs.size >= 3 && entryDirs.size >= 3 && score === 0) {
      score += 0.35;
      e.push(ev([...dirs][0], `${dirs.size} sub-projects with their own manifests and ${entryDirs.size} separate entry points`));
    }
    push('Microservices / multi-service', score, e);
    if (score < 0.5) {
      const mains = a.entries.filter((x) => x.kind === 'main');
      const me: Evidence[] = [];
      if (a.l0.manifests.length) me.push(ev(a.l0.manifests[0].file, `${a.l0.manifests.length === 1 ? 'a single manifest' : `${a.l0.manifests.length} manifests but no independently deployable services`}`, 'manifest'));
      if (mains.length) me.push(ev(mains[0].file, `${mains.length} process entry point(s), e.g. ${mains[0].file}`, 'code', mains[0].line));
      push('Monolith (single deployable)', mains.length <= 2 ? 0.55 : 0.35, me);
    }
  }
  // Monorepo
  {
    const ws = a.l0.tech.find((t) => t.id === 'workspaces');
    if (ws) push('Modular monorepo (workspace packages)', 0.8, ws.evidence, 'resolved');
  }
  // Event-driven
  {
    const q = a.l0.tech.filter((t) => t.category === 'queue' && t.id !== 'cron');
    const pubsub = a.facts.filter((f) => f.kind === 'queue-pub' || f.kind === 'queue-sub');
    const e: Evidence[] = [...q.map((t) => t.evidence[0]), ...pubsub.slice(0, 4).map((f) => ev(f.file, f.detail, 'code', f.line))];
    push('Event-driven (message queues / pub-sub)', (q.length ? 0.3 : 0) + Math.min(0.5, pubsub.length * 0.12), e);
  }
  // Component-based SPA
  {
    const ui = ['react', 'vue', 'angular', 'svelte'].map((id) => a.l0.tech.find((t) => t.id === id)).filter(Boolean);
    if (ui.length) {
      const e = [ui[0]!.evidence[0]];
      if (has('component')) e.push(ev(sample('component'), `${roleFiles.get('component')!.length} UI component file(s)`));
      push(`Component-based frontend (${ui[0]!.name})`, has('component') ? 0.7 : 0.4, e);
    }
  }
  // Script-style legacy (no layers at all)
  if (!styles.some((s) => s.score >= 0.5) && a.files.filter((f) => CODE_LANGS.has(f.lang)).length > 3 && !tech.size && !fw.size) {
    const top = a.files.find((f) => CODE_LANGS.has(f.lang))!;
    push('Script-style / unstructured (no framework or layer conventions detected)', 0.4, [ev(top.path, 'no manifest-declared framework and no conventional layer directories')]);
  }
  return styles.sort((x, y) => y.score - x.score);
}

export function rankReadFirst(a: Analysis): Orientation['readFirst'] {
  const m = modelOf(a);
  const n = a.files.length;
  const entryFiles = new Set(a.entries.map((e) => m.fileIdx.get(e.file)).filter((i): i is number => i !== undefined));
  // BFS distance from the nearest entry point along import edges
  const dist = new Array<number>(n).fill(Infinity);
  let frontier = [...entryFiles];
  for (const i of frontier) dist[i] = 0;
  for (let d = 1; frontier.length && d < 12; d++) {
    const next: number[] = [];
    for (const i of frontier) for (const j of m.deps(i)) if (dist[j] === Infinity) {
      dist[j] = d;
      next.push(j);
    }
    frontier = next;
  }
  // centrality: damped in-degree (two rounds of PageRank-like propagation)
  let rank = new Array<number>(n).fill(1);
  for (let iter = 0; iter < 8; iter++) {
    const nr = new Array<number>(n).fill(0.15);
    for (let i = 0; i < n; i++) {
      const deps = m.deps(i);
      for (const j of deps) nr[j] += (0.85 * rank[i]) / deps.length;
    }
    rank = nr;
  }
  const maxRank = Math.max(1e-9, ...rank);
  const scored: Orientation['readFirst'] = [];
  for (let i = 0; i < n; i++) {
    const f = a.files[i];
    if (!CODE_LANGS.has(f.lang) || f.test || f.role === 'migration') continue;
    const central = rank[i] / maxRank;
    const prox = dist[i] === Infinity ? 0 : 1 / (1 + dist[i]);
    const sane = f.loc < 5 ? 0.1 : f.loc <= 400 ? 1 : f.loc <= 1500 ? 0.6 : 0.25;
    const score = 0.45 * central + 0.35 * prox + 0.2 * sane;
    const reasons: string[] = [];
    if (dist[i] === 0) reasons.push('entry point');
    else if (dist[i] < Infinity) reasons.push(`${dist[i]} import hop${dist[i] === 1 ? '' : 's'} from an entry point`);
    const dependents = m.dependents(i).length;
    if (dependents) reasons.push(`imported by ${dependents} file${dependents === 1 ? '' : 's'}`);
    if (f.role !== 'unknown') reasons.push(`role: ${f.role}`);
    reasons.push(`${fmtNum(f.loc)} lines`);
    scored.push({ file: f.path, score: Math.round(score * 1000) / 1000, reasons });
  }
  scored.sort((x, y) => y.score - x.score || (x.file < y.file ? -1 : 1));
  const out: Orientation['readFirst'] = [];
  const readme = a.l0.docs.filter((d) => d.kind === 'readme').sort((x, y) => x.file.length - y.file.length)[0];
  if (readme) out.push({ file: readme.file, score: 1, reasons: ['project documentation'] });
  // keep the list diverse: at most 3 files per directory
  const perDir = new Map<string, number>();
  for (const s of scored) {
    const d = dirname(s.file);
    const c = perDir.get(d) ?? 0;
    if (c >= 3) continue;
    perDir.set(d, c + 1);
    out.push(s);
    if (out.length >= 10) break;
  }
  return out;
}

export function buildSummary(a: Analysis): string {
  const code = a.l0.languages.filter((l) => CODE_LANGS.has(l.lang));
  const totalLoc = code.reduce((s, l) => s + l.loc, 0);
  const parts: string[] = [];
  if (a.mode === 'file') {
    const f = a.files[0];
    return f
      ? `${f.path} is a single ${langName(f.lang)} file with ${fmtNum(f.loc)} lines and ${a.symbols.length} definition(s). File Mode shows its functions, internal call graph and complexity; architecture views need more files.`
      : 'No analysable file was provided.';
  }
  if (!code.length) return `${a.name} contains ${fmtNum(a.files.length)} analysable file(s) but no recognised source code.`;
  const main = code[0];
  const others = code.slice(1, 4).filter((l) => l.loc / Math.max(1, totalLoc) > 0.03).map((l) => langName(l.lang));
  const fws = a.frameworks.length ? a.frameworks.map((f) => f.name) : a.l0.tech.filter((t) => t.category === 'framework' || t.category === 'ui').map((t) => t.name);
  const kind = a.routes.some((r) => r.kind === 'http') ? (a.facts.some((f) => f.kind === 'component') ? 'full-stack web application' : 'web API / backend') : a.facts.some((f) => f.kind === 'component') || fws.some((f) => /React|Vue|Angular|Svelte/.test(f)) ? 'frontend application' : a.entries.some((e) => e.kind === 'cli') ? 'command-line tool' : 'codebase';
  parts.push(`${a.name} is a ${langName(main.lang)}${others.length ? ` (+ ${others.join(', ')})` : ''} ${kind}${fws.length ? ` built with ${fws.slice(0, 4).join(', ')}` : ''}.`);
  parts.push(`It has ${fmtNum(a.files.length)} analysed files and about ${fmtNum(totalLoc)} lines of code.`);
  const style = a.orientation.styles[0];
  if (style) parts.push(`The structure most resembles a ${style.name.replace(/\s*\(.*\)$/, '').toLowerCase()} architecture (${style.conf}).`);
  const data = a.l0.tech.filter((t) => t.category === 'orm' || t.category === 'database').map((t) => t.name);
  if (a.schema.entities.length) parts.push(`${a.schema.entities.length} data entit${a.schema.entities.length === 1 ? 'y was' : 'ies were'} reconstructed${data.length ? ` (${data.slice(0, 3).join(', ')})` : ''}.`);
  else if (data.length) parts.push(`Data access uses ${data.slice(0, 3).join(', ')}.`);
  const http = a.routes.filter((r) => r.kind === 'http').length;
  if (http) parts.push(`It exposes ${http} HTTP route${http === 1 ? '' : 's'}.`);
  const mains = a.entries.filter((e) => e.kind === 'main' || e.kind === 'cli');
  if (mains.length) parts.push(`Execution starts at ${mains.slice(0, 3).map((e) => e.file).join(', ')}${mains.length > 3 ? ` and ${mains.length - 3} more` : ''}.`);
  if (a.stage !== 'done') parts.push('(Deeper analysis is still running; this summary will be refined.)');
  return parts.join(' ');
}

export function buildOrientation(a: Analysis): Orientation {
  const o: Orientation = { summary: '', styles: guessStyles(a), readFirst: rankReadFirst(a) };
  a.orientation = o;
  o.summary = buildSummary(a);
  return o;
}
