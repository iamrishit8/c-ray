import { useEffect, useMemo, useState } from 'react';
import { analyzeImpact, type ImpactTarget } from '../core/impact';
import { modelOf } from '../core/model';
import { groupBy } from '../core/util';
import { useStore } from '../store/store';
import { Badge, Card, ConfBadge, Empty, FileLink, Page, PathText, RiskBar } from './kit';
import { BlastRadius } from './viz/BlastRadius';

const LEVEL_TONE = { low: 'ok', medium: 'warn', high: 'bad', 'very high': 'bad' } as const;

export function ImpactView() {
  const a = useStore((s) => s.analysis)!;
  const focus = useStore((s) => s.focus);
  const setTab = useStore((s) => s.setTab);
  const m = useMemo(() => modelOf(a), [a, a.symbols.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<ImpactTarget | null>(focus?.file ? { file: focus.file } : focus?.symbol !== undefined ? { symbol: focus.symbol } : null);
  useEffect(() => {
    if (focus?.file) setTarget({ file: focus.file });
    else if (focus?.symbol !== undefined) setTarget({ symbol: focus.symbol });
  }, [focus]);

  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return { files: [], syms: [] };
    const files = a.files.filter((f) => f.path.toLowerCase().includes(s)).slice(0, 12);
    const syms: number[] = [];
    for (let i = 0; i < a.symbols.length && syms.length < 15; i++) if (a.symbols[i].name.toLowerCase().includes(s)) syms.push(i);
    syms.sort((x, y) => a.symbols[x].name.length - a.symbols[y].name.length);
    return { files, syms };
  }, [q, a]);
  const impact = useMemo(() => (target ? analyzeImpact(a, target) : null), [a, target]);
  const byDist = useMemo(() => (impact ? [...groupBy(impact.files.filter((f) => !f.test), (f) => f.distance)].sort((x, y) => x[0] - y[0]) : []), [impact]);

  return (
    <Page title="Impact analysis" intro="Pick a file or a symbol to see everything that depends on it (transitively), which entry points and tests are affected, and a risk score with its factors.">
      <div className="relative max-w-2xl">
        <input data-testid="impact-input" data-search-focus className="input w-full !py-2" placeholder="Type a file path or symbol name…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} aria-label="File or symbol to analyse" />
        {(suggestions.files.length > 0 || suggestions.syms.length > 0) && (
          <div className="card absolute z-10 mt-1 max-h-80 w-full overflow-auto py-1 !shadow-[var(--shadow-md)]" data-testid="impact-suggestions">
            {suggestions.syms.map((i) => (
              <button key={'s' + i} className="block w-full px-3 py-1 text-left text-[13px] hover:bg-[var(--bg3)]" onClick={() => { setTarget({ symbol: i }); setQ(''); }}>
                <Badge>{a.symbols[i].kind}</Badge> <span className="mono font-semibold">{m.symLabel(i)}</span> <span className="faint">{m.path(a.symbols[i].file)}:{a.symbols[i].line}</span>
              </button>
            ))}
            {suggestions.files.map((f) => (
              <button key={'f' + f.path} className="block w-full px-3 py-1 text-left text-[13px] hover:bg-[var(--bg3)]" onClick={() => { setTarget({ file: f.path }); setQ(''); }}>
                <Badge>file</Badge> <span className="mono">{f.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!impact ? <Empty title="Nothing selected yet">Search for a file or symbol above. The System map, Dependencies and History views also have an “Impact” button on files.</Empty> : (
        <>
          <Card title={`Impact of ${impact.label}`}>
            <div className="flex flex-wrap items-center gap-6" data-testid="impact-risk">
              <div>
                <div className="label">Risk score</div>
                <div className="tnum mt-1 text-[34px] font-medium leading-none tracking-[-0.04em]">{impact.risk.score}<span className="text-base faint">/100</span> <Badge tone={LEVEL_TONE[impact.risk.level]}>{impact.risk.level}</Badge></div>
                <div className="mt-2"><RiskBar value={impact.risk.score / 100} width={180} /></div>
              </div>
              <ul className="list-disc pl-5 text-[13px] muted">
                {impact.risk.factors.map((f, i) => <li key={i}>+{f.points} — {f.label}</li>)}
                {impact.risk.factors.length === 0 && <li>nothing depends on it</li>}
              </ul>
            </div>
            <p className="mt-3 text-xs muted">
              The score is a transparent heuristic (dependents, entry points, complexity, test coverage by dependency), not a prediction.
              {impact.heuristic ? ' Some dependents were found through heuristic edges: the real set may be larger or smaller.' : impact.kind === 'symbol' ? ' All dependents were resolved by the TypeScript compiler.' : ''}
            </p>
          </Card>
          <BlastRadius impact={impact} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Dependent files (${impact.files.filter((f) => !f.test).length})`}>
              {byDist.length === 0 ? <div className="muted">No other analysed file depends on this.</div> : (
                <div className="space-y-3" data-testid="impact-files">
                  {byDist.map(([dist, files]) => (
                    <div key={dist}>
                      <div className="label mb-1.5">{dist === 1 ? 'Direct dependents' : `${dist} steps away`} <span className="tnum">({files.length})</span></div>
                      <ul className="space-y-0.5 text-[13px]">
                        {files.slice(0, 80).map((f) => (
                          <li key={f.file} className="flex flex-wrap items-center gap-1.5">
                            <FileLink file={f.file} line={f.sites[0]} label={<PathText path={f.file} />} />
                            {f.sites.length > 0 && <span className="faint text-xs">line{f.sites.length > 1 ? 's' : ''} {f.sites.slice(0, 6).sort((x, y) => x - y).join(', ')}</span>}
                            {f.conf !== 'resolved' && <ConfBadge c={f.conf} />}
                          </li>
                        ))}
                        {files.length > 80 && <li className="faint text-xs">… {files.length - 80} more</li>}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <div className="space-y-4">
              <Card title={`Affected entry points (${impact.entries.length})`}>
                {impact.entries.length === 0 ? <div className="muted">No detected route, job or main reaches this.</div> : (
                  <ul className="space-y-0.5 text-[13px]" data-testid="impact-entries">
                    {impact.entries.slice(0, 60).map((e) => (
                      <li key={e.id} className="flex items-center gap-1.5"><Badge>{e.kind}</Badge><button className="link mono" onClick={() => setTab('flows', { entry: e.id })}>{e.label}</button></li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={`Affected tests (${impact.tests.length})`}>
                {impact.tests.length === 0 ? <div className="muted">No test file depends on this (directly or transitively).</div> : (
                  <ul className="space-y-0.5 text-[13px]" data-testid="impact-tests">{impact.tests.slice(0, 60).map((t) => <li key={t}><FileLink file={t} /></li>)}</ul>
                )}
              </Card>
              {impact.symbols.length > 0 && (
                <Card title={`Affected functions (${impact.symbols.length})`}>
                  <ul className="max-h-64 space-y-0.5 overflow-auto text-[13px]">
                    {impact.symbols.slice(0, 120).map((s) => (
                      <li key={s.sym} className="flex items-center gap-1.5"><span className="w-4 text-right faint">{s.distance}</span><FileLink file={m.path(a.symbols[s.sym].file)} line={a.symbols[s.sym].line} label={m.symLabel(s.sym)} />{s.conf !== 'resolved' && <ConfBadge c={s.conf} />}</li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
