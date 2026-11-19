// U3: layout maths behind the new visualisations (src/core/viz), against planted truth.
import { beforeAll, describe, expect, it } from 'vitest';
import { nodeEnv } from '../../src/core/node-env';
import { runPipeline } from '../../src/core/pipeline';
import { defaultStages } from '../../src/core/stages';
import type { Analysis } from '../../src/core/types';
import { authorWeeks, commitCalendar } from '../../src/core/viz/calendar';
import { erLayout } from '../../src/core/viz/er';
import { buildDsm } from '../../src/core/viz/matrix';
import { importPath } from '../../src/core/viz/path';
import { PIPELINE_STEPS, stepOf } from '../../src/core/viz/progress';
import { circleLayout, radialLayout } from '../../src/core/viz/radial';
import { hotspotScatter, quantile } from '../../src/core/viz/scatter';
import { crumbs, fileTree, findNode, squarify, startNode, treemap, type Rect } from '../../src/core/viz/treemap';
import { gitHistoryFiles } from '../git-fixture';
import { analyzeFixture, groundTruth } from '../helpers';

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const inside = (a: Rect, r: Rect) => a.x >= r.x - 1e-6 && a.y >= r.y - 1e-6 && a.x + a.w <= r.x + r.w + 1e-6 && a.y + a.h <= r.y + r.h + 1e-6;

describe('treemap', () => {
  it('squarify fills the rectangle exactly, without overlaps, proportionally to the weights', () => {
    const r = { x: 0, y: 0, w: 600, h: 400 };
    const weights = [60, 60, 40, 30, 20, 20, 10, 6, 3, 1];
    const rects = squarify(weights, r);
    const total = weights.reduce((s, w) => s + w, 0);
    expect(rects.reduce((s, c) => s + c.w * c.h, 0)).toBeCloseTo(r.w * r.h, 3);
    rects.forEach((c, i) => {
      expect(inside(c, r)).toBe(true);
      expect(c.w * c.h).toBeCloseTo((weights[i] / total) * r.w * r.h, 3);
      for (let j = i + 1; j < rects.length; j++) expect(overlap(c, rects[j])).toBe(false);
    });
    // squarified: the big cells stay close to square
    expect(Math.max(rects[0].w / rects[0].h, rects[0].h / rects[0].w)).toBeLessThan(2.5);
  });

  it('builds the directory tree with aggregated lines and a breadcrumb', () => {
    const root = fileTree([{ path: 'src/a/x.ts', loc: 10 }, { path: 'src/a/y.ts', loc: 30 }, { path: 'src/b.ts', loc: 0 }]);
    expect(root.weight).toBe(41); // empty files count as 1 line
    expect(root.files).toBe(3);
    expect(startNode(root).path).toBe('src');
    expect(findNode(root, 'src/a')!.weight).toBe(40);
    expect(findNode(root, 'src/a')!.children.map((c) => c.name)).toEqual(['y.ts', 'x.ts']);
    expect(findNode(root, 'src/b.ts')).toBeNull(); // files are not drill targets
    expect(crumbs('src/a')).toEqual(['', 'src', 'src/a']);
  });

  it('caps the number of cells and folds the rest into "other"', () => {
    // 8 000 siblings with no minimum size: the cell budget alone forces folding
    const flat = treemap(fileTree(Array.from({ length: 8000 }, (_, i) => ({ path: `f${i}.ts`, loc: 10 }))), 1000, 600, { maxCells: 5000, minArea: 0 });
    expect(flat).toHaveLength(5000);
    expect(flat.at(-1)).toMatchObject({ kind: 'other', folded: 3001 });
    const files = Array.from({ length: 20_000 }, (_, i) => ({ path: `pkg${i % 40}/mod${i % 7}/f${i}.ts`, loc: 1 + (i % 50) }));
    const cells = treemap(fileTree(files), 1000, 600, { maxCells: 5000 });
    expect(cells.length).toBeLessThanOrEqual(5000);
    const top = cells.filter((c) => c.depth === 1);
    expect(top.reduce((s, c) => s + c.w * c.h, 0)).toBeCloseTo(600_000, 0);
    // nested cells stay inside their parent
    for (const c of cells.filter((x) => x.depth === 2)) {
      const parent = top.find((p) => p.kind === 'dir' && c.path.startsWith(p.path + '/'));
      expect(parent && inside(c, parent)).toBe(true);
    }
  });

  it('lays out a real project: express-mongoose', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const root = fileTree(a.files);
    const cells = treemap(root, 800, 400);
    const files = cells.filter((c) => c.kind === 'file');
    expect(new Set(files.map((c) => c.path)).size).toBe(files.length);
    for (const c of files) expect(a.files[c.file!].path).toBe(c.path);
    expect(cells.find((c) => c.path === 'src' && c.depth === 1)?.kind).toBe('dir');
  });
});

