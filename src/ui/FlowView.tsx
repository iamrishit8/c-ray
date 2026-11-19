import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { ElementDefinition } from 'cytoscape';
import { traceFlow, type FlowStep } from '../core/flow';
import type { EntryPoint } from '../core/types';
import { groupBy } from '../core/util';
import { useStore } from '../store/store';
import { Graph } from './Graph';
import { Badge, Card, Chip, ConfBadge, Empty, FileLink, Page, PageHeader, RoleBadge, listKeys } from './kit';

const KIND_TONE: Record<FlowStep['kind'], 'plain' | 'accent' | 'ok' | 'warn' | 'bad'> = {
  entry: 'accent', middleware: 'warn', handler: 'accent', call: 'plain', db: 'ok', http: 'warn', queue: 'warn', unresolved: 'bad',
};
const KIND_LABEL: Record<FlowStep['kind'], string> = {
  entry: 'entry', middleware: 'middleware', handler: 'handler', call: 'call', db: 'data access', http: 'external call', queue: 'message', unresolved: 'unresolved',
};

const FLOW_LEGEND = [
  { label: 'Entry / handler', color: 'var(--accent)' },
  { label: 'Data / external / message', color: 'var(--warn)' },
  { label: 'Unresolved step', color: 'var(--bad)', dashed: true },
];

