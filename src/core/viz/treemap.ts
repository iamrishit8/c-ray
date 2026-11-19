// Squarified treemap (Bruls, Huizing & van Wijk 2000) over the file tree, sized by lines.
// Pure and bounded: at most `maxCells` cells; the smallest siblings fold into one "other" cell.

export interface TreeNode {
  name: string;
  /** Directory path ('' for the root) or file path. */
  path: string;
  /** Lines of code (at least 1 per file, so empty files still get a sliver). */
  weight: number;
  files: number;
  children: TreeNode[];
  /** Index into Analysis.files for file leaves. */
  file?: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface Cell extends Rect {
  path: string;
  name: string;
  kind: 'dir' | 'file' | 'other';
  /** 1 = a child of the node being laid out, 2 = a grandchild drawn inside it. */
  depth: number;
  weight: number;
  files: number;
  file?: number;
  /** For `other`: how many siblings were folded into it. */
  folded?: number;
}

export interface TreemapOptions {
  /** Levels drawn (1 = only the node's children). */
  depth?: number;
  maxCells?: number;
  /** Siblings whose cell would be smaller than this (px²) fold into "other". */
  minArea?: number;
  /** Space reserved at the top of a directory cell for its label. */
  header?: number;
  pad?: number;
}

/** Directory tree with aggregated weights; children sorted by weight, largest first. */
export function fileTree(files: { path: string; loc: number }[]): TreeNode {
  const root: TreeNode = { name: '', path: '', weight: 0, files: 0, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  files.forEach((f, i) => {
    const parts = f.path.split('/');
    const w = Math.max(1, f.loc);
    let cur = root;
    cur.weight += w;
    cur.files++;
    for (let k = 0; k < parts.length - 1; k++) {
      const p = parts.slice(0, k + 1).join('/');
      let d = dirs.get(p);
      if (!d) {
        d = { name: parts[k], path: p, weight: 0, files: 0, children: [] };
        dirs.set(p, d);
        cur.children.push(d);
      }
      d.weight += w;
      d.files++;
      cur = d;
    }
    cur.children.push({ name: parts[parts.length - 1], path: f.path, weight: w, files: 1, children: [], file: i });
  });
  const sort = (n: TreeNode) => {
    n.children.sort((x, y) => y.weight - x.weight || (x.path < y.path ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

/** The node at a directory path, or null. */
export function findNode(root: TreeNode, path: string): TreeNode | null {
  if (!path) return root;
  let cur: TreeNode | undefined = root;
  const parts = path.split('/');
  for (let k = 0; k < parts.length && cur; k++) {
    const p = parts.slice(0, k + 1).join('/');
    cur = cur.children.find((c) => c.path === p && c.file === undefined);
  }
  return cur ?? null;
}

/** Where to start: skip directories that only wrap a single directory (e.g. `src/` in most repos). */
export function startNode(root: TreeNode): TreeNode {
  let cur = root;
  while (cur.children.length === 1 && cur.children[0].file === undefined && cur.children[0].children.length > 0) cur = cur.children[0];
  return cur;
}

/** Ancestors of a directory path from the root, for a breadcrumb: '' → 'src' → 'src/a'. */
export function crumbs(path: string): string[] {
  if (!path) return [''];
  const parts = path.split('/');
  return ['', ...parts.map((_, k) => parts.slice(0, k + 1).join('/'))];
}

function worst(row: number[], side: number): number {
  let s = 0;
  let max = 0;
  let min = Infinity;
  for (const a of row) {
    s += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = s * s;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

function layoutRow(row: number[], r: Rect, out: Rect[]): Rect {
  const s = row.reduce((t, a) => t + a, 0);
  if (r.w >= r.h) {
    // a column along the left edge
    const cw = r.h > 0 ? s / r.h : 0;
    let y = r.y;
    for (const a of row) {
      const h = cw > 0 ? a / cw : 0;
      out.push({ x: r.x, y, w: cw, h });
      y += h;
    }
    return { x: r.x + cw, y: r.y, w: Math.max(0, r.w - cw), h: r.h };
  }
  const rh = r.w > 0 ? s / r.w : 0;
  let x = r.x;
  for (const a of row) {
    const w = rh > 0 ? a / rh : 0;
    out.push({ x, y: r.y, w, h: rh });
    x += w;
  }
  return { x: r.x, y: r.y + rh, w: r.w, h: Math.max(0, r.h - rh) };
}

/** Rectangles for `weights` (largest first) filling `r`, with aspect ratios kept close to 1. */
export function squarify(weights: number[], r: Rect): Rect[] {
  const total = weights.reduce((t, w) => t + w, 0);
  if (total <= 0 || r.w <= 0 || r.h <= 0) return weights.map(() => ({ x: r.x, y: r.y, w: 0, h: 0 }));
  const scale = (r.w * r.h) / total;
  const areas = weights.map((w) => w * scale);
  const out: Rect[] = [];
  let rect = { ...r };
  let row: number[] = [];
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(rect.w, rect.h);
    const a = areas[i];
    if (row.length === 0 || worst([...row, a], side) <= worst(row, side)) {
      row.push(a);
      i++;
    } else {
      rect = layoutRow(row, rect, out);
      row = [];
    }
  }
  if (row.length) layoutRow(row, rect, out);
  return out;
}

/** Cells for the children of `node` (and, with depth 2, their children inside them). Parents come before children. */
export function treemap(node: TreeNode, w: number, h: number, opts: TreemapOptions = {}): Cell[] {
  const maxDepth = opts.depth ?? 2;
  const maxCells = opts.maxCells ?? 5000;
  const minArea = opts.minArea ?? 36;
  const header = opts.header ?? 18;
  const pad = opts.pad ?? 3;
  const out: Cell[] = [];

  const place = (parent: TreeNode, r: Rect, depth: number) => {
    const kids = parent.children;
    if (kids.length === 0 || r.w <= 0 || r.h <= 0) return;
    const total = kids.reduce((t, k) => t + k.weight, 0) || 1;
    const area = r.w * r.h;
    const budget = Math.max(1, maxCells - out.length);
    // keep the largest siblings while they are big enough to see and the cell budget allows
    let keep = 0;
    while (keep < kids.length && keep < budget - 1 && (kids[keep].weight / total) * area >= minArea) keep++;
    if (keep === kids.length - 1) keep = kids.length <= budget ? kids.length : keep; // folding one cell into "other" gains nothing
    if (keep === 0) keep = Math.min(1, kids.length);
    const shown = kids.slice(0, keep);
    const rest = kids.slice(keep);
    const weights = shown.map((k) => k.weight);
    const restWeight = rest.reduce((t, k) => t + k.weight, 0);
    if (rest.length) weights.push(restWeight);
    const rects = squarify(weights, r);
    shown.forEach((k, i) => {
      const isDir = k.file === undefined;
      out.push({ ...rects[i], path: k.path, name: k.name, kind: isDir ? 'dir' : 'file', depth, weight: k.weight, files: k.files, file: k.file });
    });
    if (rest.length) {
      out.push({ ...rects[rects.length - 1], path: `${parent.path}\u0000other`, name: `${rest.length} more`, kind: 'other', depth, weight: restWeight, files: rest.reduce((t, k) => t + k.files, 0), folded: rest.length });
    }
    if (depth >= maxDepth) return;
    shown.forEach((k, i) => {
      const c = rects[i];
      if (k.file !== undefined || out.length >= maxCells) return;
      const inner = { x: c.x + pad, y: c.y + header, w: c.w - 2 * pad, h: c.h - header - pad };
      if (inner.w < 8 || inner.h < 8) return;
      place(k, inner, depth + 1);
    });
  };
  place(node, { x: 0, y: 0, w, h }, 1);
  return out;
}
