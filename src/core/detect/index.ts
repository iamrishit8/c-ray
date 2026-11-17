// Detector registry and the pipeline stage that runs them.
// Adding a framework = implement Detector (see ./types.ts) and append it here.
import type { Stage } from '../pipeline';
import type { EntryPoint, Role } from '../types';
import { aspnet, goHttp, laravel, phpPages, rails, spring } from './backend';
import { facts } from './facts';
import { express, fastify, nestjs, nextjs, react } from './js';
import { django, fastapi, flask } from './python';
import { DetectContext, type Detector, type RoleHint } from './types';

export const DETECTORS: Detector[] = [express, fastify, nestjs, nextjs, react, django, flask, fastapi, spring, laravel, phpPages, rails, goHttp, aspnet];

/** Generic roles a heuristic detector hint may not override. */
const STICKY: Role[] = ['test', 'entry', 'config', 'migration'];

export const detectStage: Stage = {
  name: 'Detecting frameworks and entry points',
  phase: 'graph',
  run(pctx) {
    const { a } = pctx;
    const ctx = new DetectContext(a, pctx.units);
    const hints: (RoleHint & { src: string })[] = [];
    a.frameworks = [];
    a.routes = [];
    a.facts = [];
    const entries: EntryPoint[] = a.entries.filter((e) => e.kind !== 'route' && !e.framework && (e.kind === 'main' || e.kind === 'cli'));
    const run = (d: Detector) => {
      try {
        const res = d.analyze(ctx);
        a.routes.push(...(res.routes ?? []));
        a.facts.push(...(res.facts ?? []));
        entries.push(...(res.entries ?? []));
        a.unresolved.push(...(res.unresolved ?? []));
        for (const h of res.roles ?? []) hints.push({ ...h, src: d.id });
        return res;
      } catch (e) {
        a.notices.push(`Detector "${d.name}" failed and was skipped: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };
    for (const d of DETECTORS) {
      let ev = null;
      try {
        ev = d.detect(ctx);
      } catch {
        ev = null;
      }
      if (!ev || ev.length === 0) continue;
      const res = run(d);
      const found = !!res && ((res.routes?.length ?? 0) > 0 || (res.facts?.length ?? 0) > 0 || (res.roles?.length ?? 0) > 0);
      const declared = ev.some((e) => e.kind === 'manifest');
      // php-pages is a fallback convention, not a framework: only list it when it found something
      if (d.id === 'php-pages' && !found) continue;
      a.frameworks.push({ id: d.id, name: d.name, conf: declared ? 'resolved' : 'heuristic', evidence: ev.slice(0, 4) });
    }
    run(facts);

    // de-duplicate routes, then expose each as an entry point
    const seen = new Set<string>();
    a.routes = a.routes.filter((r) => {
      const k = `${r.method} ${r.path} ${r.file}:${r.line}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (const r of a.routes) {
      entries.push({ id: r.id, kind: r.kind === 'page' ? 'page' : 'route', label: `${r.method} ${r.path}`, file: r.hFile ?? r.file, line: r.hLine ?? r.line, sym: r.handlerSym, endLine: r.handlerSym === undefined ? r.hEnd : undefined, routeId: r.id, framework: r.framework, conf: r.conf });
    }
    const ids = new Set<string>();
    a.entries = entries.filter((e) => (ids.has(e.id) ? false : (ids.add(e.id), true)));

    // roles: explicit (resolved) hints win, then the first heuristic hint
    const byFile = new Map<string, (RoleHint & { src: string })[]>();
    for (const h of hints) {
      const arr = byFile.get(h.file);
      if (arr) arr.push(h);
      else byFile.set(h.file, [h]);
    }
    for (const f of a.files) {
      const hs = byFile.get(f.path);
      if (!hs || f.test) continue;
      const best = hs.find((h) => h.conf === 'resolved') ?? hs[0];
      if (best.conf !== 'resolved' && STICKY.includes(f.role)) continue;
      if (best.conf !== 'resolved' && f.role !== 'unknown' && f.role !== 'util' && best.role === 'route' && f.role !== 'route') continue;
      f.role = best.role;
      f.roleConf = best.conf;
      f.roleSource = best.src;
    }
  },
};

export { DetectContext };
export type { Detector };
