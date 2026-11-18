// Architecture diff between two history snapshots (time-travel). Kept apart from
// analyze.ts so the UI and report can use it without loading isomorphic-git.
import type { ArchSnapshot } from '../types';

export interface ArchDiff {
  addedModules: ArchSnapshot['modules'];
  removedModules: ArchSnapshot['modules'];
  changedModules: { name: string; filesBefore: number; filesAfter: number; locBefore: number; locAfter: number }[];
  addedEdges: ArchSnapshot['edges'];
  removedEdges: ArchSnapshot['edges'];
  hotspotGrowth: { file: string; before: number; after: number }[];
  loc: [number, number];
  files: [number, number];
  avgComplexity: [number, number];
}

/** Architecture diff between two snapshots (time-travel). */
export function diffSnapshots(before: ArchSnapshot, after: ArchSnapshot): ArchDiff {
  const b = new Map(before.modules.map((m) => [m.name, m]));
  const a = new Map(after.modules.map((m) => [m.name, m]));
  const ek = (e: { from: string; to: string }) => `${e.from}\u0000${e.to}`;
  const be = new Set(before.edges.map(ek));
  const ae = new Set(after.edges.map(ek));
  const hb = new Map(before.hotspots.map((h) => [h.file, h.complexity]));
  return {
    addedModules: after.modules.filter((m) => !b.has(m.name)),
    removedModules: before.modules.filter((m) => !a.has(m.name)),
    changedModules: after.modules.filter((m) => b.has(m.name) && (b.get(m.name)!.loc !== m.loc || b.get(m.name)!.files !== m.files)).map((m) => ({ name: m.name, filesBefore: b.get(m.name)!.files, filesAfter: m.files, locBefore: b.get(m.name)!.loc, locAfter: m.loc })).sort((x, y) => Math.abs(y.locAfter - y.locBefore) - Math.abs(x.locAfter - x.locBefore)),
    addedEdges: after.edges.filter((e) => !be.has(ek(e))),
    removedEdges: before.edges.filter((e) => !ae.has(ek(e))),
    hotspotGrowth: after.hotspots.map((h) => ({ file: h.file, before: hb.get(h.file) ?? 0, after: h.complexity })).filter((h) => h.after !== h.before).sort((x, y) => y.after - y.before - (x.after - x.before)),
    loc: [before.loc, after.loc], files: [before.files, after.files], avgComplexity: [before.avgComplexity, after.avgComplexity],
  };
}
