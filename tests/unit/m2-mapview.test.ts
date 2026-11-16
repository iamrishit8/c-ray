import { describe, expect, it } from 'vitest';
import { buildMapView, defaultExpanded, DIR_PREFIX, filesUnder } from '../../src/core/mapview';
import { emptyAnalysis } from '../../src/core/pipeline';
import { DEFAULT_OPTIONS, type Analysis } from '../../src/core/types';
import { analyzeFixture } from '../helpers';

function synthetic(dirs: number, perDir: number): Analysis {
  const a = emptyAnalysis('syn', DEFAULT_OPTIONS);
  for (let d = 0; d < dirs; d++) {
    for (let f = 0; f < perDir; f++) {
      a.files.push({ path: `src/mod${d}/sub${f % 3}/f${f}.ts`, size: 10, loc: 10, sloc: 10, lang: 'typescript', hash: 'x', role: f % 2 ? 'service' : 'util', roleConf: 'heuristic', roleSource: 'generic', level: 1, test: false, complexity: 1, maxComplexity: 1, maxNesting: 0, symbols: 1 });
    }
  }
  for (let i = 1; i < a.files.length; i++) a.imports.push({ from: i, to: i - 1, spec: './x', line: 1, conf: i % 5 ? 'resolved' : 'heuristic', kind: 'static' });
  return a;
}

describe('system map level of detail', () => {
  it('collapses directories into clusters and aggregates edges', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const v = buildMapView(a, new Set(['', 'src']));
    const ids = v.nodes.map((n) => n.id);
    expect(ids).toContain(DIR_PREFIX + 'src/services');
    expect(ids).toContain('file:src/app.js');
    expect(ids).not.toContain('file:src/services/userService.js');
    const e = v.edges.find((x) => x.source === DIR_PREFIX + 'src/controllers' && x.target === DIR_PREFIX + 'src/services');
    expect(e?.count).toBe(2);
    expect(filesUnder(a, DIR_PREFIX + 'src/services')).toHaveLength(3);
    // expanding reveals files inside a container node
    const v2 = buildMapView(a, new Set(['', 'src', 'src/services']));
    const svc = v2.nodes.find((n) => n.id === 'file:src/services/userService.js');
    expect(svc?.parent).toBe(DIR_PREFIX + 'src/services');
    expect(v2.nodes.find((n) => n.id === DIR_PREFIX + 'src/services')?.container).toBe(true);
  });

  it('small projects start fully expanded; filters drop nodes and edges', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const all = buildMapView(a, defaultExpanded(a));
    expect(all.visibleFiles).toBe(a.files.length);
    const onlyServices = buildMapView(a, defaultExpanded(a), { roles: new Set(['service']) });
    expect(onlyServices.visibleFiles).toBeGreaterThan(0);
    expect(onlyServices.nodes.filter((n) => n.kind === 'file').every((n) => n.role === 'service')).toBe(true);
    const none = buildMapView(a, defaultExpanded(a), { confs: new Set(['unresolved']) });
    expect(none.edges).toHaveLength(0);
  });

  it('never exceeds the node budget, even when everything is expanded', () => {
    const a = synthetic(60, 40); // 2400 files
    const everything = new Set<string>(['']);
    for (const f of a.files) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) everything.add(parts.slice(0, i).join('/'));
    }
    const v = buildMapView(a, everything, {}, 500);
    expect(v.nodes.length).toBeLessThanOrEqual(500);
    expect(v.collapsed.length).toBeGreaterThan(0);
    const start = buildMapView(a, defaultExpanded(a));
    expect(start.nodes.length).toBe(61); // 60 module clusters inside the "src/" container
    expect(start.edges.every((e) => e.conf === 'resolved' || e.conf === 'heuristic')).toBe(true);
    expect(start.edges.some((e) => e.conf === 'heuristic')).toBe(true);
  });
});
