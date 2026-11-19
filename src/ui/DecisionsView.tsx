// Decisions view (M10): the architectural decisions the codebase appears to embody, plus the team's own
// decision records. Each shows its evidence, why it appears built that way, and how it holds up here.
import { useMemo, useState } from 'react';
import { CATEGORY_ORDER, type Claim, type Decision, type DecisionCategory } from '../core/types';
import { useStore } from '../store/store';
import { Badge, Card, Chip, ConfBadge, Empty, FileLink, InlineCode, Page, Pending, Stat, listKeys, type Tone } from './kit';

const SEE: Partial<Record<DecisionCategory, { tab: string; label: string }>> = {
  Architecture: { tab: 'deps', label: 'Dependencies' }, Data: { tab: 'data', label: 'Data' }, API: { tab: 'flows', label: 'Flows' },
  Security: { tab: 'health', label: 'Health' }, Operations: { tab: 'health', label: 'Health' }, Quality: { tab: 'health', label: 'Health' },
};
const STATUS_TONE = (s?: string): Tone => (/accept|approv|adopt|decided/i.test(s ?? '') ? 'ok' : /supersed|deprecat|reject|obsolete|withdrawn/i.test(s ?? '') ? 'bad' : 'warn');

function ClaimRow({ c }: { c: Claim }) {
  return (
    <li className="flex flex-wrap items-start gap-x-2 gap-y-1">
      <ConfBadge c={c.conf} />
      <span className="min-w-0 flex-1"><InlineCode text={c.text} />{c.file && <> <FileLink file={c.file} line={c.line} /></>}</span>
    </li>
  );
}

