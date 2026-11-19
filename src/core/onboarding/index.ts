// onboardingStage (M10): a reading path, a glossary, "how to run it" and a first-week checklist, all derived
// from the finished analysis. Runs in the worker because "how to run it" needs the text of the README,
// Dockerfile and manifests, which the UI never holds. Every item carries a source location and a confidence.
import { CODE_LANGS } from '../l0/languages';
import type { Stage } from '../pipeline';
import type { Analysis, ChecklistItem, FileUnit, Onboarding, OnboardingFile, OnboardingStep } from '../types';
import { basename, fmtNum } from '../util';
import { minConf } from '../decisions/catalogue';
import { buildGlossary } from './glossary';
import { buildRunInfo } from './run';

const STEP_FILES = 5;
const plural = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`;
const list = (items: string[], max = 3) => items.slice(0, max).join(', ') + (items.length > max ? `, +${items.length - max} more` : '');

/** Steps in reading order. Specialised steps (docs, entry, routes, data, config, rough edges) list what is
 *  theirs even if another step shows the same file; the generic "core logic" step is filled last and skips
 *  files already shown, so it never repeats them. */
export function buildPath(a: Analysis): OnboardingStep[] {
  const shown = new Set<string>();
  const built = new Map<string, OnboardingStep>();
  const step = (id: string, title: string, why: string, files: OnboardingFile[], dedupe = false) => {
    const seen = new Set<string>();
    const picked = files.filter((f) => !seen.has(f.file) && !(dedupe && shown.has(f.file)) && (seen.add(f.file), true)).slice(0, STEP_FILES);
    for (const f of picked) shown.add(f.file);
    if (picked.length) built.set(id, { id, title, why, files: picked });
  };

  const readme = a.l0.docs.filter((d) => d.kind === 'readme').sort((x, y) => x.file.length - y.file.length);
  const adrs = a.l0.docs.filter((d) => d.kind === 'adr');
  const docs = a.l0.docs.filter((d) => d.kind === 'doc').slice(0, 2);
  step('docs', 'Read what the team wrote down', 'The project’s own explanation comes first; decision records say why things are the way they are.', [
    ...readme.slice(0, 1).map((d) => ({ file: d.file, line: 1, note: d.title, conf: 'resolved' as const })),
    ...adrs.slice(0, 3).map((d) => ({ file: d.file, line: 1, note: `Decision record: ${d.title}`, conf: 'resolved' as const })),
    ...docs.map((d) => ({ file: d.file, line: 1, note: d.title, conf: 'resolved' as const })),
  ]);

  step('start', 'Find where it starts', 'Execution begins here; everything else is reached from these files.',
    a.entries.filter((e) => e.kind === 'main' || e.kind === 'cli').slice(0, 3).map((e) => ({ file: e.file, line: e.line, note: e.label, conf: e.conf })));

  const byFile = new Map<string, typeof a.routes>();
  for (const r of a.routes.filter((x) => x.kind === 'http' || x.kind === 'page')) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  step('requests', 'See how requests come in', 'These files declare the public surface: what URLs exist and which handler answers each.', [
    ...[...byFile].sort((x, y) => y[1].length - x[1].length).map(([file, rs]) => ({ file, line: rs[0].line, note: `${plural(rs.length, 'route')}: ${list(rs.map((r) => `${r.method} ${r.path}`), 3)}`, conf: minConf(rs.map((r) => r.conf)) })),
    ...a.entries.filter((e) => e.kind === 'event').slice(0, 2).map((e) => ({ file: e.file, line: e.line, note: e.label, conf: e.conf })),
  ]);

  const entFiles = new Map<string, typeof a.schema.entities>();
  for (const e of a.schema.entities) entFiles.set(e.file, [...(entFiles.get(e.file) ?? []), e]);
  step('data', 'Understand the data', 'Entities are the vocabulary of the domain; the Data view shows how they relate and what touches them.',
    [...entFiles].map(([file, es]) => ({ file, line: es[0].line, note: `${list(es.map((e) => e.name), 4)} (${es[0].source})`, conf: minConf(es.map((e) => e.conf)) })));

  const cfg = a.l0.configs.filter((c) => ['env', 'docker', 'compose', 'ci', 'k8s', 'infra'].includes(c.kind) || (c.kind === 'other' && /application configuration/.test(c.detail)));
  if (cfg.length) {
    step('ops', 'See how it is configured and deployed', 'Settings, containers and pipelines show what the app needs in order to run somewhere else.',
      [...cfg.map((c) => ({ file: c.file, line: 1, note: c.detail, conf: 'resolved' as const })), ...a.l0.manifests.slice(0, 1).map((m) => ({ file: m.file, line: 1, note: `${m.type}: ${plural(m.deps.length, 'dependency', 'dependencies')}`, conf: 'resolved' as const }))]);
  }

  step('rough', 'Know the rough edges', 'Places where a change is most likely to surprise you. These are signals, not verdicts: Health and Dependencies explain each one.', [
    ...a.deps.cycles.slice(0, 2).map((c) => ({ file: c.files[0], line: c.edges[0]?.line ?? 1, note: `Circular dependency: ${c.files.slice(0, 3).join(' → ')}`, conf: minConf(c.edges.map((e) => e.conf)) })),
    ...a.deps.godModules.slice(0, 2).map((g) => ({ file: g.file, line: 1, note: `Does too much: ${g.reasons.join('; ')}`, conf: 'heuristic' as const })),
    ...a.deps.violations.slice(0, 1).map((v) => ({ file: v.file, line: v.line, note: v.detail, conf: v.conf })),
    ...a.findings.filter((f) => f.cat === 'hotspot').slice(0, 2).map((f) => ({ file: f.file, line: f.line, note: f.msg, conf: f.conf })),
    ...a.findings.filter((f) => f.cat === 'secret').slice(0, 1).map((f) => ({ file: f.file, line: f.line, note: 'Possible hardcoded secret', conf: f.conf })),
  ]);

  step('core', 'Read the core logic', 'Ranked by how many files depend on each one and how few import hops it is from an entry point. Files already listed above are not repeated.',
    a.orientation.readFirst.filter((r) => !/\.(md|rst|txt)$/i.test(r.file)).map((r) => ({ file: r.file, line: 1, note: r.reasons.join('; '), conf: 'heuristic' as const })), true);

  return ['docs', 'start', 'requests', 'core', 'data', 'ops', 'rough'].flatMap((id) => built.get(id) ?? []);
}

export function buildChecklist(a: Analysis, o: Pick<Onboarding, 'path' | 'run'>): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (i: ChecklistItem) => items.push(i);
  const { run } = o;
  const first = (k: string) => run.commands.find((c) => c.kind === k);
  const install = first('install');
  const start = first('run') ?? first('docker');
  const cmd = (c: { command: string; cwd?: string }) => `${c.cwd ? `cd ${c.cwd} && ` : ''}${c.command}`;

  // ---- Day 1: get it running and get oriented ----
  if (start) add({ id: 'run', when: 'Day 1', text: 'Get it running locally', detail: [install && `\`${cmd(install)}\``, `\`${cmd(start)}\``].filter(Boolean).join(', then '), file: start.file, line: start.line, conf: start.conf });
  else add({ id: 'run', when: 'Day 1', text: 'Work out how to run it', detail: 'No run instructions were found in the manifests, Dockerfile or README. Ask a teammate, then write them down.', conf: 'unresolved' });
  if (run.env.length) add({ id: 'env', when: 'Day 1', text: `Set the ${plural(run.env.length, 'environment variable')} it reads`, detail: list(run.env.map((e) => e.name), 5), file: run.env[0].file, line: run.env[0].line, conf: 'resolved' });
  const services = run.prerequisites.filter((p) => /^A reachable/.test(p.text));
  if (services.length) add({ id: 'services', when: 'Day 1', text: 'Start the services it depends on', detail: services.map((s) => s.text.replace(/^A reachable /, '')).join('; '), file: services[0].file, line: services[0].line, conf: minConf(services.map((s) => s.conf)) });
  const readme = a.l0.docs.find((d) => d.kind === 'readme');
  const adrs = a.l0.docs.filter((d) => d.kind === 'adr');
  if (readme || adrs.length) add({ id: 'docs', when: 'Day 1', text: `Read ${[readme ? 'the README' : '', adrs.length ? plural(adrs.length, 'decision record') : ''].filter(Boolean).join(' and ')}`, tab: adrs.length ? 'decisions' : undefined, file: readme?.file ?? adrs[0].file, line: 1, conf: 'resolved' });
  const reading = o.path.find((s) => s.id === 'start') ?? o.path[0];
  if (reading) add({ id: 'path', when: 'Day 1', text: 'Walk the reading path', detail: `${plural(o.path.reduce((n, s) => n + s.files.length, 0), 'file')} in ${plural(o.path.length, 'step')}, from the docs to the rough edges.`, conf: 'heuristic' });

  // ---- Days 2–3: follow the code, the data and the tests ----
  const routes = a.entries.filter((e) => e.kind === 'route');
  const trace = routes.find((e) => /^POST|^PUT/.test(e.label)) ?? routes[0];
  if (trace) add({ id: 'trace', when: 'Days 2–3', text: `Trace one request end to end: ${trace.label}`, detail: 'Flows shows every handler, service and data access it touches.', tab: 'flows', focus: { entry: trace.id }, file: trace.file, line: trace.line, conf: trace.conf });
  const test = first('test');
  const tests = a.files.filter((f) => f.test && CODE_LANGS.has(f.lang));
  if (test) add({ id: 'tests', when: 'Days 2–3', text: 'Run the tests', detail: `\`${cmd(test)}\`${tests.length ? ` (${plural(tests.length, 'test file')} found)` : '; no test files were found among the analysed files'}`, file: test.file, line: test.line, conf: test.conf });
  else add({ id: 'tests', when: 'Days 2–3', text: tests.length ? 'Find out how the tests are run' : 'Decide how you will check a change', detail: tests.length ? `${plural(tests.length, 'test file')} exist but no command was found.` : 'No tests or test command were found.', tab: 'decisions', conf: 'heuristic' });
  if (a.schema.entities.length) add({ id: 'data', when: 'Days 2–3', text: `Learn the data model: ${plural(a.schema.entities.length, 'entity', 'entities')}`, detail: list(a.schema.entities.map((e) => e.name), 5), tab: 'data', conf: minConf(a.schema.entities.map((e) => e.conf)) });
  if (a.decisions.length) {
    const open = a.decisions.filter((d) => d.conf === 'unresolved');
    add({ id: 'decisions', when: 'Days 2–3', text: `Skim the ${plural(a.decisions.length, 'architectural decision')}`, detail: open.length ? `Start with the ${open.length} that imex could not determine: ${open.map((d) => d.title).join(', ')}.` : undefined, tab: 'decisions', conf: 'heuristic' });
  }

  // ---- Days 4–5: risk, ownership and a first change ----
  const risks = [a.deps.cycles.length && plural(a.deps.cycles.length, 'cycle'), a.deps.violations.length && plural(a.deps.violations.length, 'layering violation'), a.findings.filter((f) => f.cat === 'hotspot').length && plural(a.findings.filter((f) => f.cat === 'hotspot').length, 'hotspot'), a.findings.filter((f) => f.cat === 'secret').length && plural(a.findings.filter((f) => f.cat === 'secret').length, 'possible secret')].filter(Boolean) as string[];
  if (risks.length) add({ id: 'risk', when: 'Days 4–5', text: 'Know the risky areas', detail: `${risks.join(', ')}.`, tab: a.deps.cycles.length || a.deps.violations.length ? 'deps' : 'health', conf: 'heuristic' });
  const fanIn = new Map(a.deps.metrics.map((m) => [m.file, m.fanIn]));
  const starters = a.findings.filter((f) => f.cat === 'todo' && !a.files.find((x) => x.path === f.file)?.test && (fanIn.get(f.file) ?? 0) <= 2).slice(0, 3);
  if (starters.length) {
    const s = starters[0];
    add({ id: 'first', when: 'Days 4–5', text: 'Pick a small, low-risk first change', detail: `Candidates: ${starters.map((f) => `${basename(f.file)}:${f.line}`).join(', ')} (open to-do notes in files few others import).`, tab: 'impact', focus: { file: s.file }, file: s.file, line: s.line, conf: 'heuristic' });
  }
  const risky = a.git?.busFactor.risky[0];
  if (a.git && risky) add({ id: 'owners', when: 'Days 4–5', text: `Find out who knows ${basename(risky.file)}`, detail: `${risky.author} made ${Math.round(risky.share * 100)}% of its ${risky.commits} changes. Bus factor of the project: ${a.git.busFactor.overall}.`, tab: 'history', file: risky.file, line: 1, conf: 'resolved' });
  return items;
}

export function buildOnboarding(a: Analysis, units: Map<string, FileUnit>): Onboarding {
  const path = buildPath(a);
  const run = buildRunInfo(a, units);
  return { path, glossary: buildGlossary(a), run, checklist: buildChecklist(a, { path, run }) };
}

export const onboardingStage: Stage = {
  name: 'Building the onboarding guide',
  phase: 'deep',
  run(ctx) {
    ctx.a.onboarding = buildOnboarding(ctx.a, ctx.unitByPath);
  },
};

