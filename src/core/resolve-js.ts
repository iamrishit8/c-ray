// Module specifier resolution for JavaScript/TypeScript: relative paths,
// tsconfig paths/baseUrl and workspace packages. Shared by L1 and L2.
import { dirname, joinPath } from './util';

export interface ResolverConfig {
  path: string;
  text: string;
}
export interface ResolverPackage {
  name: string;
  dir: string;
  main?: string;
}

/** JSON with comments and trailing commas (tsconfig files). */
export function parseJsonc(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    try {
      const stripped = text
        .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '')
        .replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}

const NODE_BUILTINS = new Set(['assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring', 'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib']);

export function packageOf(spec: string): string {
  if (spec.startsWith('node:')) return spec;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return NODE_BUILTINS.has(name) ? `node:${name}` : name;
}

const EXT_CANDIDATES = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs'];

/** Resolves a relative-looking path against the project file set. */
export function resolveFileLike(base: string, paths: Set<string>): string | null {
  for (const ext of EXT_CANDIDATES) if (paths.has(base + ext)) return base + ext;
  // TS allows importing './x.js' for './x.ts'
  const m = /^(.*)\.(js|jsx|mjs|cjs)$/.exec(base);
  if (m) for (const ext of ['.ts', '.tsx', '.mts', '.cts']) if (paths.has(m[1] + ext)) return m[1] + ext;
  return null;
}

interface TsConfig {
  dir: string;
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

function loadConfigs(configs: ResolverConfig[]): TsConfig[] {
  const raw = new Map<string, any>();
  for (const c of configs) {
    const parsed = parseJsonc(c.text);
    if (parsed && typeof parsed === 'object') raw.set(c.path, parsed);
  }
  const optionsOf = (path: string, depth = 0): { baseUrl?: string; paths?: Record<string, string[]> } => {
    const cfg = raw.get(path);
    if (!cfg || depth > 5) return {};
    let inherited: { baseUrl?: string; paths?: Record<string, string[]> } = {};
    if (typeof cfg.extends === 'string' && cfg.extends.startsWith('.')) {
      const parent = joinPath(dirname(path), cfg.extends.endsWith('.json') ? cfg.extends : cfg.extends + '.json');
      inherited = optionsOf(parent, depth + 1);
    }
    const co = cfg.compilerOptions ?? {};
    const dir = dirname(path);
    const baseUrl = typeof co.baseUrl === 'string' ? joinPath(dir, co.baseUrl) : inherited.baseUrl;
    const paths = co.paths && typeof co.paths === 'object'
      ? Object.fromEntries(Object.entries(co.paths as Record<string, string[]>).map(([k, v]) => [k, (Array.isArray(v) ? v : []).map((t) => joinPath(baseUrl ?? dir, t))]))
      : inherited.paths;
    return { baseUrl, paths };
  };
  const out: TsConfig[] = [];
  for (const path of raw.keys()) out.push({ dir: dirname(path), ...optionsOf(path) });
  return out.sort((a, b) => b.dir.length - a.dir.length);
}

/** Module resolver shared by L2 (and reused by L1 for JS/TS): relative, tsconfig paths/baseUrl, workspace packages. */
export class ModuleResolver {
  private configs: TsConfig[];
  private pkgs: ResolverPackage[];
  private cache = new Map<string, string | null>();

  constructor(private paths: Set<string>, configs: ResolverConfig[], packages: ResolverPackage[]) {
    this.configs = loadConfigs(configs);
    this.pkgs = [...packages].sort((a, b) => b.name.length - a.name.length);
  }

  resolve(spec: string, from: string): string | null {
    const fromDir = dirname(from);
    const key = (spec.startsWith('.') ? fromDir : this.configFor(from)?.dir ?? '') + '\0' + spec;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const res = this.resolveUncached(spec.replace(/\?.*$/, ''), from, fromDir);
    this.cache.set(key, res);
    return res;
  }

  private configFor(from: string): TsConfig | undefined {
    return this.configs.find((c) => c.dir === '' || from.startsWith(c.dir + '/'));
  }

  private resolveUncached(spec: string, from: string, fromDir: string): string | null {
    if (spec.startsWith('.')) return resolveFileLike(joinPath(fromDir, spec), this.paths);
    if (spec.startsWith('/')) return resolveFileLike(spec.slice(1), this.paths);
    const cfg = this.configFor(from);
    if (cfg?.paths) {
      for (const [pattern, targets] of Object.entries(cfg.paths)) {
        const star = pattern.indexOf('*');
        let rest: string | null = null;
        if (star < 0) rest = spec === pattern ? '' : null;
        else if (spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1))) rest = spec.slice(star, spec.length - (pattern.length - star - 1));
        if (rest === null) continue;
        for (const t of targets) {
          const r = resolveFileLike(t.replace('*', rest), this.paths);
          if (r) return r;
        }
      }
    }
    if (cfg?.baseUrl !== undefined) {
      const r = resolveFileLike(joinPath(cfg.baseUrl, spec), this.paths);
      if (r) return r;
    }
    for (const p of this.pkgs) {
      if (spec === p.name) {
        const cands = [p.main && joinPath(p.dir, p.main), joinPath(p.dir, 'src/index'), joinPath(p.dir, 'index'), joinPath(p.dir, 'src/main'), joinPath(p.dir, 'lib/index')].filter(Boolean) as string[];
        for (const c of cands) {
          const r = resolveFileLike(c.replace(/\.(js|ts)$/, ''), this.paths) ?? resolveFileLike(c, this.paths);
          if (r) return r;
        }
        return null;
      }
      if (spec.startsWith(p.name + '/')) {
        const sub = spec.slice(p.name.length + 1);
        return resolveFileLike(joinPath(p.dir, sub), this.paths) ?? resolveFileLike(joinPath(p.dir, 'src', sub), this.paths);
      }
    }
    return null;
  }
}

