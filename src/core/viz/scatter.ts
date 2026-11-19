// Hotspot map data: complexity (y) against churn (x, with history) or fan-in (x, without), one point
// per code file. The "risky" quadrant is at or above the 75th percentile on both axes.
import { CODE_LANGS } from '../l0/languages';
import type { Analysis, Role } from '../types';

export interface ScatterPoint {
  file: string;
  x: number;
  y: number;
  /** Lines of code (bubble area). */
  size: number;
  role: Role;
  risky: boolean;
}

export interface Scatter {
  points: ScatterPoint[];
  x: 'churn' | 'fan-in';
  xMax: number;
  yMax: number;
  xCut: number;
  yCut: number;
  /** Files in the risky quadrant, riskiest (x·y) first. */
  risky: string[];
  /** Points left out by the cap. */
  omitted: number;
}

/** Linear-interpolated quantile of the values (0 for an empty list). */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function hotspotScatter(a: Analysis, opts: { max?: number } = {}): Scatter {
  const max = opts.max ?? 1500;
  const churn = new Map((a.git?.churn ?? []).map((c) => [c.file, c.commits]));
  const fanIn = new Map(a.deps.metrics.map((m) => [m.file, m.fanIn]));
  const useChurn = !!a.git;
  const all = a.files
    .filter((f) => CODE_LANGS.has(f.lang) && !f.test)
    .map((f) => ({ file: f.path, x: (useChurn ? churn.get(f.path) : fanIn.get(f.path)) ?? 0, y: f.complexity, size: f.loc, role: f.role, risky: false }))
    .filter((p) => p.x > 0 || p.y > 0);
  all.sort((p, q) => q.x * q.y - p.x * p.y || q.y - p.y || q.size - p.size);
  const points = all.slice(0, max);
  // cut-offs from the non-zero values, never below 1 (a file must have changed / be used at least once)
  const xCut = Math.max(1, quantile(all.filter((p) => p.x > 0).map((p) => p.x), 0.75));
  const yCut = Math.max(1, quantile(all.filter((p) => p.y > 0).map((p) => p.y), 0.75));
  for (const p of points) p.risky = p.x >= xCut && p.y >= yCut;
  return {
    points, x: useChurn ? 'churn' : 'fan-in',
    xMax: Math.max(1, ...points.map((p) => p.x)), yMax: Math.max(1, ...points.map((p) => p.y)),
    xCut, yCut, risky: points.filter((p) => p.risky).map((p) => p.file), omitted: all.length - points.length,
  };
}
