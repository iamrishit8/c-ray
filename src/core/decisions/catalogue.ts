// The decision catalogue (D40): one detector per kind of architectural decision. Each reads facts the earlier
// stages already established (tech hits, frameworks, routes, schema, deps, findings), adds its own evidence with
// file:line, and states how sure it is. A detector returns null when the project gives no signal, and never
// invents "absence" claims except where an absence is itself useful and exact (no tests, no recognised auth).
import { CODE_LANGS } from '../l0/languages';
import { techById } from '../l0/tech';
import { langName } from '../orientation';
import type { Analysis, Claim, Confidence, Decision, Evidence, FileUnit, TechHit } from '../types';
import { basename, dirname, fmtNum, lineOf } from '../util';
import { findRationale } from './docs';

export interface Ctx {
  a: Analysis;
  units: Map<string, FileUnit>;
  /** README and other prose docs (not ADRs, not changelogs), shortest path first. */
  docFiles: string[];
}

const RANK: Record<Confidence, number> = { resolved: 2, heuristic: 1, unresolved: 0 };
/** The weakest of several confidences (a claim is only as sure as its least sure part). */
export function minConf(list: Confidence[]): Confidence {
  return list.reduce<Confidence>((m, c) => (RANK[c] < RANK[m] ? c : m), 'resolved');
}

