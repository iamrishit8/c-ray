// Detectors for Python web frameworks: Django (+DRF), Flask, FastAPI.
import type { EntryPoint, Fact, FileUnit, Route } from '../types';
import { basename, dirname, stripExt } from '../util';
import { callArgs, DetectContext, joinRoute, literal, mkRoute, withHandler, type Detector, type DetectorResult, type RoleHint } from './types';

function moduleFile(ctx: DetectContext, mod: string, from: string): string | null {
  const rel = mod.replace(/\./g, '/');
  const cands = ctx.files('python').map((u) => u.path).filter((p) => p === rel + '.py' || p.endsWith('/' + rel + '.py') || p === rel + '/__init__.py' || p.endsWith('/' + rel + '/__init__.py'));
  if (cands.length <= 1) return cands[0] ?? null;
  const fd = dirname(from).split('/');
  return cands.sort((x, y) => shared(y, fd) - shared(x, fd) || x.length - y.length)[0];
}
function shared(p: string, dir: string[]): number {
  const ps = p.split('/');
  let i = 0;
  while (i < ps.length && i < dir.length && ps[i] === dir[i]) i++;
  return i;
}

function decoratorMethods(u: FileUnit, defLine: number): string[] | null {
  const lines = u.text.split('\n');
  for (let l = defLine - 1; l >= Math.max(1, defLine - 8); l--) {
    const t = lines[l - 1]?.trim() ?? '';
    if (!t.startsWith('@')) {
      if (t === '' || t.startsWith('#')) continue;
      break;
    }
    const m = /@(?:require_http_methods|api_view)\s*\(\s*\[([^\]]*)\]/.exec(t);
    if (m) return [...m[1].matchAll(/['"](\w+)['"]/g)].map((x) => x[1].toUpperCase());
    const s = /@require_(GET|POST|safe)\b/.exec(t);
    if (s) return s[1] === 'safe' ? ['GET', 'HEAD'] : [s[1]];
  }
  return null;
}

export const django: Detector = {
  id: 'django',
  name: 'Django',
  detect(ctx) {
    if (ctx.hasTech('django')) return ctx.techEvidence('django');
    const ev = ctx.firstEvidence(['python'], /^\s*(?:from|import)\s+django\b/m, 'imports django');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const facts: Fact[] = [];
    const entries: EntryPoint[] = [];
    const py = ctx.files('python');
    interface Entry { route: string; line: number; include?: string; routerVar?: string; handler?: string; regex: boolean; endLine: number }
    const confs = new Map<string, { entries: Entry[]; routers: Map<string, { prefix: string; viewset: string; line: number }[]> }>();
    const included = new Set<string>();

    for (const u of py) {
      if (!/\burlpatterns\b/.test(u.text)) continue;
      const entriesHere: Entry[] = [];
      const routers = new Map<string, { prefix: string; viewset: string; line: number }[]>();
      for (const m of ctx.grep(u, /\b(\w+)\.register\s*\(\s*r?(['"])([^'"]*)\2\s*,\s*([\w.]+)/)) {
        const arr = routers.get(m.m[1]) ?? [];
        arr.push({ prefix: m.m[3], viewset: m.m[4], line: m.line });
        routers.set(m.m[1], arr);
      }
      for (const m of ctx.grep(u, /(?<![\w.])(path|re_path|url)\s*\(/)) {
        const call = callArgs(u.text, m.index + m.m[0].length - 1);
        if (!call || call.args.length < 2) continue;
        const route = literal(call.args[0].text);
        if (route === null) continue;
        const target = call.args[1].text;
        const e: Entry = { route, line: m.line, regex: m.m[1] !== 'path', endLine: ctx.lineAt(u, call.end) };
        const inc = /^include\s*\(\s*(?:\(\s*)?(['"])([\w.]+)\1/.exec(target);
        const incRouter = /^include\s*\(\s*(\w+)\.urls\b/.exec(target);
        if (inc) {
          e.include = moduleFile(ctx, inc[2], u.path) ?? undefined;
          if (e.include) included.add(e.include);
          else continue;
        } else if (incRouter) e.routerVar = incRouter[1];
        else if (/^include\s*\(/.test(target)) continue;
        else e.handler = target.replace(/\.as_view\s*\(.*$/s, '').trim();
        entriesHere.push(e);
      }
      confs.set(u.path, { entries: entriesHere, routers });
      roles.push({ file: u.path, role: 'route', conf: 'resolved' });
    }

    let rootConf: string | null = null;
    for (const u of py) {
      const m = /ROOT_URLCONF\s*=\s*(['"])([\w.]+)\1/.exec(u.text);
      if (m) rootConf = moduleFile(ctx, m[2], u.path);
    }
    const roots = rootConf && confs.has(rootConf) ? [rootConf] : [...confs.keys()].filter((f) => !included.has(f));
    const emit = (file: string, prefix: string, seen: Set<string>) => {
      const conf = confs.get(file);
      if (!conf || seen.has(file)) return;
      seen.add(file);
      const u = ctx.unit(file)!;
      for (const e of conf.entries) {
        const path = joinRoute(prefix, e.regex ? e.route.replace(/^\^/, '').replace(/\$$/, '') : e.route);
        if (e.include) emit(e.include, path, new Set(seen));
        else if (e.routerVar) {
          for (const reg of conf.routers.get(e.routerVar) ?? []) {
            const h = ctx.resolve(file, reg.line, reg.viewset);
            for (const [suffix, label] of [['', 'list/create'], ['<pk>/', 'retrieve/update/destroy']] as const) {
              const r = mkRoute('django', 'ANY', joinRoute(path, reg.prefix + '/', suffix), file, reg.line);
              withHandler(r, h, reg.viewset.split('.').pop());
              r.handler = `${reg.viewset.split('.').pop()} (${label})`;
              routes.push(r);
            }
          }
        } else if (e.handler) {
          const h = ctx.resolve(file, e.line, e.handler, e.endLine);
          const hu = h ? ctx.unit(h.file) : undefined;
          const methods = h && hu ? decoratorMethods(hu, h.line) : null;
          for (const method of methods ?? ['ANY']) {
            const r = mkRoute('django', method, path, file, e.line);
            if (e.regex) r.conf = 'heuristic';
            routes.push(withHandler(r, h, e.handler.split('.').pop()));
          }
          if (h) roles.push({ file: h.file, role: 'controller', conf: 'heuristic' });
        }
      }
      void u;
    };
    for (const r of roots) emit(r, '', new Set());

    for (const u of py) {
      const b = basename(u.path);
      if (ctx.m.file(u.path)?.test) continue;
      if (b === 'models.py' || /\(models\.Model\)/.test(u.text)) roles.push({ file: u.path, role: 'model', conf: 'resolved' });
      else if (b === 'views.py' || b === 'viewsets.py') roles.push({ file: u.path, role: 'controller', conf: 'heuristic' });
      else if (b === 'settings.py' || b === 'apps.py' || b === 'admin.py' || /(^|\/)settings\//.test(u.path)) roles.push({ file: u.path, role: 'config', conf: 'heuristic' });
      else if (b === 'serializers.py' || b === 'forms.py') roles.push({ file: u.path, role: 'schema', conf: 'heuristic' });
      else if (b === 'manage.py' || b === 'wsgi.py' || b === 'asgi.py') roles.push({ file: u.path, role: 'entry', conf: 'resolved' });
      const cmd = /(^|\/)management\/commands\/(\w+)\.py$/.exec(u.path);
      if (cmd && cmd[2] !== '__init__') {
        const handle = ctx.resolve(u.path, 1, 'handle');
        entries.push({ id: `cli:${u.path}`, kind: 'cli', label: `manage.py ${cmd[2]}`, file: u.path, line: handle?.line ?? 1, sym: handle?.sym, framework: 'django', conf: 'resolved' });
        roles.push({ file: u.path, role: 'cli', conf: 'resolved' });
      }
      for (const m of ctx.grep(u, /^\s*@receiver\s*\(\s*([\w.]+)/m)) {
        const def = ctx.defAfter(u.path, m.line, 4);
        entries.push({ id: `event:${u.path}:${m.line}`, kind: 'event', label: `signal ${m.m[1]}`, file: u.path, line: def >= 0 ? ctx.a.symbols[def].line : m.line, sym: def >= 0 ? def : undefined, framework: 'django', conf: 'resolved' });
      }
      const mw = /^MIDDLEWARE(?:_CLASSES)?\s*=\s*[\[(]([\s\S]*?)[\])]/m.exec(u.text);
      if (mw) {
        const base = ctx.lineAt(u, mw.index);
        mw[1].split('\n').forEach((l, i) => {
          const s = /['"]([\w.]+)['"]/.exec(l);
          if (s) facts.push({ kind: 'middleware', file: u.path, line: base + i, detail: `middleware ${s[1]}`, target: s[1], conf: 'resolved', detector: 'django' });
        });
      }
    }
    return { routes, roles, facts, entries };
  },
};

const PY_ROUTE = /^[ \t]*@(\w+)\.(route|get|post|put|patch|delete|head|options|websocket|api_route)\s*\(/gm;

function scanDecorators(ctx: DetectContext, framework: 'flask' | 'fastapi'): DetectorResult {
  const routes: Route[] = [];
  const roles: RoleHint[] = [];
  const facts: Fact[] = [];
  const py = ctx.files('python');
  interface Owner { file: string; name: string; prefix: string; kind: 'app' | 'router' }
  const owners: Owner[] = [];
  const mounts: { owner: Owner; prefix: string | null; into?: Owner }[] = [];
  const ctor = framework === 'flask' ? /^[ \t]*(\w+)\s*=\s*(Flask|Blueprint)\s*\(/gm : /^[ \t]*(\w+)\s*=\s*(FastAPI|APIRouter)\s*\(/gm;

  for (const u of py) {
    for (const m of ctx.grep(u, ctor)) {
      const call = callArgs(u.text, m.index + m.m[0].length - 1);
      const argText = call ? u.text.slice(m.index, call.end) : '';
      const prefix = /\b(?:url_prefix|prefix)\s*=\s*(['"])([^'"]*)\1/.exec(argText)?.[2] ?? '';
      owners.push({ file: u.path, name: m.m[1], prefix, kind: m.m[2] === 'Flask' || m.m[2] === 'FastAPI' ? 'app' : 'router' });
    }
  }
  if (owners.length === 0) return {};
  const findOwner = (expr: string, from: string): Owner | undefined => {
    const parts = expr.split('.');
    const name = parts[parts.length - 1];
    const cands = owners.filter((o) => o.name === name);
    if (parts.length > 1) return cands.find((o) => stripExt(basename(o.file)) === parts[parts.length - 2] || basename(dirname(o.file)) === parts[parts.length - 2]) ?? cands[0];
    const fi = ctx.m.fileIdx.get(from);
    const deps = new Set(fi === undefined ? [] : ctx.m.deps(fi).map((d) => ctx.m.path(d)));
    return cands.find((o) => o.file === from) ?? cands.find((o) => deps.has(o.file));
  };
  for (const u of py) {
    for (const m of ctx.grep(u, /(\w+)\.(register_blueprint|include_router)\s*\(/)) {
      const call = callArgs(u.text, m.index + m.m[0].length - 1);
      if (!call || !call.args.length) continue;
      const owner = findOwner(call.args[0].text, u.path);
      if (!owner) continue;
      const rest = call.args.slice(1).map((a) => a.text).join(',');
      const p = /\b(?:url_prefix|prefix)\s*=\s*(['"])([^'"]*)\1/.exec(rest);
      mounts.push({ owner, prefix: p ? p[2] : null, into: findOwner(m.m[1], u.path) });
    }
  }
  const prefixOf = (o: Owner, depth = 0): string => {
    const mount = mounts.find((x) => x.owner === o);
    if (!mount || depth > 4) return o.prefix;
    const outer = mount.into && mount.into !== o ? prefixOf(mount.into, depth + 1) : '';
    // Flask: a url_prefix given at registration replaces the blueprint's own; FastAPI: prefixes concatenate
    return framework === 'flask' ? joinRoute(outer, mount.prefix ?? o.prefix) : joinRoute(outer, mount.prefix ?? '', o.prefix);
  };

  for (const u of py) {
    if (ctx.m.file(u.path)?.test) continue;
    let any = false;
    for (const m of ctx.grep(u, PY_ROUTE)) {
      const owner = findOwner(m.m[1], u.path);
      if (!owner) continue;
      const call = callArgs(u.text, m.index + m.m[0].length - 1);
      if (!call) continue;
      const p = literal(call.args[0]?.text);
      if (p === null) continue;
      const rest = call.args.slice(1).map((a) => a.text).join(',');
      const verb = m.m[2];
      let methods = verb === 'route' || verb === 'api_route' ? [...(/methods\s*=\s*[\[(]([^\])]*)[\])]/.exec(rest)?.[1] ?? "'GET'").matchAll(/['"](\w+)['"]/g)].map((x) => x[1]) : [verb];
      if (methods.length === 0) methods = ['GET'];
      const def = ctx.defAfter(u.path, ctx.lineAt(u, call.end), 8);
      let full = joinRoute(prefixOf(owner), p);
      if (p.endsWith('/') && !full.endsWith('/')) full += '/';
      for (const method of methods) {
        const r = mkRoute(framework, method, full || '/', u.path, m.line, verb === 'websocket' ? { kind: 'ws' } : {});
        if (def >= 0) withHandler(r, ctx.symInfo(def, 'heuristic'), ctx.a.symbols[def].name);
        // FastAPI dependencies act like middleware
        if (framework === 'fastapi') {
          const sig = def >= 0 ? u.text.split('\n').slice(ctx.a.symbols[def].line - 1, ctx.a.symbols[def].line + 8).join('\n') : '';
          for (const d of (rest + sig).matchAll(/Depends\s*\(\s*([\w.]+)\s*\)/g)) {
            if (r.middleware.some((x) => x.name === d[1])) continue;
            const h = ctx.resolve(u.path, m.line, d[1]);
            r.middleware.push({ name: d[1], file: h?.file, line: h?.line, sym: h?.sym });
          }
        }
        routes.push(r);
        any = true;
      }
    }
    for (const m of ctx.grep(u, /^[ \t]*@(\w+)\.(before_request|after_request|before_app_request|errorhandler|middleware)\b/m)) {
      const def = ctx.defAfter(u.path, m.line, 4);
      facts.push({ kind: 'middleware', file: u.path, line: def >= 0 ? ctx.a.symbols[def].line : m.line, detail: `${m.m[2]} hook${def >= 0 ? ` ${ctx.a.symbols[def].name}` : ''}`, target: def >= 0 ? ctx.a.symbols[def].name : m.m[2], conf: 'resolved', detector: framework });
    }
    if (any) roles.push({ file: u.path, role: 'controller', conf: 'heuristic' });
  }
  for (const o of owners) if (o.kind === 'app') roles.push({ file: o.file, role: 'entry', conf: 'heuristic' });
  return { routes, roles, facts };
}

export const flask: Detector = {
  id: 'flask',
  name: 'Flask',
  detect(ctx) {
    if (ctx.hasTech('flask')) return ctx.techEvidence('flask');
    const ev = ctx.firstEvidence(['python'], /^\s*from\s+flask\s+import\b|^\s*import\s+flask\b/m, 'imports flask');
    return ev.length ? ev : null;
  },
  analyze: (ctx) => scanDecorators(ctx, 'flask'),
};

export const fastapi: Detector = {
  id: 'fastapi',
  name: 'FastAPI',
  detect(ctx) {
    if (ctx.hasTech('fastapi')) return ctx.techEvidence('fastapi');
    const ev = ctx.firstEvidence(['python'], /^\s*from\s+fastapi\s+import\b|^\s*import\s+fastapi\b/m, 'imports fastapi');
    return ev.length ? ev : null;
  },
  analyze: (ctx) => scanDecorators(ctx, 'fastapi'),
};
