// Detectors for the JavaScript/TypeScript ecosystem: Express, Fastify, NestJS, Next.js, React.
import type { EntryPoint, Fact, FileUnit, Route, Unresolved } from '../types';
import { basename, dirname } from '../util';
import { callArgs, DetectContext, HTTP_METHODS, joinRoute, literal, mkRoute, withHandler, type Detector, type DetectorResult, type RoleHint } from './types';

const JS = ['javascript', 'typescript'];
const INLINE_FN = /^(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/;
const NOT_ROUTER = /^(axios|http|https|request|fetch|got|superagent|client|api|\$|_|lodash|map|cache|redis|store|session|params|query|headers|cookies|res|req|response|localStorage|sessionStorage|config|env|i18n|t)$/i;

interface LocalRoute {
  route: Route;
  /** Line range of the enclosing function (for Fastify plugin prefixes). */
  fn?: string;
}
interface Mount {
  file: string;
  prefix: string;
  target: string;
  line: number;
  middleware: Route['middleware'];
}

function attachHandler(ctx: DetectContext, u: FileUnit, r: Route, arg: { text: string; start: number; end: number }) {
  const t = arg.text;
  if (INLINE_FN.test(t)) {
    r.handler = '(inline)';
    r.hFile = u.path;
    r.hLine = ctx.lineAt(u, arg.start + (/^\s*/.exec(u.text.slice(arg.start))?.[0].length ?? 0));
    r.hEnd = ctx.lineAt(u, arg.end);
    r.conf = ctx.m.file(u.path)?.level === 2 ? 'resolved' : 'heuristic';
    return;
  }
  const expr = t.replace(/\(.*$/s, '').replace(/^await\s+/, '').trim();
  const line = ctx.lineAt(u, arg.start);
  withHandler(r, ctx.resolve(u.path, line, expr, ctx.lineAt(u, arg.end)), expr.split('.').pop());
}

function middlewareOf(ctx: DetectContext, u: FileUnit, args: { text: string; start: number; end: number }[]): Route['middleware'] {
  const out: Route['middleware'] = [];
  for (const a of args) {
    const items = a.text.startsWith('[') ? a.text.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : [a.text];
    for (const item of items) {
      if (INLINE_FN.test(item)) {
        out.push({ name: '(inline)', file: u.path, line: ctx.lineAt(u, a.start) });
        continue;
      }
      const expr = item.replace(/\(.*$/s, '').trim();
      if (!/^[\w$.]+$/.test(expr)) continue;
      const h = ctx.resolve(u.path, ctx.lineAt(u, a.start), expr, ctx.lineAt(u, a.end));
      out.push({ name: expr, file: h?.file, line: h?.line, sym: h?.sym });
    }
  }
  return out;
}

/** Shared scanner for Express-style and Fastify-style `router.METHOD(path, ...handlers)` APIs. */
function scanRouters(ctx: DetectContext, flavor: 'express' | 'fastify'): DetectorResult {
  const locals = new Map<string, LocalRoute[]>();
  const mounts: Mount[] = [];
  const pending: (Mount & { all: Route['middleware'] })[] = [];
  const globalMw = new Map<string, Route['middleware']>();
  const unresolved: Unresolved[] = [];
  const facts: Fact[] = [];

  for (const u of ctx.files(...JS)) {
    if (ctx.m.file(u.path)?.test) continue;
    const vars = new Set<string>();
    if (flavor === 'express') {
      for (const m of u.text.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:express\s*\(\s*\)|(?:express\.)?Router\s*\(|new\s+(?:express\.)?Router\s*\()/g)) vars.add(m[1]);
      if (vars.size === 0) continue;
    } else {
      for (const m of u.text.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?(?:fastify|Fastify)\s*\(/g)) vars.add(m[1]);
      for (const m of u.text.matchAll(/(?:function\s+[\w$]*\s*\(|\(|=\s*)\s*([\w$]+)\s*:\s*FastifyInstance\b/g)) vars.add(m[1]);
      for (const m of u.text.matchAll(/(?:async\s+)?(?:function\s+[\w$]+\s*|=\s*(?:async\s*)?)\(\s*(fastify|app|server|instance)\s*(?:,\s*[\w$]+\s*)?(?:,\s*[\w$]+\s*)?\)/g)) {
        if (/fastify/i.test(u.text)) vars.add(m[1]);
      }
      if (vars.size === 0) continue;
    }
    const list: LocalRoute[] = [];
    const varAlt = [...vars].map((v) => v.replace(/\$/g, '\\$')).join('|');
    const re = new RegExp(`(?<![\\w$.])(${varAlt})\\.(${HTTP_METHODS.join('|')}|use|register|route|addHook)\\s*\\(`, 'g');
    for (const hit of ctx.grep(u, re)) {
      const recv = hit.m[1];
      const method = hit.m[2];
      if (NOT_ROUTER.test(recv) && !vars.has(recv)) continue;
      const open = hit.index + hit.m[0].length - 1;
      const call = callArgs(u.text, open);
      if (!call || call.args.length === 0) continue;
      const args = call.args;
      const p0 = literal(args[0].text);

      if (method === 'use' || method === 'register') {
        // mount: use('/prefix', ...mw, router)  |  register(plugin, { prefix })
        let prefix = '';
        let targetArg = args[args.length - 1];
        let mwArgs = args.slice(0, -1);
        if (method === 'use') {
          if (p0 !== null) {
            prefix = p0;
            mwArgs = args.slice(1, -1);
          }
        } else {
          targetArg = args[0];
          mwArgs = [];
          prefix = /prefix\s*:\s*(['"`])([^'"`]*)\1/.exec(args[1]?.text ?? '')?.[2] ?? '';
        }
        const expr = targetArg.text.replace(/\(.*$/s, '').trim();
        const req = /^require\s*\(\s*(['"`])([^'"`]+)\1/.exec(targetArg.text);
        let target: string | null = null;
        if (req) {
          const fi = ctx.m.fileIdx.get(u.path)!;
          const e = ctx.a.imports.find((x) => x.from === fi && x.spec === req[2] && x.to >= 0);
          target = e ? ctx.m.path(e.to) : null;
        } else if (/^[\w$.]+$/.test(expr)) {
          target = moduleOf(ctx, u, expr) ?? ctx.resolve(u.path, hit.line, expr, ctx.lineAt(u, call.end))?.file ?? null;
        }
        if (target && target !== u.path) {
          // decided after the scan: a target that declares routes is a mounted router, otherwise it is middleware
          pending.push({ file: u.path, prefix, target, line: hit.line, middleware: middlewareOf(ctx, u, mwArgs), all: method === 'use' ? middlewareOf(ctx, u, p0 !== null ? args.slice(1) : args) : [] });
        } else if (method === 'use') {
          const mw = middlewareOf(ctx, u, p0 !== null ? args.slice(1) : args).filter((x) => !/^(express|bodyParser|cors|helmet|morgan|compression|cookieParser)\b/.test(x.name) || x.file);
          if (mw.length) {
            globalMw.set(u.path, [...(globalMw.get(u.path) ?? []), ...mw]);
            for (const x of mw) facts.push({ kind: 'middleware', file: u.path, line: hit.line, detail: `global middleware ${x.name}`, target: x.name, conf: x.sym !== undefined ? 'resolved' : 'heuristic', detector: flavor });
          }
        }
        continue;
      }
      if (method === 'addHook') {
        const mw = middlewareOf(ctx, u, args.slice(1));
        if (mw.length) globalMw.set(u.path, [...(globalMw.get(u.path) ?? []), ...mw]);
        continue;
      }
      if (method === 'route') {
        if (flavor === 'fastify') {
          const obj = args[0].text;
          const url = /\b(?:url|path)\s*:\s*(['"`])([^'"`]*)\1/.exec(obj)?.[2];
          const ms = /\bmethod\s*:\s*(\[[^\]]*\]|['"`]\w+['"`])/.exec(obj)?.[1];
          const h = /\bhandler\s*:\s*([\w$.]+)/.exec(obj);
          if (url === undefined) continue;
          for (const mm of (ms ?? "'GET'").matchAll(/\w+/g)) {
            const r = mkRoute(flavor, mm[0], url, u.path, hit.line);
            if (h) withHandler(r, ctx.resolve(u.path, hit.line, h[1], ctx.lineAt(u, call.end)), h[1].split('.').pop());
            else {
              r.handler = '(inline)';
              r.hFile = u.path;
              r.hLine = hit.line;
              r.hEnd = ctx.lineAt(u, call.end);
            }
            list.push({ route: r });
          }
        } else if (p0 !== null) {
          // router.route('/p').get(h).post(h2)
          let pos = call.end + 1;
          for (;;) {
            const chain = /^\s*\.(get|post|put|patch|delete|all|options|head)\s*\(/.exec(u.text.slice(pos, pos + 200));
            if (!chain) break;
            const c2 = callArgs(u.text, pos + chain[0].length - 1);
            if (!c2 || c2.args.length === 0) break;
            const r = mkRoute(flavor, chain[1] === 'all' ? 'ANY' : chain[1], p0, u.path, ctx.lineAt(u, pos + chain[0].length));
            r.middleware = middlewareOf(ctx, u, c2.args.slice(0, -1));
            attachHandler(ctx, u, r, c2.args[c2.args.length - 1]);
            list.push({ route: r });
            pos = c2.end + 1;
          }
        }
        continue;
      }
      // plain route
      if (p0 === null) {
        if (args.length >= 2 && !/^['"`]/.test(args[0].text)) {
          // not a literal path: could be a non-route call (e.g. Map#get) or a computed route
          if (args.length >= 2 && /^[\w$.]+$|^`/.test(args[0].text) && INLINE_FN.test(args[args.length - 1].text)) {
            unresolved.push({ file: u.path, line: hit.line, kind: 'dynamic-route', detail: `route path is not a string literal: ${recv}.${method}(${args[0].text.slice(0, 60)}, …)` });
          }
        } else if (/^`/.test(args[0].text)) unresolved.push({ file: u.path, line: hit.line, kind: 'dynamic-route', detail: `route path is built from a template string: ${args[0].text.slice(0, 80)}` });
        continue;
      }
      if (args.length < 2) continue; // e.g. app.get('setting')
      if (!(p0 === '' || p0.startsWith('/') || p0 === '*')) continue;
      const r = mkRoute(flavor, method === 'all' ? 'ANY' : method, p0, u.path, hit.line);
      let mid = args.slice(1, -1);
      if (flavor === 'fastify' && mid.length && mid[0].text.startsWith('{')) {
        const opts = mid[0].text;
        mid = [];
        for (const k of ['onRequest', 'preValidation', 'preHandler']) {
          const m = new RegExp(`\\b${k}\\s*:\\s*(\\[[^\\]]*\\]|[\\w$.]+(?:\\([^)]*\\))?)`).exec(opts);
          if (m) r.middleware.push(...middlewareOf(ctx, u, [{ text: m[1], start: args[1].start + m.index, end: args[1].start + m.index + m[0].length }]));
        }
      }
      r.middleware.push(...middlewareOf(ctx, u, mid));
      attachHandler(ctx, u, r, args[args.length - 1]);
      list.push({ route: r });
    }
    if (list.length) locals.set(u.path, list);
  }

  for (const p of pending) {
    if (locals.has(p.target) || pending.some((q) => q.file === p.target)) mounts.push(p);
    else if (p.all.length) {
      globalMw.set(p.file, [...(globalMw.get(p.file) ?? []), ...p.all]);
      for (const x of p.all) facts.push({ kind: 'middleware', file: p.file, line: p.line, detail: `global middleware ${x.name}`, target: x.name, conf: x.sym !== undefined ? 'resolved' : 'heuristic', detector: flavor });
    }
  }
  // resolve mount prefixes (a router file may be mounted from another router file)
  const prefixes = (file: string, seen = new Set<string>()): { prefix: string; mw: Route['middleware'] }[] => {
    if (seen.has(file)) return [{ prefix: '', mw: [] }];
    seen.add(file);
    const ms = mounts.filter((m) => m.target === file);
    const own = globalMw.get(file) ?? [];
    if (ms.length === 0) return [{ prefix: '', mw: own }];
    return ms.flatMap((m) => prefixes(m.file, new Set(seen)).map((p) => ({ prefix: joinRoute(p.prefix, m.prefix), mw: [...p.mw, ...m.middleware, ...own] })));
  };
  const routes: Route[] = [];
  const roles: RoleHint[] = [];
  for (const [file, list] of locals) {
    const ps = prefixes(file);
    roles.push({ file, role: 'route', conf: 'heuristic' });
    for (const { route } of list) {
      ps.forEach((p, i) => {
        const r: Route = i === 0 ? route : { ...route, id: route.id + ':' + i };
        const full = joinRoute(p.prefix, route.path);
        routes.push({ ...r, path: full, params: [...full.matchAll(/:(\w+)/g)].map((m) => m[1]), middleware: [...p.mw.filter((x) => !route.middleware.some((y) => y.name === x.name)), ...route.middleware] });
      });
      if (route.hFile && route.hFile !== file) roles.push({ file: route.hFile, role: 'controller', conf: 'heuristic' });
      for (const mw of route.middleware) if (mw.file && mw.file !== file) roles.push({ file: mw.file, role: 'middleware', conf: 'heuristic' });
    }
  }
  for (const mws of globalMw.values()) for (const mw of mws) if (mw.file) roles.push({ file: mw.file, role: 'middleware', conf: 'heuristic' });
  return { routes, roles, unresolved, facts };
}

/** If `ident` is bound to a whole module in this file (require / default / namespace import), return that module's file. */
function moduleOf(ctx: DetectContext, u: FileUnit, ident: string): string | null {
  if (!/^[\w$]+$/.test(ident)) return null;
  const esc = ident.replace(/\$/g, '\\$');
  const m =
    new RegExp(`(?:const|let|var)\\s+${esc}\\s*=\\s*require\\s*\\(\\s*(['"\`])([^'"\`]+)\\1`).exec(u.text) ??
    new RegExp(`import\\s+(?:\\*\\s+as\\s+)?${esc}\\s*(?:,\\s*\\{[^}]*\\})?\\s+from\\s+(['"\`])([^'"\`]+)\\1`).exec(u.text);
  if (!m) return null;
  const fi = ctx.m.fileIdx.get(u.path)!;
  const e = ctx.a.imports.find((x) => x.from === fi && x.spec === m[2] && x.to >= 0);
  return e ? ctx.m.path(e.to) : null;
}

export const express: Detector = {
  id: 'express',
  name: 'Express',
  detect(ctx) {
    if (ctx.hasTech('express')) return ctx.techEvidence('express');
    const ev = ctx.firstEvidence(JS, /require\s*\(\s*['"]express['"]\s*\)|from\s+['"]express['"]/, 'imports express');
    return ev.length ? ev : null;
  },
  analyze: (ctx) => scanRouters(ctx, 'express'),
};

export const fastify: Detector = {
  id: 'fastify',
  name: 'Fastify',
  detect(ctx) {
    if (ctx.hasTech('fastify')) return ctx.techEvidence('fastify');
    const ev = ctx.firstEvidence(JS, /require\s*\(\s*['"]fastify['"]\s*\)|from\s+['"]fastify['"]/, 'imports fastify');
    return ev.length ? ev : null;
  },
  analyze: (ctx) => scanRouters(ctx, 'fastify'),
};

const NEST_HTTP = /@(Get|Post|Put|Patch|Delete|All|Options|Head)\s*\(([^)]*)\)/g;

export const nestjs: Detector = {
  id: 'nestjs',
  name: 'NestJS',
  detect(ctx) {
    if (ctx.hasTech('nestjs')) return ctx.techEvidence('nestjs');
    const ev = ctx.firstEvidence(['typescript'], /from\s+['"]@nestjs\/common['"]/, 'imports @nestjs/common');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const facts: Fact[] = [];
    const entries: EntryPoint[] = [];
    let globalPrefix = '';
    for (const u of ctx.files('typescript')) {
      const gp = /setGlobalPrefix\s*\(\s*(['"`])([^'"`]+)\1/.exec(u.text);
      if (gp) globalPrefix = gp[2];
    }
    const guardsIn = (u: FileUnit, fromLine: number, toLine: number): Route['middleware'] => {
      const out: Route['middleware'] = [];
      const lines = u.text.split('\n');
      for (let l = Math.max(1, fromLine); l <= toLine && l <= lines.length; l++) {
        const m = /@(UseGuards|UseInterceptors|UsePipes|UseFilters)\s*\(([^)]*)\)/.exec(lines[l - 1]);
        if (!m) continue;
        for (const name of m[2].split(',').map((s) => s.trim().replace(/^new\s+/, '').replace(/\(.*$/, '')).filter((s) => /^[\w$.]+$/.test(s))) {
          const h = ctx.resolve(u.path, l, name);
          out.push({ name, file: h?.file, line: h?.line, sym: h?.sym });
          if (h) roles.push({ file: h.file, role: 'middleware', conf: h.conf });
        }
      }
      return out;
    };
    for (const u of ctx.files('typescript')) {
      if (!u.text.includes('@')) continue;
      for (const c of ctx.grep(u, /@Controller\s*\(([^)]*)\)/)) {
        const prefix = literal(c.m[1]) ?? /path\s*:\s*(['"`])([^'"`]*)\1/.exec(c.m[1])?.[2] ?? '';
        const cls = ctx.defAfter(u.path, c.line);
        if (cls < 0) continue;
        const cs = ctx.a.symbols[cls];
        roles.push({ file: u.path, role: 'controller', conf: 'resolved' });
        const classMw = guardsIn(u, c.line - 6, cs.line);
        let prevEnd = cs.line;
        for (const h of ctx.grep(u, NEST_HTTP)) {
          if (h.line < cs.line || h.line > cs.endLine) continue;
          const def = ctx.defAfter(u.path, h.line, 10);
          if (def < 0) continue;
          const d = ctx.a.symbols[def];
          const sub = literal(h.m[2]) ?? '';
          const r = mkRoute('nestjs', h.m[1] === 'All' ? 'ANY' : h.m[1], joinRoute(globalPrefix, prefix, sub), u.path, h.line);
          r.middleware = [...classMw, ...guardsIn(u, Math.max(prevEnd + 1, h.line - 6), d.line)];
          withHandler(r, ctx.symInfo(def, ctx.m.file(u.path)?.level === 2 ? 'resolved' : 'heuristic'), d.name);
          routes.push(r);
          prevEnd = d.endLine;
        }
      }
      for (const h of ctx.grep(u, /@(MessagePattern|EventPattern|SubscribeMessage)\s*\(\s*(['"`])([^'"`]+)\2/)) {
        const def = ctx.defAfter(u.path, h.line, 6);
        facts.push({ kind: 'queue-sub', file: u.path, line: h.line, detail: `@${h.m[1]}('${h.m[3]}')`, target: h.m[3], tech: 'nestjs', conf: 'resolved', detector: 'nestjs' });
        entries.push({ id: `event:${u.path}:${h.line}`, kind: 'event', label: `${h.m[1]} "${h.m[3]}"`, file: u.path, line: def >= 0 ? ctx.a.symbols[def].line : h.line, sym: def >= 0 ? def : undefined, framework: 'nestjs', conf: 'resolved' });
      }
      for (const h of ctx.grep(u, /@(Cron|Interval|Timeout)\s*\(([^)]*)\)/)) {
        const def = ctx.defAfter(u.path, h.line, 6);
        entries.push({ id: `job:${u.path}:${h.line}`, kind: 'job', label: `@${h.m[1]}(${h.m[2].slice(0, 40)})`, file: u.path, line: def >= 0 ? ctx.a.symbols[def].line : h.line, sym: def >= 0 ? def : undefined, framework: 'nestjs', conf: 'resolved' });
      }
      if (/@Injectable\s*\(/.test(u.text)) {
        const b = basename(u.path).toLowerCase();
        roles.push({ file: u.path, role: /guard|interceptor|pipe|filter|middleware/.test(b) ? 'middleware' : /repositor|\.dao\./.test(b) ? 'repository' : 'service', conf: 'resolved' });
      }
      if (/@Module\s*\(/.test(u.text)) roles.push({ file: u.path, role: 'config', conf: 'resolved' });
      if (/NestFactory\.create/.test(u.text)) roles.push({ file: u.path, role: 'entry', conf: 'resolved' });
    }
    return { routes, roles, facts, entries };
  },
};

function nextRoute(rel: string): string {
  const segs = rel.split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return '/' + segs.map((s) => (/^\[\[?\.\.\.(\w+)\]\]?$/.test(s) ? '*' + /(\w+)/.exec(s)![1] : /^\[(\w+)\]$/.test(s) ? ':' + s.slice(1, -1) : s)).filter((s) => s !== 'index').join('/');
}

export const nextjs: Detector = {
  id: 'nextjs',
  name: 'Next.js',
  detect(ctx) {
    return ctx.hasTech('nextjs') ? ctx.techEvidence('nextjs') : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const facts: Fact[] = [];
    const roots = ctx.a.l0.manifests.filter((m) => m.type === 'package.json' && m.deps.some((d) => d.name === 'next')).map((m) => dirname(m.file));
    for (const u of ctx.files(...JS)) {
      const root = roots.filter((r) => r === '' || u.path.startsWith(r + '/')).sort((x, y) => y.length - x.length)[0];
      if (root === undefined) continue;
      const rel = (root ? u.path.slice(root.length + 1) : u.path).replace(/^src\//, '');
      const noExt = rel.replace(/\.(tsx?|jsx?|mjs)$/, '');
      const level2 = ctx.m.file(u.path)?.level === 2;
      if (rel.startsWith('pages/')) {
        const p = noExt.slice('pages/'.length);
        if (/^_(app|document|error)$/.test(p)) {
          roles.push({ file: u.path, role: 'config', conf: 'resolved' });
          continue;
        }
        const isApi = p.startsWith('api/') || p === 'api';
        const r = mkRoute('nextjs', isApi ? 'ANY' : 'GET', nextRoute(p), u.path, 1, { kind: isApi ? 'http' : 'page', conf: 'resolved' });
        const def = /export\s+default\s+(?:async\s+)?(?:function\s+)?([\w$]+)?/.exec(u.text);
        const h = def?.[1] ? ctx.resolve(u.path, ctx.lineAt(u, def.index), def[1]) : null;
        if (h) withHandler(r, { ...h, conf: level2 ? 'resolved' : 'heuristic' }, def![1]);
        else {
          r.handler = 'default export';
          r.hFile = u.path;
          r.hLine = def ? ctx.lineAt(u, def.index) : 1;
          r.hEnd = u.text.split('\n').length;
        }
        routes.push(r);
        roles.push({ file: u.path, role: isApi ? 'controller' : 'page', conf: 'resolved' });
      } else if (rel.startsWith('app/')) {
        const b = basename(noExt);
        const dir = dirname(noExt).slice('app'.length).replace(/^\//, '');
        if (b === 'page') {
          const r = mkRoute('nextjs', 'GET', nextRoute(dir), u.path, 1, { kind: 'page', conf: 'resolved', handler: 'default export', hFile: u.path, hLine: 1, hEnd: u.text.split('\n').length });
          routes.push(r);
          roles.push({ file: u.path, role: 'page', conf: 'resolved' });
        } else if (b === 'route') {
          for (const m of ctx.grep(u, /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/)) {
            const r = mkRoute('nextjs', m.m[1], nextRoute(dir), u.path, m.line, { conf: 'resolved' });
            withHandler(r, ctx.resolve(u.path, m.line, m.m[1]), m.m[1]);
            if (r.handlerSym !== undefined && level2) r.conf = 'resolved';
            routes.push(r);
          }
          roles.push({ file: u.path, role: 'controller', conf: 'resolved' });
        } else if (b === 'layout' || b === 'template' || b === 'loading' || b === 'error' || b === 'not-found') {
          roles.push({ file: u.path, role: 'view', conf: 'resolved' });
        }
      } else if (/^middleware\.(ts|js)$/.test(rel)) {
        roles.push({ file: u.path, role: 'middleware', conf: 'resolved' });
        facts.push({ kind: 'middleware', file: u.path, line: 1, detail: 'Next.js middleware (runs before matched routes)', target: 'middleware', conf: 'resolved', detector: 'nextjs' });
      }
      if (/^\s*['"]use server['"]/m.test(u.text)) facts.push({ kind: 'controller', file: u.path, line: 1, detail: 'server actions ("use server")', conf: 'resolved', detector: 'nextjs' });
    }
    return { routes, roles, facts };
  },
};

export const react: Detector = {
  id: 'react',
  name: 'React',
  detect(ctx) {
    if (ctx.hasTech('react')) return ctx.techEvidence('react');
    const ev = ctx.firstEvidence(JS, /from\s+['"]react['"]|require\s*\(\s*['"]react['"]\s*\)/, 'imports react');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const facts: Fact[] = [];
    const roles: RoleHint[] = [];
    const routes: Route[] = [];
    for (const u of ctx.files(...JS)) {
      const jsx = /\.(jsx|tsx)$/.test(u.path) || /<\/[A-Za-z]|\/>/.test(u.text) && /\breturn\s*\(?\s*</.test(u.text);
      if (!jsx) continue;
      const fi = ctx.m.fileIdx.get(u.path);
      if (fi === undefined) continue;
      const level2 = ctx.a.files[fi].level === 2;
      let any = false;
      for (const si of ctx.m.symsByFile[fi]) {
        const s = ctx.a.symbols[si];
        if (!/^[A-Z][A-Za-z0-9]*$/.test(s.name) || s.parent || (s.kind !== 'function' && s.kind !== 'class')) continue;
        const body = u.text.split('\n').slice(s.line - 1, s.endLine).join('\n');
        if (!/<[A-Za-z][\w.]*[\s/>]|<>/.test(body)) continue;
        any = true;
        facts.push({ kind: 'component', file: u.path, line: s.line, detail: `React component ${s.name}`, target: s.name, conf: level2 ? 'resolved' : 'heuristic', detector: 'react' });
      }
      if (any && !ctx.m.file(u.path)?.test) roles.push({ file: u.path, role: /(^|\/)(pages|routes|screens|views)\//.test(u.path) || /Page\.[jt]sx$/.test(u.path) ? 'page' : 'component', conf: 'heuristic' });
      // react-router
      for (const m of ctx.grep(u, /<Route\b[^>]*?\bpath\s*=\s*(?:\{\s*)?(['"`])([^'"`]*)\1[^>]*?(?:element\s*=\s*\{\s*<\s*([\w.]+)|component\s*=\s*\{\s*([\w.]+))/s)) {
        const comp = m.m[3] ?? m.m[4];
        routes.push(withHandler(mkRoute('react-router', 'GET', m.m[2], u.path, m.line, { kind: 'page' }), ctx.resolve(u.path, m.line, comp, m.line + 3), comp));
      }
      for (const m of ctx.grep(u, /\bpath\s*:\s*(['"`])([^'"`]*)\1\s*,\s*(?:element\s*:\s*<\s*([\w.]+)|Component\s*:\s*([\w.]+))/)) {
        const comp = m.m[3] ?? m.m[4];
        routes.push(withHandler(mkRoute('react-router', 'GET', m.m[2], u.path, m.line, { kind: 'page' }), ctx.resolve(u.path, m.line, comp, m.line + 1), comp));
      }
    }
    return { facts, roles, routes };
  },
};