const plural = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`;
const names = (list: string[]) => (list.length <= 1 ? list.join('') : list.length === 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
const techs = (a: Analysis, ...cats: TechHit['category'][]) => a.l0.tech.filter((t) => cats.includes(t.category));
const techTradeoffs = (ids: string[]) => ids.flatMap((id) => techById(id)?.tradeoffs ?? []).slice(0, 4);
const ev = (file: string, line: number, note: string, kind: Evidence['kind'] = 'code'): Evidence => ({ file, line, note, kind });
const real = (list: Evidence[]) => list.filter((e) => e.file);
const uniqEv = (list: Evidence[], max = 5): Evidence[] => {
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(e.file + ':' + e.line + e.note) ? false : (seen.add(e.file + ':' + e.line + e.note), true))).slice(0, max);
};
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const codeFiles = (a: Analysis) => a.files.filter((f) => CODE_LANGS.has(f.lang));

function mk(d: Omit<Decision, 'tradeoffs' | 'observed' | 'source'> & Partial<Pick<Decision, 'tradeoffs' | 'observed'>>): Decision {
  return { tradeoffs: [], observed: [], source: 'inferred', ...d };
}

/** Attach the team's own explanation when the docs give one (resolved), else the fallback (heuristic) if any. */
function withWhy(c: Ctx, d: Decision, terms: string[], fallback?: string): Decision {
  const doc = findRationale([...c.units.values()], c.docFiles, terms);
  if (doc) d.why = doc;
  else if (fallback) d.why = { text: fallback, conf: 'heuristic' };
  return d;
}

// ---------------------------------------------------------------- architecture

const STYLE_TRADEOFFS: [RegExp, string[]][] = [
  [/^Layered/, ['A predictable place for each kind of code, and each layer is easy to test on its own.', 'Layers turn into pass-through boilerplate, and shortcuts (a controller touching the database) erode the separation over time.']],
  [/^MVC/, ['Familiar convention: new developers know where models, views and controllers live.', 'Business logic tends to drift into controllers or models unless a service layer is added.']],
  [/^Microservices/, ['Services deploy and scale independently and teams can own them.', 'Network calls, versioned contracts and distributed failures replace in-process calls.']],
  [/^Monolith/, ['One deployable: simple to run, debug and change across modules.', 'Everything scales and releases together, and module boundaries are kept only by discipline.']],
  [/^Event-driven/, ['Producers and consumers are decoupled and can be added independently.', 'Flow is harder to follow, and delivery, ordering and retries need deliberate handling.']],
  [/^Component-based/, ['Reusable UI pieces with local state, composed into pages.', 'Shared state and data fetching need a separate convention as the app grows.']],
  [/^Script-style/, ['Quick to write and easy to read top to bottom.', 'No enforced structure: logic, markup and data access mix, so changes ripple unpredictably.']],
];

function architecture(c: Ctx): Decision | null {
  const { a } = c;
  // Layout and deployment shape are orthogonal (a layered monolith is both), so report up to two styles.
  const styles = a.orientation.styles.filter((s) => !/^Modular monorepo/.test(s.name) && s.score >= 0.4).slice(0, 2);
  if (!styles.length) return null;
  const observed: Claim[] = [];
  const layered = styles.some((s) => /^Layered|^MVC/.test(s.name));
  const v = a.deps.violations;
  if (layered) {
    observed.push(v.length
      ? { text: `${plural(v.length, 'layering violation')}: code calls across layers it should not, e.g. ${lc(v[0].detail)}`, conf: minConf(v.map((x) => x.conf)), file: v[0].file, line: v[0].line }
      : { text: 'No layering violations were found.', conf: 'heuristic' });
  }
  if (a.deps.cycles.length) observed.push({ text: `${plural(a.deps.cycles.length, 'circular dependency', 'circular dependencies')} between files (e.g. ${a.deps.cycles[0].files.slice(0, 3).join(' → ')}).`, conf: minConf(a.deps.cycles[0].edges.map((e) => e.conf)), file: a.deps.cycles[0].files[0], line: a.deps.cycles[0].edges[0]?.line ?? 1 });
  if (a.deps.godModules.length) observed.push({ text: `${plural(a.deps.godModules.length, 'god module')} concentrate too many dependencies, e.g. ${a.deps.godModules[0].file}.`, conf: 'heuristic', file: a.deps.godModules[0].file, line: 1 });
  const d = mk({
    id: 'architecture', title: 'Architecture style', category: 'Architecture',
    decision: `Structured as: ${names(styles.map((s) => s.name))}.`, conf: minConf(styles.map((s) => s.conf)), evidence: uniqEv(styles.flatMap((s) => s.evidence.slice(0, 3)), 5),
    tradeoffs: styles.flatMap((s) => STYLE_TRADEOFFS.find(([re]) => re.test(s.name))?.[1] ?? []).slice(0, 4), observed,
  });
  return withWhy(c, d, ['layered', 'layers', 'mvc', 'monolith', 'microservices', 'architecture'], `Inferred from the structure alone: ${styles[0].evidence.slice(0, 2).map((e) => e.note).join('; ')}.`);
}

function repoLayout(c: Ctx): Decision | null {
  const { a } = c;
  const ws = a.l0.tech.find((t) => t.id === 'workspaces');
  if (!ws) return null;
  const roots = a.l0.manifests.filter((m) => m.type === 'package.json' && m.file.includes('/') && m.name).map((m) => ({ dir: dirname(m.file), name: m.name! }));
  const pkgOf = (path: string) => roots.find((r) => path === r.dir || path.startsWith(r.dir + '/'))?.name;
  const crossing = a.imports.filter((e) => e.to >= 0 && pkgOf(a.files[e.from].path) && pkgOf(a.files[e.to].path) && pkgOf(a.files[e.from].path) !== pkgOf(a.files[e.to].path));
  const observed: Claim[] = [];
  if (roots.length) observed.push({ text: `${plural(roots.length, 'package')}: ${names(roots.map((r) => r.name))}.`, conf: 'resolved', file: ws.evidence[0].file, line: ws.evidence[0].line });
  if (crossing.length) observed.push({ text: `${plural(crossing.length, 'import')} go from one package into another.`, conf: minConf(crossing.map((e) => e.conf)), file: a.files[crossing[0].from].path, line: crossing[0].line });
  const tools = techs(a, 'build').filter((t) => ['turbo', 'nx', 'lerna'].includes(t.id));
  const d = mk({
    id: 'repo-layout', title: 'Repository layout', category: 'Architecture',
    decision: `A monorepo of workspace packages${tools.length ? `, orchestrated with ${names(tools.map((t) => t.name))}` : ''}.`,
    conf: 'resolved', evidence: uniqEv([...ws.evidence, ...tools.flatMap((t) => t.evidence)], 4),
    tradeoffs: ['One place to change shared code, so contract changes show up as compile errors.', 'Builds, CI and code ownership need tooling as the repo grows.'], observed,
  });
  return withWhy(c, d, ['monorepo', 'workspace', 'workspaces']);
}

function messaging(c: Ctx): Decision | null {
  const { a } = c;
  const brokers = techs(a, 'queue').filter((t) => !['cron', 'celery', 'sidekiq', 'bull'].includes(t.id));
  const facts = a.facts.filter((f) => f.kind === 'queue-pub' || f.kind === 'queue-sub');
  if (!brokers.length && !facts.length) return null;
  const pubs = facts.filter((f) => f.kind === 'queue-pub');
  const subs = facts.filter((f) => f.kind === 'queue-sub');
  const topics = (list: typeof facts) => names([...new Set(list.map((f) => f.target).filter((t): t is string => !!t))].slice(0, 4));
  const observed: Claim[] = [];
  if (facts.length) {
    observed.push({ text: `${pubs.length ? `Publishes ${topics(pubs) || plural(pubs.length, 'message')}` : ''}${pubs.length && subs.length ? '; ' : ''}${subs.length ? `subscribes to ${topics(subs) || plural(subs.length, 'topic')}` : ''}.`, conf: minConf(facts.map((f) => f.conf)), file: facts[0].file, line: facts[0].line });
  }
  return mk({
    id: 'messaging', title: 'Asynchronous messaging', category: 'Architecture',
    decision: brokers.length ? `Components communicate asynchronously through ${names(brokers.map((t) => t.name))}.` : 'Components communicate asynchronously through a message queue or event bus.',
    conf: brokers.length ? 'resolved' : 'heuristic',
    evidence: uniqEv([...brokers.flatMap((t) => t.evidence.slice(0, 2)), ...facts.slice(0, 3).map((f) => ev(f.file, f.line, f.detail))], 5),
    tradeoffs: techTradeoffs(brokers.map((t) => t.id)), observed,
  });
}

// ---------------------------------------------------------------- stack

function languages(c: Ctx): Decision | null {
  const { a } = c;
  const code = a.l0.languages.filter((l) => CODE_LANGS.has(l.lang) && l.loc > 0);
  const total = code.reduce((s, l) => s + l.loc, 0);
  if (!total) return null;
  const main = code.filter((l) => l.loc / total >= 0.03);
  const biggest = [...a.files].filter((f) => f.lang === main[0].lang).sort((x, y) => y.loc - x.loc)[0];
  return mk({
    id: 'languages', title: 'Languages', category: 'Stack',
    decision: `${main.map((l) => `${langName(l.lang)} (${Math.round((l.loc / total) * 100)}%)`).join(', ')}.`,
    conf: 'resolved', evidence: biggest ? [ev(biggest.path, 1, `largest ${langName(main[0].lang)} file, ${fmtNum(biggest.loc)} lines`, 'structure')] : [],
    tradeoffs: main.length > 1 ? ['Each part uses a fitting language, at the price of more tooling and more skills needed on the team.', ...(main[0].lang === 'typescript' ? techTradeoffs(['typescript']) : [])] : main[0].lang === 'typescript' ? techTradeoffs(['typescript']) : [],
  });
}

function framework(c: Ctx): Decision | null {
  const { a } = c;
  const fromTech = techs(a, 'framework');
  const fw = new Map<string, { id: string; name: string; conf: Confidence; evidence: Evidence[] }>();
  for (const t of fromTech) fw.set(t.id, { id: t.id, name: t.name, conf: t.conf, evidence: t.evidence.slice(0, 2) });
  for (const f of a.frameworks) {
    if (f.id === 'react') continue; // the UI framework decision covers it
    const cur = fw.get(f.id);
    if (cur) cur.evidence.push(...f.evidence.slice(0, 2));
    else fw.set(f.id, { id: f.id, name: f.name, conf: f.conf, evidence: f.evidence.slice(0, 3) });
  }
  // 'php-pages' is imex's own label for scripts served directly (D17), not a framework someone chose
  const list = [...fw.values()].filter((f) => f.id !== 'php-pages');
  const http = a.routes.filter((r) => r.kind === 'http' || r.kind === 'page');
  if (list.length === 0) {
    if (!http.length) return null;
    // D17: no framework, scripts served directly (typically legacy PHP)
    return mk({
      id: 'framework', title: 'Application framework', category: 'Stack',
      decision: 'No web framework: each script is served directly and acts as its own route.', conf: 'heuristic',
      evidence: http.slice(0, 3).map((r) => ev(r.file, r.line, `${r.method} ${r.path}`)),
      tradeoffs: ['Nothing to learn or upgrade, and the request path is easy to follow.', 'Routing, input validation, security and structure are all hand-rolled, so they are applied unevenly.'],
      observed: [{ text: `${plural(http.length, 'route')} found, all derived from file layout or query parameters.`, conf: 'heuristic', file: http[0].file, line: http[0].line }],
    });
  }
  const own = http.filter((r) => list.some((f) => f.id === r.framework));
  const d = mk({
    id: 'framework', title: 'Application framework', category: 'Stack',
    decision: `Built on ${names(list.map((f) => f.name))}.`, conf: minConf(list.map((f) => f.conf)),
    evidence: uniqEv(real(list.flatMap((f) => f.evidence)), 5), tradeoffs: techTradeoffs(list.map((f) => f.id)),
    observed: own.length ? [{ text: `${plural(own.length, 'HTTP route')} registered through it.`, conf: minConf(own.map((r) => r.conf)), file: own[0].file, line: own[0].line }] : [],
  });
  return withWhy(c, d, list.flatMap((f) => [f.name, f.id]));
}

function ui(c: Ctx): Decision | null {
  const { a } = c;
  const ui = techs(a, 'ui');
  const main = ui.filter((t) => ['react', 'vue', 'angular', 'svelte'].includes(t.id));
  if (!main.length) return null;
  const comps = a.files.filter((f) => f.role === 'component' || f.role === 'page');
  const d = mk({
    id: 'ui', title: 'UI framework', category: 'Stack',
    decision: `${names(main.map((t) => t.name))}${ui.length > main.length ? `, styled with ${names(ui.filter((t) => !main.includes(t)).map((t) => t.name))}` : ''}.`,
    conf: 'resolved', evidence: uniqEv(real(ui.flatMap((t) => t.evidence.slice(0, 2))), 4), tradeoffs: techTradeoffs(main.map((t) => t.id)),
    observed: comps.length ? [{ text: `${plural(comps.length, 'component/page file')}.`, conf: 'heuristic', file: comps[0].path, line: 1 }] : [],
  });
  return withWhy(c, d, main.flatMap((t) => [t.name, t.id]));
}

function state(c: Ctx): Decision | null {
  const s = techs(c.a, 'state');
  if (!s.length) return null;
  const d = mk({ id: 'state', title: 'State management', category: 'Stack', decision: `${names(s.map((t) => t.name))} holds shared client state.`, conf: 'resolved', evidence: uniqEv(s.flatMap((t) => t.evidence), 3), tradeoffs: techTradeoffs(s.map((t) => t.id)) });
  return withWhy(c, d, s.flatMap((t) => [t.name, t.id]));
}

function tooling(c: Ctx): Decision | null {
  const { a } = c;
  const build = techs(a, 'build').filter((t) => t.id !== 'workspaces');
  const ts = a.l0.tech.find((t) => t.id === 'typescript');
  const root = a.l0.manifests.filter((m) => m.type === 'package.json' && m.scripts?.build).sort((x, y) => x.file.length - y.file.length)[0];
  if (!build.length && !ts && !root) return null;
  const parts = [...(ts ? ['TypeScript'] : []), ...build.map((t) => t.name)];
  const unit = root && c.units.get(root.file);
  const line = unit ? lineOf(unit.text, Math.max(0, unit.text.indexOf('"build"'))) : 1;
  return mk({
    id: 'tooling', title: 'Build and tooling', category: 'Stack',
    decision: `${parts.length ? names(parts) : 'A build script'}${root ? `; build with \`${root.scripts!.build}\`` : ''}.`, conf: 'resolved',
    evidence: uniqEv([...(root ? [ev(root.file, line, `scripts.build: ${root.scripts!.build}`, 'manifest')] : []), ...real([...(ts?.evidence.slice(0, 1) ?? []), ...build.flatMap((t) => t.evidence.slice(0, 1))])], 4),
    tradeoffs: techTradeoffs([...(ts ? ['typescript'] : [])]),
  });
}

// ---------------------------------------------------------------- data

const DB_NAME: Record<string, string> = { postgresql: 'PostgreSQL', postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite', sqlite3: 'SQLite', mongodb: 'MongoDB', sqlserver: 'SQL Server', cockroachdb: 'CockroachDB', oracle: 'Oracle', h2: 'H2' };

/** Databases named in config rather than in a dependency list: Prisma datasource, JDBC URL, Django ENGINE, PHP mysqli/PDO. */
export function declaredDatabases(c: Pick<Ctx, 'units'>): { name: string; ev: Evidence; conf: Confidence }[] {
  const out: { name: string; ev: Evidence; conf: Confidence }[] = [];
  let scanned = 0;
  for (const u of c.units.values()) {
    if (scanned >= 400 || u.text.length > 300_000) continue;
    const b = basename(u.path).toLowerCase();
    const at = (re: RegExp) => {
      const m = re.exec(u.text);
      return m ? { m, line: lineOf(u.text, m.index) } : null;
    };
    let hit: { name: string; note: string; line: number; conf: Confidence } | null = null;
    if (b.endsWith('.prisma')) {
      const r = at(/datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"(\w+)"/);
      if (r) hit = { name: DB_NAME[r.m[1]] ?? r.m[1], note: `Prisma datasource provider "${r.m[1]}"`, line: lineOf(u.text, r.m.index + r.m[0].indexOf('provider')), conf: 'resolved' };
    } else if (/^application[\w-]*\.(properties|ya?ml)$/.test(b)) {
      const r = at(/jdbc:(postgresql|mysql|mariadb|sqlserver|oracle|h2|sqlite)\b/);
      if (r) hit = { name: DB_NAME[r.m[1]], note: `JDBC URL for ${r.m[1]}`, line: r.line, conf: 'resolved' };
    } else if (/^settings[\w]*\.py$/.test(b)) {
      const r = at(/django\.db\.backends\.(postgresql|mysql|sqlite3|oracle)/);
      if (r) hit = { name: DB_NAME[r.m[1]], note: `Django DATABASES engine ${r.m[0]}`, line: r.line, conf: 'resolved' };
    } else if (u.lang === 'php') {
      const r = at(/\b(mysqli_connect|new\s+mysqli|mysql_connect)\b|new\s+PDO\s*\(\s*['"]mysql:/);
      if (r) hit = { name: 'MySQL', note: `${r.m[0].trim()} (MySQL driver; a MariaDB server would also work)`, line: r.line, conf: 'heuristic' };
    }
    if (u.lang === 'php' || b.endsWith('.prisma') || /^(application|settings)/.test(b)) scanned++;
    if (hit && hit.name && !out.some((x) => x.name === hit!.name)) out.push({ name: hit.name, ev: ev(u.path, hit.line, hit.note, 'config'), conf: hit.conf });
  }
  return out;
}

function datastores(c: Ctx): Decision | null {
  const { a } = c;
  const dbs = techs(a, 'database', 'cache');
  const declared = declaredDatabases(c).filter((x) => !dbs.some((t) => t.name === x.name));
  if (!dbs.length && !declared.length) return null;
  const label = (t: TechHit) => (t.category === 'cache' ? `${t.name} (cache)` : t.name);
  const d = mk({
    id: 'datastores', title: 'Datastores', category: 'Data',
    decision: `${names([...dbs.map(label), ...declared.map((x) => x.name)])}.`, conf: minConf([...dbs.map(() => 'resolved' as const), ...declared.map((x) => x.conf)]),
    evidence: uniqEv([...real(dbs.flatMap((t) => t.evidence.slice(0, 2))), ...declared.map((x) => x.ev)], 5),
    tradeoffs: techTradeoffs(dbs.map((t) => t.id)).length ? techTradeoffs(dbs.map((t) => t.id)) : declared.some((x) => x.name === 'PostgreSQL') ? techTradeoffs(['postgres']) : declared.some((x) => x.name === 'MongoDB') ? techTradeoffs(['mongodb']) : [],
  });
  return withWhy(c, d, [...dbs.flatMap((t) => [t.name, t.id]), ...declared.map((x) => x.name)]);
}

/** Entity `source` values that name an ORM which the dependency table does not list separately (it ships with the framework). */
const SOURCE_ORM: Record<string, string> = { django: 'the Django ORM', activerecord: 'ActiveRecord', eloquent: 'Eloquent', efcore: 'Entity Framework Core', gorm: 'GORM' };

function dataAccess(c: Ctx): Decision | null {
  const { a } = c;
  const orms = techs(a, 'orm');
  const entities = a.schema.entities;
  const dbFacts = a.facts.filter((f) => f.kind === 'db');
  if (!orms.length && !entities.length && !dbFacts.length) return null;
  const implied = [...new Set(entities.map((e) => SOURCE_ORM[e.source]).filter((x): x is string => !!x))];
  const used = orms.length ? orms.map((t) => t.name) : implied;
  const observed: Claim[] = [];
  if (entities.length) {
    const sources = [...new Set(entities.map((e) => e.source))];
    observed.push({ text: `${plural(entities.length, 'entity', 'entities')} defined (${names(sources)}), e.g. ${entities[0].name}.`, conf: minConf(entities.map((e) => e.conf)), file: entities[0].file, line: entities[0].line });
  }
  const bypass = a.deps.violations.filter((v) => v.toRole === 'db');
  if (bypass.length) observed.push({ text: `Direct database access outside the data layer in ${plural(bypass.length, 'place')}, e.g. ${lc(bypass[0].detail)}`, conf: minConf(bypass.map((v) => v.conf)), file: bypass[0].file, line: bypass[0].line });
  const raw = dbFacts.filter((f) => /raw|cursor|query|mysqli|execute/i.test(f.detail));
  if (!used.length && raw.length) observed.push({ text: `${plural(raw.length, 'direct database call')}, e.g. ${raw[0].detail}.`, conf: minConf(raw.map((f) => f.conf)), file: raw[0].file, line: raw[0].line });
  const d = mk({
    id: 'data-access', title: 'Data access', category: 'Data',
    decision: used.length ? `Data access goes through ${names(used)}.` : 'Data access is hand-written SQL or driver calls; no ORM was detected.',
    conf: orms.length ? 'resolved' : implied.length ? minConf(entities.map((e) => e.conf)) : 'heuristic',
    evidence: uniqEv([...real(orms.flatMap((t) => t.evidence.slice(0, 2))), ...entities.slice(0, 2).map((e) => ev(e.file, e.line, `entity ${e.name} (${e.source})`)), ...(used.length ? [] : dbFacts.slice(0, 3).map((f) => ev(f.file, f.line, f.detail)))], 5),
    tradeoffs: orms.length ? techTradeoffs(orms.map((t) => t.id)) : implied.length ? ['Models and migrations come with the framework, so schema changes are tracked and tooling just works.', 'The ORM shapes the whole design; complex queries and bulk operations may still need raw SQL.'] : ['No abstraction between the code and the database: full control of every query.', 'Queries are repeated and easy to get wrong (SQL injection, inconsistent joins); the schema is documented only by the SQL itself.'],
    observed,
  });
  return withWhy(c, d, [...orms.flatMap((t) => [t.name, t.id]), ...Object.keys(SOURCE_ORM).filter((k) => entities.some((e) => e.source === k))]);
}

// ---------------------------------------------------------------- api

function apiStyle(c: Ctx): Decision | null {
  const { a } = c;
  const http = a.routes.filter((r) => r.kind === 'http');
  const other = a.routes.filter((r) => r.kind === 'graphql' || r.kind === 'rpc' || r.kind === 'ws');
  const apiTech = techs(a, 'api');
  if (!http.length && !other.length && !apiTech.length) return null;
  const parts: string[] = [];
  const confs: Confidence[] = [];
  const GQL = ['graphql'], RPC = ['grpc', 'trpc'];
  if (http.length) {
    parts.push(`REST-style HTTP routes (${http.length})`);
    confs.push('heuristic'); // "REST-style" is a judgement about the routes, not a declared fact
  }
  for (const t of apiTech) {
    if (t.id === 'drf') parts.push('Django REST Framework serializers and views');
    else if (GQL.includes(t.id)) parts.push('GraphQL');
    else if (RPC.includes(t.id)) parts.push(t.name);
    confs.push('resolved');
  }
  const openapi = apiTech.find((t) => t.id === 'openapi');
  const observed: Claim[] = [];
  const methods = new Map<string, number>();
  for (const r of http) methods.set(r.method, (methods.get(r.method) ?? 0) + 1);
  if (http.length) observed.push({ text: `${[...methods].map(([m, n]) => `${m === 'ANY' ? 'any method' : m} ${n}`).join(', ')}.`, conf: minConf(http.map((r) => r.conf)), file: http[0].file, line: http[0].line });
  const dyn = a.unresolved.filter((u) => u.kind === 'dynamic-route');
  if (dyn.length) observed.push({ text: `${plural(dyn.length, 'route')} use computed paths and cannot be listed statically.`, conf: 'unresolved', file: dyn[0].file, line: dyn[0].line });
  if (openapi) observed.push({ text: 'The API is documented with OpenAPI/Swagger.', conf: 'resolved', file: openapi.evidence[0].file, line: openapi.evidence[0].line });
  const tradeoffs = [...(http.length ? ['Simple, cacheable and understood by every client; versioning and over-/under-fetching are managed by hand.'] : []), ...techTradeoffs(apiTech.map((t) => t.id))];
  const d = mk({
    id: 'api-style', title: 'API style', category: 'API', decision: `${names(parts)}.`, conf: minConf(confs),
    evidence: uniqEv([...http.slice(0, 4).map((r) => ev(r.file, r.line, `${r.method} ${r.path}`)), ...real(apiTech.flatMap((t) => t.evidence.slice(0, 1)))], 5), tradeoffs: tradeoffs.slice(0, 4), observed,
  });
  return withWhy(c, d, ['rest', 'graphql', 'grpc', 'api']);
}

// ---------------------------------------------------------------- security

/** Middleware/guard names that look like access control. Split camelCase first: "requireAdmin" → "require admin". */
export function looksLikeAuth(name: string): boolean {
  return /\b(auth(?:n|z|enticat\w*|oriz\w*)?|guard|jwt|login|session|permissions?|rbac|acl|admin|protect\w*|token)\b/i.test(name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]/g, ' '));
}

function authentication(c: Ctx): Decision | null {
  const { a } = c;
  const http = a.routes.filter((r) => r.kind === 'http' || r.kind === 'page');
  const authTech = techs(a, 'auth');
  const mwFiles = a.files.filter((f) => f.role === 'middleware' && looksLikeAuth(basename(f.path)));
  const guarded = http.filter((r) => r.middleware.some((m) => looksLikeAuth(m.name)));
  const names_ = [...new Set(guarded.flatMap((r) => r.middleware.filter((m) => looksLikeAuth(m.name)).map((m) => m.name)))];
  // frameworks that enable auth in configuration rather than a dependency
  const djangoAuth = [...c.units.values()].find((u) => basename(u.path) === 'settings.py' && /["']django\.contrib\.auth["']/.test(u.text));
  const djangoLine = djangoAuth ? lineOf(djangoAuth.text, djangoAuth.text.search(/["']django\.contrib\.auth["']/)) : 0;

  if (!authTech.length && !guarded.length && !mwFiles.length && !djangoAuth) {
    if (!http.length) return null; // no HTTP surface: nothing to protect, so no claim
    return mk({
      id: 'auth', title: 'Authentication and access control', category: 'Security',
      decision: 'No authentication mechanism was recognised.', conf: 'unresolved',
      evidence: http.slice(0, 2).map((r) => ev(r.file, r.line, `${r.method} ${r.path} has no recognised auth middleware`)),
      observed: [{ text: 'Either the API is open, or access control uses a pattern imex does not recognise (custom code, a gateway or reverse proxy in front). Worth confirming before exposing it.', conf: 'unresolved' }],
    });
  }
  const how = [...(authTech.length ? authTech.map((t) => t.name) : []), ...(djangoAuth ? ["Django's built-in auth app"] : [])];
  const observed: Claim[] = [];
  if (http.length && guarded.length) {
    const open = http.filter((r) => !guarded.includes(r));
    observed.push({
      text: `${guarded.length} of ${plural(http.length, 'route')} pass through auth-like middleware${names_.length ? ` (${names(names_)})` : ''}.${open.length && guarded.length ? ` Without it: ${open.slice(0, 3).map((r) => `${r.method} ${r.path}`).join(', ')}${open.length > 3 ? ` and ${open.length - 3} more` : ''}.` : ''}`,
      conf: 'heuristic', file: (open[0] ?? guarded[0] ?? http[0]).file, line: (open[0] ?? guarded[0] ?? http[0]).line,
    });
  }
  const d = mk({
    id: 'auth', title: 'Authentication and access control', category: 'Security',
    decision: `${how.length ? `${names(how)}` : 'Custom authentication'}${names_.length ? `, enforced by ${names(names_.map((n) => `\`${n}\``))}` : mwFiles.length ? `, enforced in \`${mwFiles[0].path}\`` : ''}.`,
    conf: how.length ? 'resolved' : 'heuristic',
    evidence: uniqEv([...real(authTech.flatMap((t) => t.evidence.slice(0, 2))), ...(djangoAuth ? [ev(djangoAuth.path, djangoLine, 'django.contrib.auth is enabled', 'config')] : []), ...mwFiles.slice(0, 2).map((f) => ev(f.path, 1, `auth middleware (${f.role})`)), ...guarded.slice(0, 2).map((r) => ev(r.file, r.line, `${r.method} ${r.path} uses ${r.middleware.filter((m) => looksLikeAuth(m.name)).map((m) => m.name).join(', ')}`))], 5),
    tradeoffs: authTech.length ? techTradeoffs(authTech.map((t) => t.id)) : ['Hand-written access control is tailored to the app, but every check must be applied by hand and is easy to forget on a new route.'],
    observed,
  });
  return withWhy(c, d, [...authTech.flatMap((t) => [t.name, t.id]), 'authentication', 'auth']);
}

// ---------------------------------------------------------------- operations

function deployment(c: Ctx): Decision | null {
  const { a } = c;
  const cfg = a.l0.configs.filter((x) => ['docker', 'compose', 'k8s', 'infra', 'ci'].includes(x.kind));
  if (!cfg.length) return null;
  const kinds = (k: string) => cfg.filter((x) => x.kind === k);
  const parts: string[] = [];
  const docker = kinds('docker');
  if (docker.length) parts.push(`Containerised with Docker${/based on (\S+)/.exec(docker[0].detail) ? ` (${/based on (\S+)/.exec(docker[0].detail)![1]})` : ''}`);
  if (kinds('compose').length) parts.push('composed with Docker Compose');
  if (kinds('k8s').length) parts.push('deployed to Kubernetes');
  if (kinds('infra').length) parts.push(kinds('infra')[0].detail.replace(/ configuration$/, ''));
  if (kinds('ci').length) parts.push(`CI: ${kinds('ci').map((x) => x.detail.replace(/ (pipeline|workflow).*$/i, '')).slice(0, 2).join(', ')}`);
  const observed: Claim[] = [];
  const unit = docker[0] && c.units.get(docker[0].file);
  if (unit && /^FROM\s/m.test(unit.text) && !/^\s*USER\s+\S/m.test(unit.text)) {
    observed.push({ text: `${docker[0].file} has no USER instruction, so the container runs as root.`, conf: 'heuristic', file: docker[0].file, line: lineOf(unit.text, unit.text.search(/^FROM\s/m)) });
  }
  if (!kinds('ci').length) observed.push({ text: 'No CI configuration (GitHub Actions, GitLab CI, Jenkins, …) was found in the analysed files.', conf: 'heuristic' });
  return mk({
    id: 'deployment', title: 'Deployment', category: 'Operations',
    decision: `${parts.join('; ')}.`.replace(/^./, (ch) => ch.toUpperCase()), conf: 'resolved', evidence: cfg.slice(0, 5).map((x) => ev(x.file, 1, x.detail, 'config')),
    tradeoffs: docker.length ? ['The same image runs everywhere, so "works on my machine" differences shrink.', 'Image size, base-image patching and container orchestration become your responsibility.'] : [], observed,
  });
}

function configuration(c: Ctx): Decision | null {
  const { a } = c;
  const env = a.l0.configs.filter((x) => x.kind === 'env');
  const appCfg = a.l0.configs.filter((x) => x.kind === 'other' && /application configuration/.test(x.detail));
  if (!env.length && !appCfg.length) return null;
  const secrets = a.findings.filter((f) => f.cat === 'secret');
  const observed: Claim[] = [];
  if (secrets.length) {
    observed.push({
      text: `${plural(secrets.length, 'possible hardcoded secret')} in the source${env.length ? ', although configuration is meant to come from the environment' : ''}. See Health.`,
      conf: minConf(secrets.map((f) => f.conf)), file: secrets[0].file, line: secrets[0].line,
    });
  }
  const d = mk({
    id: 'configuration', title: 'Configuration and secrets', category: 'Operations',
    decision: env.length ? `Environment variables (${env[0].detail.replace(/^.*?\((.*)\)$/, '$1')}).` : `Configuration files (${names(appCfg.map((x) => basename(x.file)))}).`,
    conf: 'resolved', evidence: [...env, ...appCfg].slice(0, 4).map((x) => ev(x.file, 1, x.detail, 'config')),
    tradeoffs: env.length ? ['Deploy-time settings stay out of the code and differ per environment.', 'Nothing checks that every variable is set until the app starts, and the list drifts unless the template is maintained.'] : ['Settings live next to the code and are versioned with it.', 'Per-environment values and secrets end up in the repository unless they are kept out on purpose.'],
    observed,
  });
  return withWhy(c, d, ['environment', 'env', 'configuration', 'config']);
}

function jobs(c: Ctx): Decision | null {
  const { a } = c;
  const runners = techs(a, 'queue').filter((t) => ['cron', 'celery', 'sidekiq', 'bull'].includes(t.id));
  const entries = a.entries.filter((e) => e.kind === 'job');
  if (!runners.length && !entries.length) return null;
  return mk({
    id: 'jobs', title: 'Background and scheduled jobs', category: 'Operations',
    decision: `Work that runs outside the request cycle${runners.length ? `: ${names(runners.map((t) => t.name))}` : ''}${entries.length ? `, ${plural(entries.length, 'job')} found` : ''}.`,
    conf: runners.length ? 'resolved' : 'heuristic',
    evidence: uniqEv([...entries.slice(0, 3).map((e) => ev(e.file, e.line, e.label)), ...real(runners.flatMap((t) => t.evidence.slice(0, 1)))], 4), tradeoffs: techTradeoffs(runners.map((t) => t.id)),
  });
}

// ---------------------------------------------------------------- quality

function testing(c: Ctx): Decision | null {
  const { a } = c;
  const code = codeFiles(a);
  if (code.filter((f) => !f.test).length < 3) return null;
  const tests = a.files.filter((f) => f.test && CODE_LANGS.has(f.lang));
  const fw = techs(a, 'testing');
  const observed: Claim[] = [];
  const nonTest = code.filter((f) => !f.test).length;
  observed.push(tests.length
    ? { text: `${plural(tests.length, 'test file')} for ${plural(nonTest, 'code file')}.`, conf: 'heuristic', file: tests[0].path, line: 1 }
    : { text: `No test files were found among the analysed files${fw.length ? `, although ${names(fw.map((t) => t.name))} ${fw.length === 1 ? 'is' : 'are'} declared` : ''}. Tests may be excluded by ignore rules or live elsewhere.`, conf: 'heuristic', file: fw[0]?.evidence[0]?.file, line: fw[0]?.evidence[0]?.line });
  const e2e = fw.filter((t) => ['playwright', 'cypress'].includes(t.id));
  return mk({
    id: 'testing', title: 'Test strategy', category: 'Quality',
    decision: fw.length ? `Tests are written with ${names(fw.map((t) => t.name))}${e2e.length ? ` (including browser tests with ${names(e2e.map((t) => t.name))})` : ''}.` : tests.length ? 'Test files exist, but no test framework was recognised from the manifests.' : 'No automated tests were found.',
    conf: fw.length ? 'resolved' : 'heuristic', evidence: uniqEv([...real(fw.flatMap((t) => t.evidence.slice(0, 1))), ...tests.slice(0, 2).map((f) => ev(f.path, 1, 'test file', 'structure'))], 4),
    tradeoffs: techTradeoffs(fw.map((t) => t.id)), observed,
  });
}

export const DETECTORS: ((c: Ctx) => Decision | null)[] = [
  architecture, repoLayout, messaging, languages, framework, ui, state, tooling, datastores, dataAccess, apiStyle, authentication, deployment, configuration, jobs, testing,
];

