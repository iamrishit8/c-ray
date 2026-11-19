// Onboarding view (M10): a first-week checklist, a reading path, how to run the project, and a glossary of
// its own vocabulary, all generated from the analysis. Commands copied from the repo are `resolved`;
// conventional ones are `heuristic`; nothing is run, fetched or sent anywhere.
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { ChecklistItem, GlossaryTerm, OnboardingStep, RunCommand, RunInfo } from '../core/types';
import { useStore } from '../store/store';
import { Badge, Card, ConfBadge, Empty, FileLink, InlineCode, Page, Pending, RiskBar, capped } from './kit';

const WHEN = ['Day 1', 'Days 2–3', 'Days 4–5'];
const KIND_TONE: Record<RunCommand['kind'], 'accent' | 'ok' | 'warn' | 'plain'> = { install: 'plain', run: 'accent', test: 'ok', build: 'warn', docker: 'plain', other: 'plain' };

/** Ticked items are a per-viewer convenience, so they live in localStorage; the page works without it. */
function useTicks(projectId: string): [Set<string>, (id: string) => void] {
  const key = `imex-onboarding-${projectId}`;
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setTicks(new Set(JSON.parse(localStorage.getItem(key) ?? '[]')));
    } catch {
      setTicks(new Set()); // storage blocked or corrupt: start unticked
    }
  }, [key]);
  const toggle = (id: string) => {
    const next = new Set(ticks);
    if (!next.delete(id)) next.add(id);
    setTicks(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      /* private window or quota: the tick still shows for this visit */
    }
  };
  return [ticks, toggle];
}