export function FlowView() {
  const a = useStore((s) => s.analysis)!;
  const focus = useStore((s) => s.focus);
  const [selected, setSelected] = useState<string | null>(focus?.entry ?? null);
  const [filter, setFilter] = useState('');
  const [depth, setDepth] = useState(8);
  const [showGraph, setShowGraph] = useState(true);
  useEffect(() => { if (focus?.entry) setSelected(focus.entry); }, [focus]);
  // playback: -1 = not started; otherwise the index of the active step
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const listRef = useRef<HTMLOListElement>(null);

  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return a.entries.filter((e) => !q || e.label.toLowerCase().includes(q) || e.file.toLowerCase().includes(q));
  }, [a.entries, filter]);
  const groups = useMemo(() => groupBy(entries, (e) => e.kind), [entries]);
  const current = selected && a.entries.some((e) => e.id === selected) ? selected : entries[0]?.id ?? null;
  const flow = useMemo(() => (current ? traceFlow(a, current, { maxDepth: depth }) : null), [a, current, depth]);
  useEffect(() => {
    setStep(-1);
    setPlaying(false);
  }, [flow]);
  const last = (flow?.steps.length ?? 0) - 1;
  const stepMs = 1100 / speed;
  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((k) => k + 1), step < 0 ? 0 : stepMs);
    return () => clearTimeout(t);
  }, [playing, step, last, stepMs]);
  useEffect(() => {
    if (step < 0) return;
    listRef.current?.querySelector(`[data-step="${step}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [step]);
  const play = () => {
    if (step >= last) setStep(-1);
    setPlaying(!playing || step >= last);
  };
  const highlight = useMemo(() => {
    if (!flow || step < 0) return null;
    const shown = flow.steps.slice(0, Math.min(step + 1, 120));
    const cur = flow.steps[step];
    return {
      nodes: shown.map((x) => 'n' + x.id),
      edges: shown.filter((x) => x.parent >= 0).map((x) => 'e' + x.id),
      current: step < 120 ? 'n' + cur.id : undefined,
      edge: cur.parent >= 0 && step < 120 ? 'e' + cur.id : undefined,
    };
  }, [flow, step]);
  const travel = useMemo(() => (flow && step > 0 && step < 120 && flow.steps[step].parent >= 0 ? { edge: 'e' + flow.steps[step].id, key: step, ms: stepMs } : null), [flow, step, stepMs]);
  const route = flow?.entry.routeId ? a.routes.find((r) => r.id === flow.entry.routeId) : undefined;

  const elements = useMemo<ElementDefinition[]>(() => {
    if (!flow) return [];
    const steps = flow.steps.slice(0, 120);
    return [
      ...steps.map((s) => ({ data: {
        id: 'n' + s.id, label: s.label.length > 46 ? s.label.slice(0, 44) + '…' : s.label, sub: `${s.file.split('/').slice(-1)[0]}:${s.line}`, kind: 'file',
        role: s.kind === 'unresolved' ? undefined : s.role, conf: s.kind === 'unresolved' ? 'unresolved' : undefined,
        tone: s.kind === 'unresolved' ? 'bad' : s.kind === 'db' || s.kind === 'http' || s.kind === 'queue' ? 'warn' : s.kind === 'entry' || s.kind === 'handler' ? 'accent' : undefined,
      } })),
      ...steps.filter((s) => s.parent >= 0).map((s) => ({ data: { id: `e${s.id}`, source: 'n' + s.parent, target: 'n' + s.id, conf: s.conf, count: 1, label: '' } })),
    ];
  }, [flow]);

  if (a.entries.length === 0) {
    return <Page title="Flows" intro="Request and execution flows traced from each entry point."><Empty title="No entry points yet">{a.stage === 'l0' ? 'Entry points are still being detected…' : 'No entry points (routes, mains, jobs, event handlers) were detected in this project.'}</Empty></Page>;
  }
  const kindOrder: EntryPoint['kind'][] = ['route', 'page', 'main', 'cli', 'job', 'event'];
  const visibleIds = kindOrder.filter((k) => groups.has(k)).flatMap((k) => groups.get(k)!.slice(0, 400).map((e) => e.id));
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--line)] px-5 pb-4 pt-5 md:px-8">
        <PageHeader title="Request flows" intro="Pick an entry point to follow what runs when it is hit: middleware, handlers, calls and data access, in order. Each step links to its source and shows how sure the trace is." />
      </div>
      <div className="flex min-h-0 flex-1">
      <div className="flex w-80 shrink-0 flex-col border-r border-[var(--line)] max-[900px]:w-60">
        <div className="border-b border-[var(--line)] p-3">
          <input className="input w-full" placeholder={`Filter ${a.entries.length} entry points…  ( / )`} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="entry-filter" data-search-focus aria-label="Filter entry points" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1" data-testid="entry-list" onKeyDown={listKeys(visibleIds, current, setSelected)} aria-label="Entry points (use arrow keys)">
          {kindOrder.filter((k) => groups.has(k)).map((k) => (
            <div key={k}>
              <div className="label sticky top-0 z-[1] bg-[var(--bg)] px-4 pb-1 pt-2.5">{k === 'route' ? 'HTTP routes' : k === 'page' ? 'Pages' : k === 'main' ? 'Program entry' : k === 'cli' ? 'CLI' : k === 'job' ? 'Background jobs' : 'Event handlers'} · {groups.get(k)!.length}</div>
              {groups.get(k)!.slice(0, 400).map((e) => (
                <button key={e.id} data-key={e.id} onClick={() => setSelected(e.id)} aria-current={e.id === current ? 'true' : undefined} className={`mx-2 block w-[calc(100%-16px)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-left text-[12.5px] ${e.id === current ? 'is-selected' : 'hover:bg-[var(--bg3)]'}`}>
                  <span className="mono">{e.label}</span>
                  <span className={`block truncate text-[11px] font-normal ${e.id === current ? '' : 'faint'}`}>{e.file}:{e.line}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto px-5 py-6 md:px-8">
        {!flow ? <Empty>Select an entry point.</Empty> : (
          <div className="mx-auto max-w-[1100px] space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mono text-[20px] font-medium tracking-[-0.03em]" data-testid="flow-title">{flow.entry.label}</h2>
              <ConfBadge c={flow.entry.conf} />
              {flow.entry.framework && <Badge>{flow.entry.framework}</Badge>}
              <label className="ml-auto flex items-center gap-1.5 text-[13px]"><span className="label">Depth</span>
                <select className="input" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>{[2, 4, 6, 8, 12].map((d) => <option key={d} value={d}>{d}</option>)}</select>
              </label>
              <Chip on={showGraph} onClick={() => setShowGraph(!showGraph)} testId="flow-graph-toggle">graph</Chip>
            </div>
            {route && (
              <div className="text-[13px] muted">
                Declared at <FileLink file={route.file} line={route.line} />
                {route.params.length > 0 && <> · path params: {route.params.map((p) => <code key={p} className="mr-1">{p}</code>)}</>}
                {route.middleware.length > 0 && <> · middleware: {route.middleware.map((m) => m.name).join(' → ')}</>}
              </div>
            )}
            {flow.steps.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="flow-player" role="group" aria-label="Play the trace">
                <button className="btn btn-accent" onClick={play} data-testid="flow-play" aria-label={playing ? 'Pause' : 'Play the trace step by step'}>
                  {playing ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}{playing ? 'Pause' : step >= last ? 'Replay' : step >= 0 ? 'Resume' : 'Play'}
                </button>
                <button className="btn btn-icon" onClick={() => { setPlaying(false); setStep(Math.max(0, step - 1)); }} disabled={step <= 0} aria-label="Previous step" data-testid="flow-step-prev"><SkipBack aria-hidden="true" size={14} /></button>
                <button className="btn btn-icon" onClick={() => { setPlaying(false); setStep(Math.min(last, step + 1)); }} disabled={step >= last} aria-label="Next step" data-testid="flow-step-next"><SkipForward aria-hidden="true" size={14} /></button>
                <label className="flex items-center gap-1.5"><span className="label">Speed</span>
                  <select className="input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} data-testid="flow-speed">{[0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}×</option>)}</select>
                </label>
                <span className="tnum faint" data-testid="flow-step-count">{step < 0 ? `${flow.steps.length} steps` : `step ${step + 1} of ${flow.steps.length}`}</span>
                {step >= 0 && !playing && <button className="link text-[13px]" onClick={() => setStep(-1)}>reset</button>}
              </div>
            )}
            <Card title={`Steps (${flow.steps.length})`} right={<span className="text-xs faint">ordered by execution; indent = call depth</span>}>
              <ol className="space-y-1.5" data-testid="flow-steps" ref={listRef}>
                {flow.steps.map((s) => (
                  <li key={s.id} className={`flex items-start gap-2 rounded-[var(--r-sm)] text-[13px] transition-[background-color,opacity] duration-200 ${s.id === step ? 'is-selected' : step >= 0 && s.id > step ? 'opacity-45' : ''}`} style={{ paddingLeft: s.depth * 18 }} data-kind={s.kind} data-step={s.id} data-active={s.id === step || undefined}>
                    <span className="tnum w-6 shrink-0 text-right faint">{s.id + 1}</span>
                    <Badge tone={KIND_TONE[s.kind]}>{KIND_LABEL[s.kind]}</Badge>
                    <div className="min-w-0">
                      <span className={s.kind === 'call' || s.kind === 'handler' || s.kind === 'middleware' ? 'mono font-semibold' : ''}>{s.label}</span>{' '}
                      {s.role && s.role !== 'unknown' && s.kind !== 'entry' && <RoleBadge role={s.role}>{s.role}</RoleBadge>}{' '}
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
              <Card flush title="Flow graph" right={flow.steps.length > 120 ? <span className="text-xs faint">first 120 steps</span> : undefined} className="overflow-hidden">
                <div className="h-[460px]"><Graph elements={elements} layout="elk" testId="flow-graph" legend={FLOW_LEGEND} highlight={highlight} travel={travel} exportName={`${a.name}-flow`} /></div>
              </Card>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
