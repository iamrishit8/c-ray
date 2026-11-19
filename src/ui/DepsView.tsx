import { useMemo, useState } from 'react';
import { ROLE_LABEL } from '../core/roles';
import { fmtNum } from '../core/util';
import { useStore } from '../store/store';
import { Badge, Card, ConfBadge, Empty, FileLink, Page, Pending, RiskBar, RoleBadge, Stat } from './kit';
import { Matrix } from './viz/Matrix';

type Sort = 'fanIn' | 'fanOut' | 'instability';

export function DepsView() {
  const a = useStore((s) => s.analysis)!;
  const setTab = useStore((s) => s.setTab);
  const [sort, setSort] = useState<Sort>('fanIn');
  const [pkgFilter, setPkgFilter] = useState('');
  const [openPkg, setOpenPkg] = useState<string | null>(null);
  const d = a.deps;
  const metrics = useMemo(() => [...d.metrics].sort((x, y) => y[sort] - x[sort] || y.fanIn + y.fanOut - (x.fanIn + x.fanOut)).slice(0, 60), [d.metrics, sort]);
  const pkgs = useMemo(() => d.packages.filter((p) => !pkgFilter || p.name.toLowerCase().includes(pkgFilter.toLowerCase())), [d.packages, pkgFilter]);
  const internal = a.imports.filter((e) => e.to >= 0).length;
  if (a.stage !== 'done' && d.metrics.length === 0) return <Page title="Dependencies"><Pending what="Dependency analysis" /></Page>;
  const undeclared = d.packages.filter((p) => !p.declared && p.uses.length > 0);
  return (
    <Page title="Dependencies" intro="Internal module graph metrics, circular dependencies, layering violations and which files use which external packages. Heuristic edges (non-TypeScript/JavaScript code) can produce false positives, so treat these as signals to review.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Internal imports" value={fmtNum(internal)} sub={`${fmtNum(a.imports.filter((e) => e.to >= 0 && e.conf === 'resolved').length)} resolved`} />
        <Stat label="Circular paths" value={<span className={d.cycles.length ? 'text-[var(--bad)]' : ''}>{d.cycles.length}</span>} sub={d.cycles.length ? 'import loops to untangle' : 'none found'} />
        <Stat label="Layering violations" value={<span className={d.violations.length ? 'text-[var(--warn)]' : ''}>{d.violations.length}</span>} sub={d.violations.length ? 'layers skipped' : 'none found'} />
        <Stat label="God modules" value={d.godModules.length} />
        <Stat label="External packages" value={d.packages.filter((p) => p.uses.length).length} sub={undeclared.length ? `${undeclared.length} not declared` : undefined} />
      </div>

      <Matrix a={a} />

      <Card title={`Circular dependencies (${d.cycles.length})`} right={<span className="text-xs faint">type-only imports are ignored</span>}>
        {d.cycles.length === 0 ? <div className="muted">No circular import paths were found.</div> : (
          <div className="space-y-3" data-testid="cycles">
            {d.cycles.slice(0, 80).map((c, i) => (
              <div key={i} className="rounded-[var(--r-md)] border border-[var(--line)] px-3.5 py-3">
                <div className="label mb-1.5">Cycle {i + 1} · {c.files.length} files</div>
                {c.edges.length === 0 ? <div className="text-xs muted">{c.files.join(' , ')} (large strongly-connected group; individual paths not enumerated)</div> : (
                  <ol className="space-y-0.5 text-[13px]">
                    {c.edges.map((e, k) => (
                      <li key={k} className="flex flex-wrap items-center gap-1.5">
                        <FileLink file={e.from} line={e.line} /> <span className="faint">imports</span> <FileLink file={e.to} /> {e.conf !== 'resolved' && <ConfBadge c={e.conf} />}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
            {d.cycles.length > 80 && <div className="text-xs faint">Showing 80 of {d.cycles.length}.</div>}
          </div>
        )}
      </Card>

      <Card title={`Layering violations (${d.violations.length})`}>
        {d.violations.length === 0 ? <div className="muted">No layering violations were detected with the inferred roles.</div> : (
          <table className="tbl" data-testid="violations">
            <thead><tr><th>Location</th><th>From → to</th><th>What</th><th>Confidence</th></tr></thead>
            <tbody>
              {d.violations.slice(0, 200).map((v, i) => (
                <tr key={i}>
                  <td><FileLink file={v.file} line={v.line} /></td>
                  <td className="whitespace-nowrap"><RoleBadge role={v.fromRole}>{ROLE_LABEL[v.fromRole].split(' ')[0]}</RoleBadge> <span className="faint">→</span> {v.toRole === 'db' ? <Badge tone="warn">database</Badge> : <RoleBadge role={v.toRole}>{ROLE_LABEL[v.toRole].split(' ')[0]}</RoleBadge>}</td>
                  <td className="muted">{v.detail}</td>
                  <td><ConfBadge c={v.conf} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {d.godModules.length > 0 && (
        <Card title={`God modules (${d.godModules.length})`}>
          <table className="tbl" data-testid="god-modules">
            <thead><tr><th>File</th><th>Why</th><th></th></tr></thead>
            <tbody>{d.godModules.map((g) => <tr key={g.file}><td><FileLink file={g.file} /></td><td className="muted">{g.reasons.join(' · ')}</td><td><button className="btn" onClick={() => setTab('impact', { file: g.file })}>Impact</button></td></tr>)}</tbody>
          </table>
        </Card>
      )}

      <Card title="Coupling metrics" right={
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="fanIn">Most depended-on (fan-in)</option><option value="fanOut">Most dependencies (fan-out)</option><option value="instability">Most unstable</option>
        </select>}>
        <p className="mb-2 text-xs muted">Fan-in = files that import this file. Fan-out = files it imports. Instability = fan-out ÷ (fan-in + fan-out): 0 is stable (many dependents, few dependencies), 1 is unstable.</p>
        <table className="tbl" data-testid="metrics">
          <thead><tr><th>File</th><th>Role</th><th className="num">Fan-in</th><th className="num">Fan-out</th><th>Instability</th></tr></thead>
          <tbody>
            {metrics.map((m) => {
              const role = a.files.find((f) => f.path === m.file)?.role;
              return (
                <tr key={m.file}><td><FileLink file={m.file} /></td><td>{role && <RoleBadge role={role}>{role}</RoleBadge>}</td><td className="num">{m.fanIn}</td><td className="num">{m.fanOut}</td><td><RiskBar value={m.instability} label={m.instability.toFixed(2)} tone="accent" width={64} /></td></tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title={`External packages (${d.packages.length})`} right={<input className="input" placeholder="filter packages…  ( / )" value={pkgFilter} onChange={(e) => setPkgFilter(e.target.value)} data-search-focus aria-label="Filter packages" />}>
        {d.packages.length === 0 ? <Empty>No external package imports were found.</Empty> : (
          <table className="tbl" data-testid="packages">
            <thead><tr><th>Package</th><th>Version</th><th>Declared</th><th>Used in</th></tr></thead>
            <tbody>
              {pkgs.slice(0, 300).map((p) => (
                <tr key={p.name}>
                  <td className="mono font-medium">{p.name}</td>
                  <td className="mono muted">{p.version ?? ''}</td>
                  <td>{/^[a-z]+:/.test(p.name) ? <Badge>standard library</Badge> : p.declared ? (p.manifest ? <FileLink file={p.manifest} label="yes" className="!font-sans" /> : 'yes') : <Badge tone="warn" title="Imported but not matched to a manifest entry. Exact for package.json; fuzzy for other ecosystems.">not in a manifest</Badge>}</td>
                  <td>
                    {p.uses.length === 0 ? <Badge tone="warn" title="Declared in package.json but never imported by analysed code (may still be used by tooling or scripts).">no imports found</Badge> : (
                      <>
                        <button className="link" onClick={() => setOpenPkg(openPkg === p.name ? null : p.name)}>{new Set(p.uses.map((u) => u.file)).size} file(s)</button>
                        {openPkg === p.name && <ul className="mt-1 space-y-0.5 text-xs">{p.uses.slice(0, 80).map((u, i) => <li key={i}><FileLink file={u.file} line={u.line} /></li>)}</ul>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
