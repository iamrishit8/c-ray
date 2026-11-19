// Layout for the in-app ER diagram: entity cards on a grid, related entities placed next to each
// other (breadth-first from the most connected entity), relation lines clipped to the card edges.
import type { Confidence, Relation, SchemaResult } from '../types';

export interface ErBox {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fields drawn (the first `maxFields`). */
  shown: number;
  /** Fields left out. */
  more: number;
}

export interface ErLine {
  from: string;
  to: string;
  kind: Relation['kind'];
  conf: Confidence;
  via?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ErLayout {
  boxes: ErBox[];
  lines: ErLine[];
  width: number;
  height: number;
  /** Entities left out by `maxEntities`. */
  omitted: number;
}

export interface ErOptions {
  maxEntities?: number;
  maxFields?: number;
  boxW?: number;
  header?: number;
  rowH?: number;
  gapX?: number;
  gapY?: number;
  cols?: number;
}

/** Point where the segment from the box centre towards (tx, ty) leaves the box. */
function edgePoint(b: ErBox, tx: number, ty: number): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : b.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : b.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

export function erLayout(schema: SchemaResult, opts: ErOptions = {}): ErLayout {
  const maxEntities = opts.maxEntities ?? 60;
  const maxFields = opts.maxFields ?? 8;
  const W = opts.boxW ?? 210;
  const header = opts.header ?? 30;
  const rowH = opts.rowH ?? 19;
  const gapX = opts.gapX ?? 64;
  const gapY = opts.gapY ?? 44;
  const names = schema.entities.map((e) => e.name);
  const known = new Set(names);
  const rels = schema.relations.filter((r) => known.has(r.from) && known.has(r.to) && r.from !== r.to);
  const nb = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  for (const r of rels) {
    nb.get(r.from)!.add(r.to);
    nb.get(r.to)!.add(r.from);
  }
  // breadth-first from the most connected entity of each component keeps related cards together
  const order: string[] = [];
  const seen = new Set<string>();
  const byDegree = [...names].sort((x, y) => nb.get(y)!.size - nb.get(x)!.size || (x < y ? -1 : 1));
  for (const s of byDegree) {
    if (seen.has(s)) continue;
    const queue = [s];
    seen.add(s);
    for (let q = 0; q < queue.length; q++) {
      order.push(queue[q]);
      for (const t of [...nb.get(queue[q])!].sort()) if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  const placed = order.slice(0, maxEntities);
  const cols = opts.cols ?? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(placed.length))));
  const ent = new Map(schema.entities.map((e) => [e.name, e]));
  const boxes: ErBox[] = [];
  let y = 0;
  for (let r = 0; r * cols < placed.length; r++) {
    const row = placed.slice(r * cols, r * cols + cols).map((name, c) => {
      const n = ent.get(name)!.fields.length;
      const shown = Math.min(n, maxFields);
      const more = n - shown;
      const h = header + Math.max(1, shown) * rowH + (more > 0 ? rowH : 0) + 8;
      return { name, x: c * (W + gapX), y, w: W, h, shown, more };
    });
    boxes.push(...row);
    y += Math.max(...row.map((b) => b.h)) + gapY;
  }
  const at = new Map(boxes.map((b) => [b.name, b]));
  const lines: ErLine[] = [];
  for (const r of rels) {
    const a = at.get(r.from);
    const b = at.get(r.to);
    if (!a || !b) continue;
    const [x1, y1] = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const [x2, y2] = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2);
    lines.push({ from: r.from, to: r.to, kind: r.kind, conf: r.conf, via: r.via, x1, y1, x2, y2 });
  }
  const width = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : 0;
  return { boxes, lines, width, height: Math.max(0, y - gapY), omitted: order.length - placed.length };
}