function Checklist({ items, projectId }: { items: ChecklistItem[]; projectId: string }) {
  const setTab = useStore((s) => s.setTab);
  const [ticks, toggle] = useTicks(projectId);
  const done = items.filter((i) => ticks.has(i.id)).length;
  return (
    <Card title="First-week checklist" testId="onboarding-checklist" right={<span className="flex items-center gap-2 text-xs faint"><span className="tnum" data-testid="checklist-progress">{done} of {items.length} done</span><RiskBar value={items.length ? done / items.length : 0} tone="ok" width={64} /></span>}>
      <div className="space-y-5">
        {WHEN.map((w) => {
          const group = items.filter((i) => i.when === w);
          if (!group.length) return null;
          return (
            <section key={w} aria-label={w}>
              <div className="label mb-2">{w}</div>
              <ul className="space-y-2.5">
                {group.map((i) => (
                  <li key={i.id} className="flex items-start gap-3" data-testid={`check-${i.id}`}>
                    <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={ticks.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Done: ${i.text}`} />
                    <div className="min-w-0 flex-1">
                      <div className={ticks.has(i.id) ? 'muted line-through' : 'font-medium'}>{i.text}</div>
                      {i.detail && <div className="text-[13px] muted"><InlineCode text={i.detail} /></div>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        <ConfBadge c={i.conf} />
                        {i.file && <FileLink file={i.file} line={i.line} />}
                        {i.tab && <button className="link" onClick={() => setTab(i.tab!, i.focus)}>Open in imex</button>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function ReadingPath({ steps }: { steps: OnboardingStep[] }) {
  return (
    <Card title="Reading path" testId="onboarding-path" right={<span className="text-xs faint">in this order</span>}>
      <p className="mb-4 text-[13px] muted">Steps built from your own docs, manifests and schema are exact; the ranking of core files is inferred. The core step skips files already listed above it.</p>
      <ol className="space-y-5">
        {steps.map((s, i) => (
          <li key={s.id} data-testid={`path-${s.id}`} className="flex gap-3">
            <span aria-hidden="true" className="tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg3)] text-xs font-medium">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium">{s.title}</h3>
              <p className="text-xs faint">{s.why}</p>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {s.files.map((f) => (
                  <li key={f.file} className="flex flex-wrap items-baseline gap-x-2"><FileLink file={f.file} line={f.line} /><span className="muted">{f.note}</span><ConfBadge c={f.conf} /></li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="btn btn-icon" aria-label={`Copy command: ${text}`} title="Copy" onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }, () => { /* clipboard blocked: the command is selectable text */ });
    }}>{ok ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
  );
}

function HowToRun({ run }: { run: RunInfo }) {
  const empty = run.commands.length === 0 && run.env.length === 0 && run.prerequisites.length === 0;
  return (
    <Card title="How to run it" testId="onboarding-run">
      {empty ? <Empty title="No run instructions found">No manifest scripts, Dockerfile, Makefile or README commands were recognised. Ask a teammate, then write the steps down.</Empty> : (
        <div className="space-y-5">
          {run.prerequisites.length > 0 && (
            <section>
              <div className="label mb-1.5">You need</div>
              <ul className="space-y-1.5 text-[13px]">{run.prerequisites.map((p, i) => <li key={i} className="flex flex-wrap items-baseline gap-2"><span>{p.text}</span><ConfBadge c={p.conf} />{p.file && <FileLink file={p.file} line={p.line} />}</li>)}</ul>
            </section>
          )}
          {run.commands.length > 0 && (
            <section>
              <div className="label mb-1.5">Commands</div>
              <p className="mb-2 text-xs faint"><b>resolved</b> = copied from a file in the repo; <b>heuristic</b> = the usual command for this kind of project. imex never runs anything.</p>
              <table className="tbl" data-testid="run-commands">
                <thead><tr><th>Step</th><th>Command</th><th>Source</th><th /></tr></thead>
                <tbody>
                  {run.commands.map((c, i) => (
                    <tr key={i} data-testid="run-command">
                      <td><Badge tone={KIND_TONE[c.kind]}>{c.kind}</Badge></td>
                      <td><code className="mono [overflow-wrap:anywhere]">{c.cwd ? `cd ${c.cwd} && ` : ''}{c.command}</code><div className="text-xs faint">{c.label}</div></td>
                      <td className="whitespace-nowrap"><ConfBadge c={c.conf} /> <FileLink file={c.file} line={c.line} /></td>
                      <td><CopyButton text={`${c.cwd ? `cd ${c.cwd} && ` : ''}${c.command}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {run.env.length > 0 && (
            <section>
              <div className="label mb-1.5">Environment variables</div>
              <p className="mb-2 text-xs faint">Example values come from template files only (such as <code className="mono">.env.example</code>). Values in a real <code className="mono">.env</code> are never copied.</p>
              <table className="tbl" data-testid="run-env">
                <thead><tr><th>Name</th><th>Example</th><th>Declared in</th></tr></thead>
                <tbody>{run.env.map((e) => <tr key={e.name}><td className="mono font-medium">{e.name}</td><td className="mono muted">{e.example ?? '—'}</td><td><FileLink file={e.file} line={e.line} /></td></tr>)}</tbody>
              </table>
            </section>
          )}
          {run.ports.length > 0 && <p className="text-[13px]"><span className="label mr-2">Ports</span>{run.ports.map((p) => <span key={p.port} className="mr-3"><span className="mono">{p.port}</span> <FileLink file={p.file} line={p.line} /></span>)}</p>}
        </div>
      )}
    </Card>
  );
}

const KIND_LABEL: Record<GlossaryTerm['kind'], string> = { entity: 'data entity', route: 'in URLs', symbol: 'in code' };

function Glossary({ terms }: { terms: GlossaryTerm[] }) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(20);
  const rows = useMemo(() => terms.filter((t) => !q || (t.term + ' ' + t.meaning).toLowerCase().includes(q.toLowerCase())), [terms, q]);
  const { rows: shown, more } = capped(rows, limit);
  return (
    <Card title={`Glossary (${terms.length})`} testId="onboarding-glossary" right={<input className="input" placeholder="filter terms…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter glossary" data-search-focus />}>
      <p className="mb-3 text-[13px] muted">The project’s own vocabulary: data entities first (read from the schema), then nouns in URLs and words that recur in class and file names. Plumbing words such as “service” or “controller” are left out.</p>
      {terms.length === 0 ? <Empty title="No domain terms found">There are no entities, routes or repeated names to build a glossary from.</Empty> : rows.length === 0 ? <div className="muted">No term matches.</div> : (
        <table className="tbl">
          <thead><tr><th>Term</th><th>Meaning</th><th className="num">Files</th><th>Source</th></tr></thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.kind + t.term} data-testid="glossary-term" data-term={t.term}>
                <td className="whitespace-nowrap"><span className="font-medium">{t.term}</span><div><Badge>{KIND_LABEL[t.kind]}</Badge></div></td>
                <td className="muted">{t.meaning}</td>
                <td className="num">{t.count}</td>
                <td><ConfBadge c={t.conf} /> <FileLink file={t.file} line={t.line} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more > 0 && <button className="link mt-2 text-[13px]" onClick={() => setLimit(limit + 40)}>Show more ({more} hidden)</button>}
    </Card>
  );
}

export function OnboardingView() {
  const a = useStore((s) => s.analysis)!;
  const o = a.onboarding;
  if (a.version < 2 || (!o && a.stage === 'done')) return <Page title="Onboarding"><Empty title="This project was analysed before the onboarding guide existed">Re-analyse it from Home (stored projects → Re-analyse) to generate it.</Empty></Page>;
  if (!o) return <Page title="Onboarding"><Pending what="The onboarding guide" /></Page>;
  return (
    <Page title="Onboarding" intro="A guide for someone new to this codebase, generated from the analysis: a checklist for the first week, the order to read the code in, how to run it, and the project’s vocabulary. Facts taken from the repo are exact; the ranking and the pacing are inferred.">
      <div data-testid="onboarding-view" className="space-y-5">
        <Checklist items={o.checklist} projectId={a.projectId} />
        <ReadingPath steps={o.path} />
        <HowToRun run={o.run} />
        <Glossary terms={o.glossary} />
      </div>
    </Page>
  );
}
