// Detectors for Spring Boot, Laravel, legacy PHP pages, Rails, Go (net/http, Gin & friends) and ASP.NET.
import type { EntryPoint, Fact, FileUnit, Route, Unresolved } from '../types';
import { basename, dirname } from '../util';
import { callArgs, DetectContext, joinRoute, literal, mkRoute, withHandler, type Detector, type RoleHint } from './types';

// ------------------------------------------------------------------ Spring Boot
const SPRING_MAP = /@(Get|Post|Put|Delete|Patch|Request)Mapping\b\s*(\(([^)]*)\))?/g;
function springPath(args: string | undefined): string[] {
  if (!args) return [''];
  const named = /\b(?:value|path)\s*=\s*(\{[^}]*\}|"[^"]*")/.exec(args);
  const src = named ? named[1] : /^\s*(\{[^}]*\}|"[^"]*")/.exec(args)?.[1];
  if (!src) return [''];
  const all = [...src.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return all.length ? all : [''];
}

export const spring: Detector = {
  id: 'spring-boot',
  name: 'Spring Boot',
  detect(ctx) {
    if (ctx.hasTech('spring-boot')) return ctx.techEvidence('spring-boot');
    const ev = ctx.firstEvidence(['java', 'kotlin'], /import\s+org\.springframework\./, 'imports org.springframework');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const facts: Fact[] = [];
    const entries: EntryPoint[] = [];
    for (const u of ctx.files('java', 'kotlin')) {
      const t = u.text;
      if (!t.includes('@')) continue;
      const isTest = ctx.m.file(u.path)?.test;
      if (/@(Rest)?Controller\b/.test(t) && !isTest) {
        roles.push({ file: u.path, role: 'controller', conf: 'resolved' });
        const ctl = /@(?:Rest)?Controller\b/.exec(t)!;
        const cls = ctx.defAfter(u.path, ctx.lineAt(u, ctl.index), 12);
        const clsLine = cls >= 0 ? ctx.a.symbols[cls].line : ctx.lineAt(u, ctl.index);
        let prefixes = [''];
        const hits = ctx.grep(u, SPRING_MAP);
        for (const h of hits) if (h.m[1] === 'Request' && h.line <= clsLine) prefixes = springPath(h.m[3]);
        for (const h of hits) {
          if (h.line <= clsLine) continue;
          const def = ctx.defAfter(u.path, h.line, 8);
          if (def < 0 || ctx.a.symbols[def].kind === 'class') continue;
          const methods = h.m[1] === 'Request' ? [...(h.m[3] ?? '').matchAll(/RequestMethod\.(\w+)/g)].map((m) => m[1]) : [h.m[1].toUpperCase()];
          for (const method of methods.length ? methods : ['ANY']) {
            for (const pre of prefixes) for (const p of springPath(h.m[3])) {
              const r = mkRoute('spring-boot', method, joinRoute(pre, p), u.path, h.line);
              const sec = /@(PreAuthorize|Secured|RolesAllowed)\s*\(([^)]*)\)/.exec(t.split('\n').slice(Math.max(0, h.line - 4), ctx.a.symbols[def].line).join('\n'));
              if (sec) r.middleware.push({ name: `@${sec[1]}(${sec[2].slice(0, 40)})`, file: u.path, line: h.line });
              routes.push(withHandler(r, ctx.symInfo(def, 'heuristic'), ctx.a.symbols[def].name));
            }
          }
        }
      }
      if (/@Service\b/.test(t)) roles.push({ file: u.path, role: 'service', conf: 'resolved' });
      if (/@Repository\b/.test(t) || /\bextends\s+(Jpa|Crud|PagingAndSorting|Mongo|Reactive\w*)Repository\b/.test(t)) roles.push({ file: u.path, role: 'repository', conf: 'resolved' });
      if (/@(Entity|Document|Table|MappedSuperclass)\b/.test(t)) roles.push({ file: u.path, role: 'model', conf: 'resolved' });
      if (/@(Configuration|EnableWebSecurity|ConfigurationProperties)\b/.test(t)) roles.push({ file: u.path, role: 'config', conf: 'resolved' });
      if (/@FeignClient\b/.test(t)) roles.push({ file: u.path, role: 'client', conf: 'resolved' });
      if (/\b(implements|extends)\s+[\w, ]*\b(Filter|HandlerInterceptor|OncePerRequestFilter|GenericFilterBean)\b/.test(t)) {
        roles.push({ file: u.path, role: 'middleware', conf: 'resolved' });
        facts.push({ kind: 'middleware', file: u.path, line: 1, detail: `servlet filter / interceptor ${basename(u.path)}`, target: basename(u.path).replace(/\.\w+$/, ''), conf: 'resolved', detector: 'spring-boot' });
      }
      const app = /@SpringBootApplication\b/.exec(t);
      if (app) {
        roles.push({ file: u.path, role: 'entry', conf: 'resolved' });
        const main = ctx.resolve(u.path, 1, 'main');
        entries.push({ id: `main:${u.path}`, kind: 'main', label: '@SpringBootApplication', file: u.path, line: main?.line ?? ctx.lineAt(u, app.index), sym: main?.sym, framework: 'spring-boot', conf: 'resolved' });
      }
      for (const h of ctx.grep(u, /@Scheduled\s*\(([^)]*)\)/)) {
        const def = ctx.defAfter(u.path, h.line, 5);
        entries.push({ id: `job:${u.path}:${h.line}`, kind: 'job', label: `@Scheduled(${h.m[1].slice(0, 50)})`, file: u.path, line: def >= 0 ? ctx.a.symbols[def].line : h.line, sym: def >= 0 ? def : undefined, framework: 'spring-boot', conf: 'resolved' });
        roles.push({ file: u.path, role: 'job', conf: 'resolved' });
      }
      for (const h of ctx.grep(u, /@(KafkaListener|RabbitListener|JmsListener|SqsListener|EventListener)\s*(?:\(([^)]*)\))?/)) {
        const topic = /"([^"]+)"/.exec(h.m[2] ?? '')?.[1];
        const def = ctx.defAfter(u.path, h.line, 5);
        if (h.m[1] !== 'EventListener') facts.push({ kind: 'queue-sub', file: u.path, line: h.line, detail: `@${h.m[1]}${topic ? ` "${topic}"` : ''}`, target: topic, tech: h.m[1].replace('Listener', '').toLowerCase(), conf: 'resolved', detector: 'spring-boot' });
        entries.push({ id: `event:${u.path}:${h.line}`, kind: 'event', label: `@${h.m[1]}${topic ? ` "${topic}"` : ''}`, file: u.path, line: def >= 0 ? ctx.a.symbols[def].line : h.line, sym: def >= 0 ? def : undefined, framework: 'spring-boot', conf: 'resolved' });
        roles.push({ file: u.path, role: 'messaging', conf: 'resolved' });
      }
    }
    return { routes, roles, facts, entries };
  },
};