function Detail({ d }: { d: Decision }) {
  const setTab = useStore((s) => s.setTab);
  const see = SEE[d.category];
  return (
    <div className="space-y-4" data-testid="decision-detail" data-decision={d.id}>
      <Card
        title={<span className="flex flex-wrap items-center gap-2"><span>{d.title}</span><ConfBadge c={d.conf} /><Badge>{d.category}</Badge>{d.adr && <Badge tone={STATUS_TONE(d.adr.status)} title="Status written in the decision record">{d.adr.status ?? 'no status'}</Badge>}{d.adr?.date && <span className="text-xs faint">{d.adr.date}</span>}</span>}
        right={see ? <button className="btn" onClick={() => setTab(see.tab)}>Open {see.label}</button> : undefined}
      >
        <p className="text-[14.5px] leading-relaxed" data-testid="decision-text"><InlineCode text={d.decision} /></p>
        <p className="mt-2 text-xs faint">{d.source === 'adr' ? 'Written down by the team in a decision record (resolved).' : d.conf === 'resolved' ? 'Declared in a manifest, config or code; read directly (resolved).' : d.conf === 'heuristic' ? 'Inferred from structure and names: likely, not certain (heuristic).' : 'imex could not determine this (unresolved).'}</p>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Evidence" testId="decision-evidence">
          {d.evidence.length === 0 ? <p className="muted">No single file shows this; it follows from the project as a whole.</p> : (
            <ul className="space-y-2 text-[13px]">
              {d.evidence.map((e, i) => (
                <li key={i}>
                  <div className="flex flex-wrap items-baseline gap-x-2"><Badge title={`Evidence from ${e.kind}`}>{e.kind}</Badge>{e.file ? <FileLink file={e.file} line={e.line} /> : null}</div>
                  <div className="mt-0.5 muted"><InlineCode text={e.note} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Why it appears built this way" testId="decision-why">
          {d.why ? (
            <ul className="space-y-2 text-[13px]"><ClaimRow c={d.why} /></ul>
          ) : <p className="muted">The repository does not say why. Nothing is guessed here; the trade-offs below are general knowledge about this kind of choice.</p>}
          {d.why?.conf === 'resolved' && <p className="mt-2 text-xs faint">{d.source === 'adr' ? 'The decision record’s own context.' : 'A sentence from the project’s docs.'}</p>}
        </Card>
      </div>
      <Card title="How it holds up in this project" testId="decision-observed" right={<span className="text-xs faint">counted from this analysis</span>}>
        {d.observed.length === 0 ? <p className="muted">Nothing in this analysis confirms or contradicts the decision.</p> : <ul className="space-y-2.5 text-[13px]">{d.observed.map((o, i) => <ClaimRow key={i} c={o} />)}</ul>}
      </Card>
      {d.tradeoffs.length > 0 && (
        <Card title={d.source === 'adr' ? 'Consequences (from the record)' : 'Typical trade-offs'} testId="decision-tradeoffs" right={<span className="text-xs faint">{d.source === 'adr' ? 'the team’s words' : 'general knowledge, not measured here'}</span>}>
          <ul className="list-disc space-y-1.5 pl-5 text-[13px]">{d.tradeoffs.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

export function DecisionsView() {
  const a = useStore((s) => s.analysis)!;
  const [cat, setCat] = useState<DecisionCategory | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const shown = useMemo(() => a.decisions.filter((d) => !cat || d.category === cat), [a.decisions, cat]);
  const counts = useMemo(() => new Map(CATEGORY_ORDER.map((c) => [c, a.decisions.filter((d) => d.category === c).length])), [a.decisions]);
  if (a.version < 2) return <Page title="Decisions"><Empty title="This project was analysed before decisions existed">Re-analyse it from Home (stored projects → Re-analyse) to generate the decisions and the onboarding guide.</Empty></Page>;
  if (a.stage !== 'done' && a.decisions.length === 0) return <Page title="Decisions"><Pending what="The decision analysis" /></Page>;
  const current = shown.find((d) => d.id === sel) ?? shown[0] ?? null;
  const adrs = a.decisions.filter((d) => d.source === 'adr').length;
  const unresolved = a.decisions.filter((d) => d.conf === 'unresolved').length;
  return (
    <Page title="Decisions" intro="The architectural choices this codebase appears to embody (framework, data access, authentication, testing, deployment…) and the decision records the team wrote. Each one shows its evidence and how sure imex is; the reasons come from the project’s own docs, never from guesses.">
      {a.decisions.length === 0 ? (
        <Empty title="No decisions could be inferred">There was not enough to go on: no manifests, frameworks, configuration or decision records were recognised.</Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Decisions" value={a.decisions.length} sub={`${a.decisions.filter((d) => d.conf === 'resolved').length} read directly (resolved)`} />
            <Stat label="From the team’s records" value={adrs} sub={adrs ? 'decision records (ADRs)' : 'no ADR folder found'} />
            <Stat label="Could not determine" value={unresolved} sub={unresolved ? 'worth confirming with a teammate' : 'nothing left open'} />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category" data-testid="decision-filters">
            <Chip on={cat === null} onClick={() => setCat(null)} testId="decision-cat-all">All · {a.decisions.length}</Chip>
            {CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => <Chip key={c} on={cat === c} onClick={() => setCat(c)} testId={`decision-cat-${c}`}>{c} · {counts.get(c)}</Chip>)}
          </div>
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <Card title="Decisions">
              <ul className="space-y-0.5 text-[13px]" data-testid="decision-list" aria-label="Decisions (use arrow keys)" onKeyDown={listKeys(shown.map((d) => d.id), current?.id ?? null, setSel)}>
                {shown.map((d) => (
                  <li key={d.id}>
                    <button data-key={d.id} data-testid="decision-item" aria-current={current?.id === d.id ? 'true' : undefined} className={`w-full rounded-[var(--r-sm)] px-2.5 py-2 text-left ${current?.id === d.id ? 'is-selected' : 'hover:bg-[var(--bg3)]'}`} onClick={() => setSel(d.id)}>
                      <span className="flex items-center justify-between gap-2"><span className="font-medium">{d.title}</span><span className={`text-[11px] ${d.conf === 'unresolved' ? 'text-[var(--warn)]' : 'faint'}`}>{d.conf}</span></span>
                      <span className={`mt-0.5 block truncate text-xs ${current?.id === d.id ? '' : 'faint'}`}>{d.decision.replace(/`/g, '')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {current ? <Detail d={current} /> : <Empty>Select a decision to see its evidence.</Empty>}
          </div>
        </>
      )}
    </Page>
  );
}