describe('dependency matrix', () => {
  const truth = groundTruth('express-mongoose').u3;
  let a: Analysis;
  beforeAll(async () => {
    a = (await analyzeFixture('express-mongoose')).analysis;
  });

  it('uses single files for a small project and shows the cycle as a symmetric pair', () => {
    const dsm = buildDsm(a);
    expect(dsm.level).toBe(truth.dsmLevel);
    const idx = (p: string) => dsm.modules.findIndex((m) => m.id === p);
    const [u, o] = truth.dsmCyclePair.map(idx);
    expect(u).toBeGreaterThanOrEqual(0);
    const uo = dsm.cells.find((c) => c.row === u && c.col === o);
    const ou = dsm.cells.find((c) => c.row === o && c.col === u);
    expect(uo?.cycle).toBe(true);
    expect(ou?.cycle).toBe(true);
    // the cycle pair sits next to each other
    expect(Math.abs(u - o)).toBe(1);
    expect(uo!.edges[0]).toMatchObject({ from: truth.dsmCyclePair[0], to: truth.dsmCyclePair[1] });
  });

  it('orders importers before what they import (every non-cycle cell is above the diagonal)', () => {
    const dsm = buildDsm(a);
    const off = dsm.cells.filter((c) => c.row !== c.col && !c.cycle);
    expect(off.length).toBeGreaterThan(10);
    for (const c of off) expect(c.row).toBeLessThan(c.col);
    expect(dsm.cells.filter((c) => c.cycle).length).toBe(2);
  });

  it('marks the layering violation cell', () => {
    const dsm = buildDsm(a);
    const idx = (p: string) => dsm.modules.findIndex((m) => m.id === p);
    const [r, c] = truth.dsmViolationCell.map(idx);
    expect(dsm.cells.find((x) => x.row === r && x.col === c)?.violation).toBe(true);
    expect(dsm.cells.filter((x) => x.violation).length).toBeGreaterThanOrEqual(1);
  });

  it('groups by directory when there are too many files', () => {
    // src/ (app, server, config) + 7 sub-folders = 8 modules at depth 2
    const dsm = buildDsm(a, { maxModules: 8 });
    expect(dsm.level).toBe(2);
    expect(dsm.modules).toHaveLength(8);
    expect(buildDsm(a, { maxModules: 7 }).level).toBe(1);
    // services → services is now the diagonal; the cycle is inside one module
    const services = dsm.modules.findIndex((m) => m.id === 'src/services');
    expect(services).toBeGreaterThanOrEqual(0);
    expect(dsm.cells.find((c) => c.row === services && c.col === services)!.count).toBeGreaterThanOrEqual(2);
    const total = dsm.cells.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(buildDsm(a).cells.reduce((s, c) => s + c.count, 0));
  });
});

describe('import path finder', () => {
  const truth = groundTruth('express-mongoose').u3;
  it('finds the shortest import path, in either direction', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const p = importPath(a, truth.importPath.from, truth.importPath.to)!;
    expect(p.direction).toBe('forward');
    expect(p.files).toEqual(truth.importPath.files);
    expect(p.edges).toHaveLength(truth.importPath.files.length - 1);
    expect(p.edges.every((e) => e.line > 0)).toBe(true);
    const r = importPath(a, truth.reversePath.from, truth.reversePath.to)!;
    expect(r.direction).toBe('reverse');
    expect(r.files[0]).toBe(truth.reversePath.to);
    expect(r.files[r.files.length - 1]).toBe(truth.reversePath.from);
    expect(importPath(a, truth.noPath[0], truth.noPath[1])).toBeNull();
  });
});

describe('history visuals (git-history)', () => {
  const truth = groundTruth('git-history');
  let a: Analysis;
  beforeAll(async () => {
    a = (await runPipeline({ kind: 'memory', files: await gitHistoryFiles() }, 'git-history', {}, nodeEnv({ l2: false }))).analysis;
  }, 120_000);

  it('calendar: one cell per commit day, aligned to weeks', () => {
    const cal = commitCalendar(a.git!.commits.map((c) => c.time));
    expect(cal.activeDays).toBe(truth.u3.calendarActiveDays);
    expect(cal.total).toBe(truth.u3.calendarTotal);
    expect(cal.days.find((d) => d.count > 0)!.date).toBe(truth.u3.calendarFirstDay);
    expect(cal.days[0].weekday).toBe(0);
    expect(cal.days.reduce((s, d) => s + d.count, 0)).toBe(12);
    const strips = authorWeeks(a.git!.commits, cal);
    expect(strips.map((s) => s.author)).toEqual(truth.u3.authorsByCommits);
    expect(strips.reduce((s, x) => s + x.total, 0)).toBe(12);
  });

  it('hotspot map: the risky quadrant holds the planted hotspots', () => {
    const s = hotspotScatter(a);
    expect(s.x).toBe('churn');
    for (const f of truth.u3.riskyIncludes) expect(s.risky).toContain(f);
    for (const f of truth.u3.riskyExcludes) expect(s.risky).not.toContain(f);
    for (const p of s.points) expect(p.risky).toBe(p.x >= s.xCut && p.y >= s.yCut);
  });
});