// ------------------------------------------------------------------ Laravel
const RESOURCE: [string, string, string][] = [['GET', '', 'index'], ['GET', '/create', 'create'], ['POST', '', 'store'], ['GET', '/{id}', 'show'], ['GET', '/{id}/edit', 'edit'], ['PUT', '/{id}', 'update'], ['DELETE', '/{id}', 'destroy']];

export const laravel: Detector = {
  id: 'laravel',
  name: 'Laravel',
  detect(ctx) {
    if (ctx.hasTech('laravel')) return ctx.techEvidence('laravel');
    const ev = ctx.firstEvidence(['php'], /use\s+Illuminate\\/, 'uses Illuminate classes');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const entries: EntryPoint[] = [];
    const handlerOf = (u: FileUnit, line: number, cls: string, method: string) => {
      const c = ctx.resolveClass(cls.split('\\').pop()!, u.path);
      if (!c) return null;
      const si = ctx.m.findSymbol(c.file, method, cls.split('\\').pop()!);
      roles.push({ file: c.file, role: 'controller', conf: 'heuristic' });
      return si >= 0 ? ctx.symInfo(si, 'heuristic') : c;
    };
    for (const u of ctx.files('php')) {
      const t = u.text;
      if (/(^|\/)routes\/[\w-]+\.php$/.test(u.path) || /\bRoute::(get|post|put|patch|delete|resource|apiResource|group|prefix|middleware)\b/.test(t)) {
        roles.push({ file: u.path, role: 'route', conf: 'resolved' });
        const base = /(^|\/)routes\/api\.php$/.test(u.path) ? '/api' : '';
        // group stack via brace depth
        const stack: { depth: number; prefix: string; mw: string[] }[] = [];
        let depth = 0;
        const lines = t.split('\n');
        let offset = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const ln = i + 1;
          const group = /Route::(.*?)->group\s*\(|Route::group\s*\(\s*\[([^\]]*)\]/.exec(line);
          if (group) {
            const chain = group[1] ?? group[2] ?? '';
            const prefix = /prefix\s*(?:\(|'\s*=>|"\s*=>)\s*['"]([^'"]*)['"]/.exec(chain)?.[1] ?? /['"]prefix['"]\s*=>\s*['"]([^'"]*)['"]/.exec(chain)?.[1] ?? '';
            const mw = [...(/middleware\s*(?:\(|['"]?\s*=>)\s*(\[[^\]]*\]|['"][^'"]*['"])/.exec(chain)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
            stack.push({ depth, prefix, mw });
          } else {
            const m = /Route::(get|post|put|patch|delete|options|any|match|resource|apiResource|view)\s*\(/.exec(line);
            if (m) {
              const call = callArgs(t, offset + m.index + m[0].length - 1);
              const args = call?.args ?? [];
              const verb = m[1];
              const pathArg = verb === 'match' ? args[1] : args[0];
              const targetArg = verb === 'match' ? args[2] : args[1];
              const p = literal(pathArg?.text);
              if (p !== null && call) {
                const prefix = joinRoute(base, ...stack.map((s) => s.prefix));
                const tail = t.slice(call.end, call.end + 200).split(';')[0];
                const mw = [...stack.flatMap((s) => s.mw), ...[...(/->middleware\s*\(([^)]*)\)/.exec(tail)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])];
                const mws = mw.map((name) => ({ name }));
                const target = targetArg?.text ?? '';
                const arr = /\[\s*([\w\\]+)::class\s*,\s*['"](\w+)['"]\s*\]/.exec(target);
                const str = /^['"]([\w\\]+)@(\w+)['"]$/.exec(target);
                const invokable = /^([\w\\]+)::class$/.exec(target);
                if (verb === 'resource' || verb === 'apiResource') {
                  const cls = invokable?.[1] ?? '';
                  for (const [method, suffix, action] of RESOURCE) {
                    if (verb === 'apiResource' && (action === 'create' || action === 'edit')) continue;
                    const r = mkRoute('laravel', method, joinRoute(prefix, p, suffix), u.path, ln);
                    r.middleware = mws;
                    routes.push(withHandler(r, handlerOf(u, ln, cls, action), action));
                  }
                } else {
                  const methods = verb === 'match' ? [...args[0].text.matchAll(/['"](\w+)['"]/g)].map((x) => x[1]) : [verb === 'any' ? 'ANY' : verb === 'view' ? 'GET' : verb];
                  for (const method of methods) {
                    const r = mkRoute('laravel', method, joinRoute(prefix, p), u.path, ln);
                    r.middleware = mws;
                    if (arr) withHandler(r, handlerOf(u, ln, arr[1], arr[2]), arr[2]);
                    else if (str) withHandler(r, handlerOf(u, ln, str[1], str[2]), str[2]);
                    else if (invokable) withHandler(r, handlerOf(u, ln, invokable[1], '__invoke'), '__invoke');
                    else {
                      r.handler = verb === 'view' ? `view ${target}` : '(closure)';
                      r.hFile = u.path;
                      r.hLine = ln;
                      r.hEnd = ctx.lineAt(u, call.end);
                    }
                    routes.push(r);
                  }
                }
              }
            }
          }
          for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
            }
          }
          offset += line.length + 1;
        }
      }
      if (/\bextends\s+Model\b|\bextends\s+Authenticatable\b/.test(t)) roles.push({ file: u.path, role: 'model', conf: 'resolved' });
      if (/\bimplements\s+[\w, ]*ShouldQueue\b/.test(t)) {
        roles.push({ file: u.path, role: 'job', conf: 'resolved' });
        const h = ctx.resolve(u.path, 1, 'handle');
        entries.push({ id: `job:${u.path}`, kind: 'job', label: `queued job ${basename(u.path, )}`, file: u.path, line: h?.line ?? 1, sym: h?.sym, framework: 'laravel', conf: 'resolved' });
      }
      const sig = /protected\s+\$signature\s*=\s*['"]([^'"\s]+)/.exec(t);
      if (sig && /\bextends\s+Command\b/.test(t)) {
        const h = ctx.resolve(u.path, 1, 'handle');
        entries.push({ id: `cli:${u.path}`, kind: 'cli', label: `artisan ${sig[1]}`, file: u.path, line: h?.line ?? 1, sym: h?.sym, framework: 'laravel', conf: 'resolved' });
        roles.push({ file: u.path, role: 'cli', conf: 'resolved' });
      }
      if (/(^|\/)Http\/Middleware\//.test(u.path)) roles.push({ file: u.path, role: 'middleware', conf: 'heuristic' });
    }
    return { routes, roles, entries };
  },
};

// ------------------------------------------------------------------ Legacy PHP (no framework): file-based entry points
export const phpPages: Detector = {
  id: 'php-pages',
  name: 'PHP pages (file-based routing)',
  detect(ctx) {
    if (ctx.hasTech('laravel', 'symfony')) return null;
    const ev = ctx.firstEvidence(['php'], /\$_(GET|POST|REQUEST|SERVER|SESSION)\b|\bheader\s*\(|session_start\s*\(/, 'uses PHP request superglobals directly');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const unresolved: Unresolved[] = [];
    for (const u of ctx.files('php')) {
      const fi = ctx.m.fileIdx.get(u.path);
      if (fi === undefined || ctx.a.files[fi].test) continue;
      const includedBy = ctx.m.inn[fi].filter((e) => e.kind === 'include').length;
      // code outside functions/classes that produces output or reads the request
      const outside = stripDefs(ctx, u);
      const active = /\$_(GET|POST|REQUEST|COOKIE|FILES)\b|\becho\b|\bprint\b|\bheader\s*\(|\?>\s*\S|<\?=|session_start\s*\(/.test(outside);
      if (includedBy === 0 && active) {
        const r = mkRoute('php-pages', 'ANY', '/' + u.path, u.path, 1, { handler: '(script)', hFile: u.path, hLine: 1, hEnd: ctx.a.files[fi].loc, conf: 'heuristic' });
        routes.push(r);
        roles.push({ file: u.path, role: 'entry', conf: 'heuristic' });
        const sw = /\$_(?:GET|REQUEST)\[\s*['"](\w+)['"]\s*\]/.exec(u.text);
        if (sw && /\bswitch\s*\(|\binclude\b|\brequire\b/.test(u.text)) {
          for (const c of ctx.grep(u, /\bcase\s+(['"])([\w-]+)\1\s*:/)) {
            routes.push(mkRoute('php-pages', 'ANY', `/${u.path}?${sw[1]}=${c.m[2]}`, u.path, c.line, { handler: `case '${c.m[2]}'`, hFile: u.path, hLine: c.line, hEnd: Math.min(ctx.a.files[fi].loc, c.line + 3), conf: 'heuristic' }));
          }
        }
      } else if (includedBy > 0 && active && !/\b(function|class)\s+\w+/.test(u.text)) {
        roles.push({ file: u.path, role: 'view', conf: 'heuristic' });
      }
    }
    return { routes, roles, unresolved };
  },
};

function stripDefs(ctx: DetectContext, u: FileUnit): string {
  const fi = ctx.m.fileIdx.get(u.path)!;
  const lines = u.text.split('\n');
  for (const si of ctx.m.symsByFile[fi]) {
    const s = ctx.a.symbols[si];
    if (s.parent) continue;
    for (let l = s.line; l <= s.endLine && l <= lines.length; l++) lines[l - 1] = '';
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ Rails
function singular(s: string): string {
  return s.endsWith('ies') ? s.slice(0, -3) + 'y' : s.endsWith('ses') ? s.slice(0, -2) : s.endsWith('s') ? s.slice(0, -1) : s;
}

export const rails: Detector = {
  id: 'rails',
  name: 'Ruby on Rails',
  detect(ctx) {
    if (ctx.hasTech('rails')) return ctx.techEvidence('rails');
    const ev = ctx.firstEvidence(['ruby'], /Rails\.application\.routes\.draw|<\s*ApplicationController\b|<\s*ApplicationRecord\b/, 'Rails conventions');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const entries: EntryPoint[] = [];
    const rb = ctx.files('ruby');
    const action = (u: FileUnit, line: number, controller: string, name: string) => {
      const file = rb.find((x) => x.path.endsWith(`controllers/${controller}_controller.rb`))?.path;
      if (!file) return null;
      const si = ctx.m.findSymbol(file, name);
      return si >= 0 ? ctx.symInfo(si, 'heuristic') : null;
    };
    for (const u of rb) {
      if (/(^|\/)config\/routes\.rb$/.test(u.path) || /routes\.draw\s+do/.test(u.text)) {
        roles.push({ file: u.path, role: 'route', conf: 'resolved' });
        const stack: { prefix: string; ns: string; kind: string }[] = [];
        const lines = u.text.split('\n');
        lines.forEach((raw, i) => {
          const line = raw.replace(/(^|\s)#(\s.*)?$/, '').trim();
          const ln = i + 1;
          if (!line) return;
          const prefix = joinRoute(...stack.map((s) => s.prefix));
          const ns = stack.map((s) => s.ns).filter(Boolean).join('/');
          const opensBlock = /\bdo(\s*\|[^|]*\|)?\s*$/.test(line);
          let m: RegExpExecArray | null;
          if ((m = /^(get|post|put|patch|delete|match)\s+['"]([^'"]+)['"]\s*(?:,\s*to:\s*|\s*=>\s*)['"]([\w/]+)#(\w+)['"]/.exec(line))) {
            const r = mkRoute('rails', m[1] === 'match' ? 'ANY' : m[1], joinRoute(prefix, m[2]), u.path, ln);
            routes.push(withHandler(r, action(u, ln, (ns ? ns + '/' : '') + m[3], m[4]), m[4]));
          } else if ((m = /^root\s+(?:to:\s*)?['"]([\w/]+)#(\w+)['"]/.exec(line))) {
            routes.push(withHandler(mkRoute('rails', 'GET', prefix || '/', u.path, ln), action(u, ln, m[1], m[2]), m[2]));
          } else if ((m = /^(resources|resource)\s+:(\w+)(.*)$/.exec(line))) {
            const only = /only:\s*(?:\[([^\]]*)\]|:(\w+))/.exec(m[3]);
            const except = /except:\s*(?:\[([^\]]*)\]|:(\w+))/.exec(m[3]);
            const pick = (x: RegExpExecArray | null) => (x ? [...(x[1] ?? ':' + x[2]).matchAll(/:(\w+)/g)].map((y) => y[1]) : null);
            const onlyL = pick(only);
            const exceptL = pick(except);
            const plural = m[1] === 'resources';
            const ctl = (ns ? ns + '/' : '') + (plural ? m[2] : m[2] + 's');
            const table: [string, string, string][] = plural
              ? [['GET', '', 'index'], ['GET', '/new', 'new'], ['POST', '', 'create'], ['GET', '/:id', 'show'], ['GET', '/:id/edit', 'edit'], ['PATCH', '/:id', 'update'], ['DELETE', '/:id', 'destroy']]
              : [['GET', '/new', 'new'], ['POST', '', 'create'], ['GET', '', 'show'], ['GET', '/edit', 'edit'], ['PATCH', '', 'update'], ['DELETE', '', 'destroy']];
            for (const [method, suffix, act] of table) {
              if (onlyL && !onlyL.includes(act)) continue;
              if (exceptL && exceptL.includes(act)) continue;
              const r = mkRoute('rails', method, joinRoute(prefix, m[2], suffix), u.path, ln);
              routes.push(withHandler(r, action(u, ln, ctl, act), act));
            }
            if (opensBlock) stack.push({ prefix: plural ? `${m[2]}/:${singular(m[2])}_id` : m[2], ns: '', kind: 'resources' });
            return;
          } else if ((m = /^namespace\s+:(\w+)/.exec(line))) {
            if (opensBlock) stack.push({ prefix: m[1], ns: m[1], kind: 'namespace' });
            return;
          } else if ((m = /^scope\s+(?:path:\s*)?['"]([^'"]+)['"]/.exec(line)) || (m = /^scope\s+:(\w+)/.exec(line))) {
            if (opensBlock) stack.push({ prefix: m[1], ns: /module:\s*['":](\w+)/.exec(line)?.[1] ?? '', kind: 'scope' });
            return;
          }
          if (opensBlock && !/routes\.draw/.test(line)) stack.push({ prefix: '', ns: '', kind: 'block' });
          else if (/^end\b/.test(line)) stack.pop();
        });
      }
      if (/<\s*(ApplicationController|ActionController::(Base|API))\b/.test(u.text)) {
        roles.push({ file: u.path, role: 'controller', conf: 'resolved' });
      }
      if (/<\s*(ApplicationRecord|ActiveRecord::Base)\b/.test(u.text)) roles.push({ file: u.path, role: 'model', conf: 'resolved' });
      if (/<\s*(ApplicationJob|ActiveJob::Base)\b|include\s+Sidekiq::(Worker|Job)\b/.test(u.text)) {
        roles.push({ file: u.path, role: 'job', conf: 'resolved' });
        const h = ctx.resolve(u.path, 1, 'perform');
        entries.push({ id: `job:${u.path}`, kind: 'job', label: `background job ${basename(u.path)}`, file: u.path, line: h?.line ?? 1, sym: h?.sym, framework: 'rails', conf: 'resolved' });
      }
      if (/<\s*ApplicationMailer\b/.test(u.text)) roles.push({ file: u.path, role: 'client', conf: 'heuristic' });
      if (/(^|\/)lib\/tasks\/.*\.rake$/.test(u.path)) {
        for (const m of ctx.grep(u, /^\s*task\s+:?['"]?([\w:]+)/m)) entries.push({ id: `cli:${u.path}:${m.line}`, kind: 'cli', label: `rake ${m.m[1]}`, file: u.path, line: m.line, framework: 'rails', conf: 'resolved' });
      }
    }
    // before_action filters act as middleware for every action of the controller
    for (const r of routes) {
      if (!r.hFile) continue;
      const u = ctx.unit(r.hFile);
      if (!u) continue;
      for (const m of ctx.grep(u, /^\s*before_action\s+:(\w+)(.*)$/m)) {
        const only = /only:\s*(?:\[([^\]]*)\]|:(\w+))/.exec(m.m[2]);
        if (only && r.handler && !(only[1] ?? ':' + only[2]).includes(':' + r.handler)) continue;
        const h = ctx.resolve(u.path, m.line, m.m[1]);
        r.middleware.push({ name: m.m[1], file: h?.file ?? u.path, line: h?.line ?? m.line, sym: h?.sym });
      }
    }
    return { routes, roles, entries };
  },
};

// ------------------------------------------------------------------ Go: net/http, Gin, Echo, chi, gorilla/mux
export const goHttp: Detector = {
  id: 'go-http',
  name: 'Go net/http / Gin',
  detect(ctx) {
    const ev = [
      ...ctx.techEvidence('gin', 'echo', 'chi', 'gorilla-mux'),
      ...ctx.firstEvidence(['go'], /"net\/http"|"github\.com\/gin-gonic\/gin"/, 'imports net/http or gin'),
    ];
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const facts: Fact[] = [];
    for (const u of ctx.files('go')) {
      if (ctx.m.file(u.path)?.test) continue;
      const t = u.text;
      const gin = /gin-gonic\/gin|labstack\/echo/.test(t);
      const prefixes = new Map<string, string>();
      const mws = new Map<string, Route['middleware']>();
      for (const m of ctx.grep(u, /(\w+)\s*:?=\s*(\w+)\.Group\s*\(\s*"([^"]*)"/)) prefixes.set(m.m[1], joinRoute(prefixes.get(m.m[2]) ?? '', m.m[3]));
      for (const m of ctx.grep(u, /(\w+)\.Use\s*\(/)) {
        const call = callArgs(t, m.index + m.m[0].length - 1);
        for (const a of call?.args ?? []) {
          const name = a.text.replace(/\(.*$/s, '');
          if (!/^[\w.]+$/.test(name)) continue;
          const h = ctx.resolve(u.path, m.line, name);
          mws.set(m.m[1], [...(mws.get(m.m[1]) ?? []), { name, file: h?.file, line: h?.line, sym: h?.sym }]);
          if (h) roles.push({ file: h.file, role: 'middleware', conf: 'heuristic' });
        }
      }
      let any = false;
      const add = (method: string, path: string, line: number, recv: string, handlerArgs: { text: string; start: number; end: number }[]) => {
        const r = mkRoute(gin ? 'gin' : 'go-http', method, joinRoute(prefixes.get(recv) ?? '', path), u.path, line);
        r.middleware = [...(mws.get(recv) ?? [])];
        const last = handlerArgs[handlerArgs.length - 1];
        for (const a of handlerArgs.slice(0, -1)) {
          const name = a.text.replace(/\(.*$/s, '');
          const h = /^[\w.]+$/.test(name) ? ctx.resolve(u.path, line, name) : null;
          r.middleware.push({ name, file: h?.file, line: h?.line, sym: h?.sym });
        }
        if (last) {
          if (/^func\s*\(/.test(last.text)) {
            r.handler = '(inline)';
            r.hFile = u.path;
            r.hLine = ctx.lineAt(u, last.start);
            r.hEnd = ctx.lineAt(u, last.end);
          } else {
            const expr = last.text.replace(/^http\.HandlerFunc\s*\(/, '').replace(/\(.*$/s, '').replace(/\)$/, '');
            withHandler(r, ctx.resolve(u.path, line, expr, ctx.lineAt(u, last.end)), expr.split('.').pop());
          }
        }
        routes.push(r);
        any = true;
      };
      // gin / echo / chi verbs
      for (const m of ctx.grep(u, /(\w+)\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|Get|Post|Put|Patch|Delete)\s*\(/)) {
        if (/^(http|client|c|ctx|resty|req|r\.Header)$/.test(m.m[1]) && m.m[1] !== 'r') continue;
        const call = callArgs(t, m.index + m.m[0].length - 1);
        const p = literal(call?.args[0]?.text);
        if (!call || p === null || call.args.length < 2 || !(p === '' || p.startsWith('/'))) continue;
        add(m.m[2] === 'Any' ? 'ANY' : m.m[2], p, m.line, m.m[1], call.args.slice(1));
      }
      // net/http + gorilla
      for (const m of ctx.grep(u, /(\w+)\.(HandleFunc|Handle)\s*\(/)) {
        const call = callArgs(t, m.index + m.m[0].length - 1);
        const p = literal(call?.args[0]?.text);
        if (!call || p === null || call.args.length < 2) continue;
        const mp = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/.exec(p);
        const tail = t.slice(call.end, call.end + 80);
        const gm = /^\)\s*\.Methods\s*\(([^)]*)\)/.exec(tail);
        const methods = mp ? [mp[1]] : gm ? [...gm[1].matchAll(/"(\w+)"/g)].map((x) => x[1]) : ['ANY'];
        for (const method of methods) add(method, mp ? mp[2] : p, m.line, m.m[1], call.args.slice(1));
      }
      if (any) roles.push({ file: u.path, role: 'route', conf: 'heuristic' });
      for (const m of ctx.grep(u, /http\.ListenAndServe(?:TLS)?\s*\(|\.Run\s*\(\s*"?:/)) facts.push({ kind: 'controller', file: u.path, line: m.line, detail: 'starts the HTTP server', conf: 'heuristic', detector: 'go-http' });
    }
    for (const r of routes) if (r.hFile && r.hFile !== r.file) roles.push({ file: r.hFile, role: 'controller', conf: 'heuristic' });
    return { routes, roles, facts };
  },
};

// ------------------------------------------------------------------ ASP.NET Core
export const aspnet: Detector = {
  id: 'aspnet',
  name: 'ASP.NET Core',
  detect(ctx) {
    if (ctx.hasTech('aspnet')) return ctx.techEvidence('aspnet');
    const ev = ctx.firstEvidence(['csharp'], /using\s+Microsoft\.AspNetCore\b|\[ApiController\]|WebApplication\.CreateBuilder/, 'ASP.NET Core APIs');
    return ev.length ? ev : null;
  },
  analyze(ctx) {
    const routes: Route[] = [];
    const roles: RoleHint[] = [];
    const facts: Fact[] = [];
    const entries: EntryPoint[] = [];
    for (const u of ctx.files('csharp')) {
      const t = u.text;
      if (ctx.m.file(u.path)?.test) continue;
      const ctl = /class\s+(\w+)\s*(?:<[^>]*>)?\s*(?:\([^)]*\))?\s*:\s*[\w<>, .]*\b(ControllerBase|Controller)\b/.exec(t);
      if (ctl || /\[ApiController\]/.test(t)) {
        roles.push({ file: u.path, role: 'controller', conf: 'resolved' });
        const clsName = ctl?.[1] ?? basename(u.path).replace(/\.cs$/, '');
        const clsLine = ctl ? ctx.lineAt(u, ctl.index) : 1;
        const token = clsName.replace(/Controller$/, '');
        let prefix = '';
        for (const m of ctx.grep(u, /\[Route\s*\(\s*"([^"]*)"/)) if (m.line <= clsLine) prefix = m.m[1];
        const classAuth = ctx.grep(u, /\[Authorize\b[^\]]*\]/).some((m) => m.line <= clsLine);
        for (const m of ctx.grep(u, /\[Http(Get|Post|Put|Delete|Patch|Head|Options)\s*(?:\(\s*(?:"([^"]*)")?[^)]*\))?\s*\]/)) {
          if (m.line <= clsLine) continue;
          const def = ctx.defAfter(u.path, m.line, 8);
          if (def < 0) continue;
          const d = ctx.a.symbols[def];
          const sub = m.m[2] ?? '';
          const path = (sub.startsWith('/') || sub.startsWith('~/') ? sub.replace(/^~/, '') : joinRoute(prefix, sub)).replace(/\[controller\]/gi, token.toLowerCase()).replace(/\[action\]/gi, d.name);
          const r = mkRoute('aspnet', m.m[1], path.startsWith('/') ? path : '/' + path, u.path, m.line);
          const between = t.split('\n').slice(Math.max(0, m.line - 4), d.line).join('\n');
          if (classAuth || /\[Authorize\b/.test(between)) r.middleware.push({ name: '[Authorize]', file: u.path, line: m.line });
          routes.push(withHandler(r, ctx.symInfo(def, 'heuristic'), d.name));
        }
      }
      // minimal APIs
      const groups = new Map<string, string>();
      for (const m of ctx.grep(u, /(?:var|RouteGroupBuilder)\s+(\w+)\s*=\s*(\w+)\.MapGroup\s*\(\s*"([^"]*)"/)) groups.set(m.m[1], joinRoute(groups.get(m.m[2]) ?? '', m.m[3]));
      for (const m of ctx.grep(u, /(\w+)\.Map(Get|Post|Put|Delete|Patch)\s*\(/)) {
        const call = callArgs(t, m.index + m.m[0].length - 1);
        const p = literal(call?.args[0]?.text);
        if (!call || p === null || call.args.length < 2) continue;
        const r = mkRoute('aspnet', m.m[2], joinRoute(groups.get(m.m[1]) ?? '', p), u.path, m.line);
        const h = call.args[1];
        if (/=>|\bdelegate\b/.test(h.text)) {
          r.handler = '(inline)';
          r.hFile = u.path;
          r.hLine = ctx.lineAt(u, h.start);
          r.hEnd = ctx.lineAt(u, h.end);
        } else withHandler(r, ctx.resolve(u.path, m.line, h.text, ctx.lineAt(u, h.end)), h.text.split('.').pop());
        if (/\.RequireAuthorization\s*\(/.test(t.slice(call.end, call.end + 120).split(';')[0])) r.middleware.push({ name: 'RequireAuthorization', file: u.path, line: m.line });
        routes.push(r);
        roles.push({ file: u.path, role: 'route', conf: 'heuristic' });
      }
      for (const m of ctx.grep(u, /\bapp\.Use(\w+)\s*\(/)) facts.push({ kind: 'middleware', file: u.path, line: m.line, detail: `pipeline middleware Use${m.m[1]}`, target: `Use${m.m[1]}`, conf: 'resolved', detector: 'aspnet' });
      for (const m of ctx.grep(u, /\.Add(Scoped|Transient|Singleton)\s*<\s*([\w.]+)\s*(?:,\s*([\w.]+)\s*)?>/)) {
        facts.push({ kind: 'di', file: u.path, line: m.line, detail: `${m.m[1]} registration ${m.m[2]}${m.m[3] ? ` → ${m.m[3]}` : ''}`, target: m.m[3] ?? m.m[2], conf: 'resolved', detector: 'aspnet' });
      }
      if (/WebApplication\.CreateBuilder|Host\.CreateDefaultBuilder/.test(t)) roles.push({ file: u.path, role: 'entry', conf: 'resolved' });
      if (/:\s*[\w<>, ]*\bDbContext\b/.test(t)) roles.push({ file: u.path, role: 'repository', conf: 'resolved' });
      if (/:\s*[\w<>, ]*\b(BackgroundService|IHostedService)\b/.test(t)) {
        roles.push({ file: u.path, role: 'job', conf: 'resolved' });
        const h = ctx.resolve(u.path, 1, 'ExecuteAsync') ?? ctx.resolve(u.path, 1, 'StartAsync');
        entries.push({ id: `job:${u.path}`, kind: 'job', label: `hosted service ${basename(u.path)}`, file: u.path, line: h?.line ?? 1, sym: h?.sym, framework: 'aspnet', conf: 'resolved' });
      }
      if (/(^|\/)Middleware\//.test(u.path) || /\bInvokeAsync\s*\(\s*HttpContext\b/.test(t)) roles.push({ file: u.path, role: 'middleware', conf: 'heuristic' });
    }
    return { routes, roles, facts, entries };
  },
};

export { dirname };
