// Workspace packages declared by package.json manifests, with the entry file used when code
// imports a package by name (including a package importing itself, e.g. tests: require('fastify')).
import type { StageContext } from './pipeline';
import type { ResolverPackage } from './resolve-js';
import { dirname } from './util';

/** The file behind `exports["."]` (string, or the first string in a conditions object). */
function exportsEntry(exp: unknown): string | undefined {
  if (typeof exp === 'string') return exp;
  if (!exp || typeof exp !== 'object') return undefined;
  const root = '.' in exp ? (exp as Record<string, unknown>)['.'] : exp;
  if (typeof root === 'string') return root;
  if (root && typeof root === 'object') {
    for (const k of ['source', 'import', 'require', 'node', 'default']) {
      const v = exportsEntry((root as Record<string, unknown>)[k]);
      if (v) return v;
    }
  }
  return undefined;
}

export function workspacePackages(ctx: StageContext): ResolverPackage[] {
  const out: ResolverPackage[] = [];
  for (const m of ctx.a.l0.manifests) {
    if (m.type !== 'package.json' || !m.name) continue;
    let main: string | undefined;
    try {
      const json = JSON.parse(ctx.unitByPath.get(m.file)?.text ?? '{}');
      main = typeof json.source === 'string' ? json.source : typeof json.main === 'string' ? json.main : typeof json.module === 'string' ? json.module : exportsEntry(json.exports);
    } catch {
      /* malformed package.json: fall back to the default entry candidates */
    }
    out.push({ name: m.name, dir: dirname(m.file), main });
  }
  return out;
}

