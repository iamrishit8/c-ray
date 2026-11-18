import { useEffect, useMemo, useState } from 'react';
import type { ElementDefinition } from 'cytoscape';
import { traceFlow, type FlowStep } from '../core/flow';
import type { EntryPoint } from '../core/types';
import { groupBy } from '../core/util';
import { useStore } from '../store/store';
import { Graph } from './Graph';
import { Badge, Card, ConfBadge, Empty, FileLink, Page } from './kit';

const KIND_TONE: Record<FlowStep['kind'], 'plain' | 'accent' | 'ok' | 'warn' | 'bad'> = {
  entry: 'accent', middleware: 'warn', handler: 'accent', call: 'plain', db: 'ok', http: 'warn', queue: 'warn', unresolved: 'bad',
};
const KIND_LABEL: Record<FlowStep['kind'], string> = {
  entry: 'entry', middleware: 'middleware', handler: 'handler', call: 'call', db: 'data access', http: 'external call', queue: 'message', unresolved: 'unresolved',
};

export function FlowView() {
  const a = useStore((s) => s.analysis)!;
  const focus = useStore((s) => s.focus);
  const [selected, setSelected] = useState<string | null>(focus?.entry ?? null);
  const [filter, setFilter] = useState('');
  const [depth, setDepth] = useState(8);
  const [showGraph, setShowGraph] = useState(true);
  useEffect(() => { if (focus?.entry) setSelected(focus.entry); }, [focus]);

  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return a.entries.filter((e) => !q || e.label.toLowerCase().includes(q) || e.file.toLowerCase().includes(q));
  }, [a.entries, filter]);
  const groups = useMemo(() => groupBy(entries, (e) => e.kind), [entries]);
  const current = selected && a.entries.some((e) => e.id === selected) ? selected : entries[0]?.id ?? null;
  const flow = useMemo(() => (current ? traceFlow(a, current, { maxDepth: depth }) : null), [a, current, depth]);
  const route = flow?.entry.routeId ? a.routes.find((r) => r.id === flow.entry.routeId) : undefined;

  const elements = useMemo<ElementDefinition[]>(() => {
    if (!flow) return [];
    const steps = flow.steps.slice(0, 120);
    return [
      ...steps.map((s) => ({ data: { id: 'n' + s.id, label: s.label.length > 46 ? s.label.slice(0, 44) + '…' : s.label, sub: `${s.file.split('/').slice(-1)[0]}:${s.line}`, kind: 'file', tone: s.kind === 'unresolved' ? 'bad' : s.kind === 'db' || s.kind === 'http' || s.kind === 'queue' ? 'warn' : s.kind === 'entry' || s.kind === 'handler' ? 'accent' : undefined } })),
      ...steps.filter((s) => s.parent >= 0).map((s) => ({ data: { id: `e${s.id}`, source: 'n' + s.parent, target: 'n' + s.id, conf: s.conf, count: 1, label: '' } })),
    ];
  }, [flow]);

  if (a.entries.length === 0) {
    return <Page title="Flows"><Empty>{a.stage === 'l0' ? 'Entry points are still being detected…' : 'No entry points (routes, mains, jobs, event handlers) were detected in this project.'}</Empty></Page>;
  }
  const kindOrder: EntryPoint['kind'][] = ['route', 'page', 'main', 'cli', 'job', 'event'];
  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-[var(--line)]">
        <div className="border-b border-[var(--line)] p-2">
          <input className="input w-full" placeholder={`Filter ${a.entries.length} entry points…`} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="entry-filter" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto" data-testid="entry-list">
          {kindOrder.filter((k) => groups.has(k)).map((k) => (
            <div key={k}>
              <div className="sticky top-0 bg-[var(--bg2)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide faint">{k === 'route' ? 'HTTP routes' : k === 'page' ? 'Pages' : k === 'main' ? 'Program entry' : k === 'cli' ? 'CLI' : k === 'job' ? 'Background jobs' : 'Event handlers'} · {groups.get(k)!.length}</div>
              {groups.get(k)!.slice(0, 400).map((e) => (
                <button key={e.id} onClick={() => setSelected(e.id)} className={`block w-full px-3 py-1 text-left text-[12.5px] ${e.id === current ? 'is-selected' : 'hover:bg-[var(--bg3)]'}`}>
                  <span className="mono">{e.label}</span>
                  <span className={`block truncate text-[11px] ${e.id === current ? '' : 'faint'}`}>{e.file}:{e.line}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-5">
        {!flow ? <Empty>Select an entry point.</Empty> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="mono text-lg font-semibold" data-testid="flow-title">{flow.entry.label}</h1>
              <ConfBadge c={flow.entry.conf} />
              {flow.entry.framework && <Badge>{flow.entry.framework}</Badge>}
              <label className="ml-auto flex items-center gap-1 text-[13px]">Depth
                <select className="input" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>{[2, 4, 6, 8, 12].map((d) => <option key={d} value={d}>{d}</option>)}</select>
              </label>
              <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={showGraph} onChange={(e) => setShowGraph(e.target.checked)} />graph</label>
            </div>
            {route && (
              <div className="text-[13px] muted">
                Declared at <FileLink file={route.file} line={route.line} />
                {route.params.length > 0 && <> · path params: {route.params.map((p) => <code key={p} className="mr-1">{p}</code>)}</>}
                {route.middleware.length > 0 && <> · middleware: {route.middleware.map((m) => m.name).join(' → ')}</>}
              </div>
            )}
            <Card title={`Steps (${flow.steps.length})`} right={<span className="text-xs faint">ordered by execution; indent = call depth</span>}>
              <ol className="space-y-1" data-testid="flow-steps">
                {flow.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-[13px]" style={{ paddingLeft: s.depth * 18 }} data-kind={s.kind}>
                    <span className="w-6 shrink-0 text-right faint">{s.id + 1}</span>
                    <Badge tone={KIND_TONE[s.kind]}>{KIND_LABEL[s.kind]}</Badge>
                    <div className="min-w-0">
                      <span className={s.kind === 'call' || s.kind === 'handler' || s.kind === 'middleware' ? 'mono font-semibold' : ''}>{s.label}</span>{' '}
                      {s.role && s.role !== 'unknown' && s.kind !== 'entry' && <Badge>{s.role}</Badge>}{' '}
                      <ConfBadge c={s.conf} />
                      <div className="text-xs">
                        <FileLink file={s.file} line={s.line} endLine={s.endLine} />
                        {s.via && <span className="faint"> — called from <FileLink file={s.via.file} line={s.via.line} /></span>}
                        {s.note && <span className="faint"> — {s.note}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              {flow.truncated && <p className="mt-2 text-xs text-[var(--warn)]">The trace was cut at the depth/step limit; increase the depth to see more.</p>}
              {flow.steps.length <= 1 && <p className="mt-2 text-[13px] muted">No outgoing calls could be followed from this entry point (they may be dynamic, or target code outside the analysed files).</p>}
            </Card>
            {showGraph && flow.steps.length > 1 && (
              <Card title="Flow graph" right={flow.steps.length > 120 ? <span className="text-xs faint">first 120 steps</span> : undefined}>
                <div className="h-[420px]"><Graph elements={elements} layout="elk" testId="flow-graph" /></div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