describe('calendar time zones and bounds', () => {
  it('buckets by the given offset, not by UTC', () => {
    const t = Date.UTC(2026, 2, 1, 23, 30); // Sunday 23:30 UTC
    expect(commitCalendar([t]).end).toBe('2026-03-01');
    expect(commitCalendar([t], { tzOffsetMin: -60 }).end).toBe('2026-03-02'); // UTC+1: already Monday
    expect(commitCalendar([t], { tzOffsetMin: -60 }).days.at(-1)!.weekday).toBe(1);
  });
  it('shows at most maxWeeks and counts what was clipped', () => {
    const day = 86_400_000;
    const times = Array.from({ length: 800 }, (_, i) => Date.UTC(2024, 0, 1) + i * day);
    const cal = commitCalendar(times, { maxWeeks: 53 });
    expect(cal.weeks).toBe(53);
    expect(cal.total + cal.clipped).toBe(800);
    expect(commitCalendar([])).toMatchObject({ days: [], total: 0 });
  });
});

describe('hotspot map without history', () => {
  it('falls back to fan-in', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const s = hotspotScatter(a);
    expect(s.x).toBe('fan-in');
    expect(s.points.length).toBeGreaterThan(5);
    expect(s.points.every((p) => !a.files.find((f) => f.path === p.file)!.test)).toBe(true);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });
});

describe('radial and ER layouts', () => {
  it('rings: items sit on their ring radius, capped per ring', () => {
    const { rings, items } = radialLayout([['a', 'b'], Array.from({ length: 200 }, (_, i) => `f${i}`)], { maxPerRing: 50 });
    expect(rings).toEqual([{ ring: 1, radius: 0.5, count: 2, shown: 2 }, { ring: 2, radius: 1, count: 200, shown: 50 }]);
    for (const it of items) expect(Math.hypot(it.x, it.y)).toBeCloseTo(it.ring / 2, 6);
    const c = circleLayout(['b', 'a', 'c']);
    expect(c.get('a')).toEqual({ x: expect.closeTo(0, 6), y: -1 });
  });

  it('ER: cards do not overlap, related entities are neighbours, lines end on card edges', async () => {
    const { analysis: a } = await analyzeFixture('nestjs-prisma');
    const er = erLayout(a.schema);
    expect(er.boxes).toHaveLength(a.schema.entities.length);
    for (let i = 0; i < er.boxes.length; i++) for (let j = i + 1; j < er.boxes.length; j++) expect(overlap(er.boxes[i], er.boxes[j])).toBe(false);
    for (const l of er.lines) {
      const from = er.boxes.find((b) => b.name === l.from)!;
      const onEdge = Math.abs(l.x1 - from.x) < 1e-6 || Math.abs(l.x1 - from.x - from.w) < 1e-6 || Math.abs(l.y1 - from.y) < 1e-6 || Math.abs(l.y1 - from.y - from.h) < 1e-6;
      expect(onEdge).toBe(true);
    }
    const { analysis: e } = await analyzeFixture('express-mongoose');
    const truth = groundTruth('express-mongoose').u3;
    const exp = erLayout(e.schema);
    const names = exp.boxes.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(truth.erRelated));
    expect(Math.abs(names.indexOf(truth.erRelated[0]) - names.indexOf(truth.erRelated[1]))).toBe(1);
    expect(exp.lines.some((l) => l.from === 'Order' && l.to === 'User')).toBe(true);
  });
});

describe('progress stepper', () => {
  it('every pipeline stage maps to a step, in pipeline order', () => {
    const steps = defaultStages({ runL2: async () => ({}) as never }).map((s) => stepOf(s.name));
    expect(steps.every((s) => s >= 2 && s < PIPELINE_STEPS.length)).toBe(true);
    expect([...steps].sort((x, y) => x - y)).toEqual(steps);
    expect(stepOf('Reading files')).toBe(0);
    expect(stepOf('Parsing')).toBe(1);
    expect(stepOf('Done')).toBe(PIPELINE_STEPS.length);
  });
});
