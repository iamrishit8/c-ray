// Ring and circle layouts in unit coordinates (radius 1 = the outer ring), for the Impact blast
// radius and the History snapshot graph. Pure and bounded.

export interface RingItem<T> {
  item: T;
  /** 1-based ring. */
  ring: number;
  x: number;
  y: number;
}

export interface RingInfo {
  ring: number;
  radius: number;
  count: number;
  shown: number;
}

/** `groups[k]` holds the items on ring k + 1. Each ring shows at most `maxPerRing` items, evenly spaced. */
export function radialLayout<T>(groups: T[][], opts: { maxPerRing?: number } = {}): { rings: RingInfo[]; items: RingItem<T>[] } {
  const maxPer = opts.maxPerRing ?? 90;
  const n = groups.length;
  const rings: RingInfo[] = [];
  const items: RingItem<T>[] = [];
  groups.forEach((g, k) => {
    const ring = k + 1;
    const radius = ring / n;
    const shown = Math.min(g.length, maxPer);
    rings.push({ ring, radius, count: g.length, shown });
    // rotate each ring a little so neighbouring rings don't line up into spokes
    const offset = -Math.PI / 2 + (k * Math.PI) / 7;
    for (let i = 0; i < shown; i++) {
      const t = offset + (2 * Math.PI * i) / shown;
      items.push({ item: g[i], ring, x: radius * Math.cos(t), y: radius * Math.sin(t) });
    }
  });
  return { rings, items };
}

/** Names on one circle in a stable order (sorted), so the same name keeps its place across snapshots. */
export function circleLayout(names: string[]): Map<string, { x: number; y: number }> {
  const sorted = [...new Set(names)].sort();
  const out = new Map<string, { x: number; y: number }>();
  if (sorted.length === 1) out.set(sorted[0], { x: 0, y: 0 });
  else sorted.forEach((name, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / sorted.length;
    out.set(name, { x: Math.cos(t), y: Math.sin(t) });
  });
  return out;
}
