import { useMemo, useState } from 'react';
import type { ElementDefinition } from 'cytoscape';
import { modelOf } from '../core/model';
import { langName } from '../core/orientation';
import type { Analysis } from '../core/types';
import { fmtNum } from '../core/util';
import { useStore } from '../store/store';
import { Graph } from './Graph';
import { Badge, Card, ConfBadge, Empty, FileLink, Page } from './kit';
import { References } from './SearchView';

/** Template explanation of a single file from its definitions, imports and metrics. */
export function explainFile(a: Analysis, fi: number): string {
  const m = modelOf(a);
  const f = a.files[fi];
  const syms = m.symsByFile[fi].map((i) => a.symbols[i]);
  const fns = syms.filter((s) => s.kind === 'function' || s.kind === 'method');
  const types = syms.filter((s) => ['class', 'interface', 'type', 'enum', 'struct', 'trait'].includes(s.kind));
  const parts: string[] = [`${f.path} is a ${langName(f.lang)} file of ${fmtNum(f.loc)} lines.`];
  if (types.length) parts.push(`It declares ${types.length} type(s): ${types.slice(0, 6).map((t) => t.name).join(', ')}${types.length > 6 ? '…' : ''}.`);
  if (fns.length) {
    const top = [...fns].sort((x, y) => y.complexity - x.complexity)[0];
    parts.push(`It defines ${fns.length} function(s)/method(s); the most complex is ${top.parent ? top.parent + '.' : ''}${top.name} (cyclomatic complexity ${top.complexity}, nesting depth ${top.nesting}, ${top.endLine - top.line + 1} lines).`);
  } else parts.push(f.level === 0 ? 'No parser is available for this language, so only text-level facts are shown.' : 'It defines no functions.');
  const imports = a.imports.filter((e) => e.from === fi);
  const pkgs = [...new Set(imports.filter((e) => e.pkg).map((e) => e.pkg!))];
  if (pkgs.length) parts.push(`It uses ${pkgs.length} external module(s): ${pkgs.slice(0, 8).join(', ')}${pkgs.length > 8 ? '…' : ''}.`);
  const internal = a.refs.filter((r) => r.file === fi && a.symbols[r.to].file === fi && r.kind === 'call').length;
  if (internal) parts.push(`There are ${internal} internal call(s) between its own functions.`);
  const exported = syms.filter((s) => s.exported).length;
  if (exported) parts.push(`${exported} definition(s) are exported.`);
  return parts.join(' ');
}

export function SymbolsView() {
  const a = useStore((s) => s.analysis)!;
  const m = useMemo(() => modelOf(a), [a, a.symbols.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [refSym, setRefSym] = useState<number | null>(null);
  const setTab = useStore((s) => s.setTab);
  const fileMode = a.mode === 'file';
  const [sort, setSort] = useState<'complexity' | 'lines' | 'nesting'>('complexity');
  const fns = useMemo(() => a.symbols.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'function' || x.s.kind === 'method'), [a, a.symbols.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => [...fns].sort((x, y) => sort === 'complexity' ? y.s.complexity - x.s.complexity : sort === 'nesting' ? y.s.nesting - x.s.nesting : (y.s.endLine - y.s.line) - (x.s.endLine - x.s.line)).slice(0, 300), [fns, sort]);

  const callGraph = useMemo<ElementDefinition[]>(() => {
    if (!fileMode || a.files.length === 0) return [];
    const ids = new Set<number>();
    const edges: ElementDefinition[] = [];
    const seen = new Set<string>();
    for (const r of a.refs) {
      if (r.from < 0 || (r.kind !== 'call' && r.kind !== 'new') || r.from === r.to) continue;
      const key = `${r.from}>${r.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.add(r.from);
      ids.add(r.to);
      edges.push({ data: { id: key, source: 's' + r.from, target: 's' + r.to, conf: r.conf, count: 1, label: '' } });
    }
    return [...[...ids].map((i) => ({ data: { id: 's' + i, label: m.symLabel(i), kind: 'file' } })), ...edges];
  }, [a, fileMode, m]);

  if (a.symbols.length === 0) {
    return <Page title={fileMode ? 'File' : 'Symbols'}><Empty>{a.stage === 'done' ? 'No definitions were extracted (no parser for these languages, or the files define none).' : 'Definitions are still being extracted…'}</Empty></Page>;
  }
  return (
    <Page title={fileMode ? 'File' : 'Symbols & complexity'} intro={fileMode ? undefined : 'Every function and method with its cyclomatic complexity and nesting depth. Click a name to jump to its definition.'}>
      {fileMode && <Card title="Explanation (template-generated)"><p data-testid="file-explanation">{explainFile(a, 0)}</p></Card>}
      {refSym !== null && <Card title="Find references" right={<button className="btn" onClick={() => setRefSym(null)}>Close</button>}><References a={a} sym={refSym} /></Card>}
      {fileMode && (
        <Card title="Internal call graph">
          {callGraph.length === 0 ? <div className="muted">No calls between this file’s own functions were found.</div> : <div className="h-80"><Graph elements={callGraph} layout="breadthfirst" testId="call-graph" /></div>}
        </Card>
      )}
      <Card title={`Functions (${fmtNum(fns.length)})`} right={
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="complexity">Sort by complexity</option><option value="lines">Sort by length</option><option value="nesting">Sort by nesting</option>
        </select>}>
        <table className="tbl" data-testid="functions">
          <thead><tr><th>Function</th><th>Location</th><th>Complexity</th><th>Nesting</th><th>Lines</th><th>Params</th><th>Layer</th><th></th></tr></thead>
          <tbody>
            {sorted.map(({ s, i }) => (
              <tr key={i}>
                <td className="mono font-semibold">{m.symLabel(i)}{s.exported && <> <Badge>exported</Badge></>}</td>
                <td><FileLink file={m.path(s.file)} line={s.line} endLine={s.endLine} /></td>
                <td>{s.complexity}</td><td>{s.nesting}</td><td>{s.endLine - s.line + 1}</td><td>{s.params}</td>
                <td><ConfBadge c={a.files[s.file].level === 2 ? 'resolved' : 'heuristic'} /></td>
                <td className="whitespace-nowrap"><button className="btn" onClick={() => setRefSym(i)}>References</button>{!fileMode && <> <button className="btn" onClick={() => setTab('impact', { symbol: i })}>Impact</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fns.length > 300 && <p className="mt-2 text-xs faint">Showing the top 300 of {fmtNum(fns.length)}.</p>}
      </Card>
    </Page>
  );
}
