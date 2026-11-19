import { useState } from 'react';
import { SKIP_LABELS } from '../core/ingest/filter';
import { CODE_LANGS } from '../core/l0/languages';
import { langName } from '../core/orientation';
import { ROLE_LABEL } from '../core/roles';
import type { Analysis, SkipReason } from '../core/types';
import { fmtBytes, fmtNum, groupBy } from '../core/util';
import { useStore } from '../store/store';
import { Badge, Card, ConfBadge, FileLink, Page, RoleBadge, Stat } from './kit';
import { Breakdown } from './viz/Breakdown';
import { Treemap } from './viz/Treemap';

export function SkippedList({ a, open = false }: { a: Analysis; open?: boolean }) {
  const [show, setShow] = useState(open);
  const [reason, setReason] = useState<SkipReason | 'all'>('all');
  if (a.skipped.length === 0) return <div className="muted">Nothing was skipped.</div>;
  const groups = groupBy(a.skipped, (s) => s.reason);
  const rows = a.skipped.filter((s) => reason === 'all' || s.reason === reason);
  return (
    <div data-testid="skipped">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px]"><b>{fmtNum(a.coverage.skipped)}</b> file(s) skipped:</span>
        {[...groups].map(([r, items]) => (
          <button key={r} className={`chip ${reason === r ? 'is-selected' : ''}`} aria-pressed={reason === r} onClick={() => { setReason(reason === r ? 'all' : r); setShow(true); }} title={SKIP_LABELS[r]}>
            {r} · {items.length}
          </button>
        ))}
        <button className="link text-[13px]" onClick={() => setShow(!show)}>{show ? 'Hide list' : 'Show list'}</button>
      </div>
      {show && (
        <div className="mt-3 max-h-72 overflow-auto rounded-[var(--r-md)] border border-[var(--line)]">
          <table className="tbl">
            <thead><tr><th>Path</th><th>Reason</th><th>Size</th></tr></thead>
            <tbody>
              {rows.slice(0, 500).map((s, i) => (
                <tr key={i}><td className="mono break-all">{s.path}</td><td>{SKIP_LABELS[s.reason]}{s.detail ? <span className="faint"> — {s.detail}</span> : null}</td><td className="whitespace-nowrap">{fmtBytes(s.size)}</td></tr>
              ))}
            </tbody>
          </table>
          {rows.length > 500 && <div className="p-2 text-center text-xs faint">Showing 500 of {fmtNum(rows.length)} rows.</div>}
        </div>
      )}
    </div>
  );
}

export function Orientation() {
  const a = useStore((s) => s.analysis)!;
  const code = a.l0.languages.filter((l) => CODE_LANGS.has(l.lang));
  const totalLoc = code.reduce((s, l) => s + l.loc, 0) || 1;
  const o = a.orientation;
  const byCat = groupBy(a.l0.tech, (t) => t.category);
  const roles = [...groupBy(a.files.filter((f) => f.role !== 'unknown'), (f) => f.role)].sort((x, y) => y[1].length - x[1].length);
  return (
    <Page title="Orientation" intro="What this codebase is, how big it is, where execution starts and what to read first. Everything inferred is labelled with its confidence and source.">
      <Card title="Summary">
        <p data-testid="summary" className="text-[14.5px] leading-[1.7]">{o.summary}</p>
        {a.notices.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-[var(--warn)]" data-testid="notices">
            {a.notices.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* with history, the sparklines show code files and lines across the architecture snapshots */}
        <Stat label="Files analysed" value={fmtNum(a.files.length)} sub={`${a.coverage.pctFiles}% of ${fmtNum(a.coverage.discovered)} discovered`} spark={a.git?.snapshots.map((s) => s.files)} />
        <Stat label="Lines of code" value={fmtNum(totalLoc)} sub={`${fmtBytes(a.files.reduce((s, f) => s + f.size, 0))} of text`} spark={a.git?.snapshots.map((s) => s.loc)} sparkColor="var(--accent)" />
        <Stat label="Definitions" value={fmtNum(a.symbols.length)} sub={`L1 ${fmtNum(a.coverage.l1Files)} files · L2 ${fmtNum(a.coverage.l2Files)} files`} />
        <Stat label="Directories" value={fmtNum(a.l0.tree.dirs)} sub={`max depth ${a.l0.tree.maxDepth}`} />
      </div>

      {a.coverage.limited && (
        <div className="card border-[var(--warn)] p-3 text-[13px] text-[var(--warn)]" data-testid="coverage-limited">
          {a.coverage.limited} Coverage: {a.coverage.pctFiles}% of files, {a.coverage.pctBytes}% of bytes.
        </div>
      )}

      {a.mode === 'project' && a.files.length > 1 && <Treemap a={a} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown a={a} />

        <Card title="Stack (from manifests and config files)">
          {a.frameworks.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="frameworks">
              <span className="faint">Detected in code:</span>
              {a.frameworks.map((f) => (
                <span key={f.id} className="flex items-center gap-1" title={f.evidence.map((e) => `${e.note} (${e.file}:${e.line})`).join('\n')}>
                  <b>{f.name}</b><ConfBadge c={f.conf} />
                </span>
              ))}
            </div>
          )}
          {a.l0.tech.length === 0 ? <div className="muted">No manifest-declared frameworks or libraries were recognised.</div> : (
            <div className="space-y-2" data-testid="stack">
              {[...byCat].map(([cat, items]) => (
                <div key={cat} className="flex gap-2 text-[13px]">
                  <span className="w-20 shrink-0 capitalize faint">{cat}</span>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {items.map((t) => (
                      <span key={t.id} title={t.evidence.map((e) => e.note).join('\n')}>
                        {t.evidence[0]?.file ? <FileLink file={t.evidence[0].file} line={t.evidence[0].line} label={t.name} className="!font-sans" /> : t.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Architecture style (inferred)" right={<Badge>guess with evidence</Badge>}>
        {o.styles.length === 0 ? <div className="muted">Not enough structure to guess an architecture style.</div> : (
          <div className="space-y-3" data-testid="styles">
            {o.styles.map((s) => (
              <div key={s.name}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <ConfBadge c={s.conf} />
                  <span className="text-xs faint">score {Math.round(s.score * 100)}%</span>
                </div>
                <ul className="mt-1 list-disc pl-5 text-[13px] muted">
                  {s.evidence.slice(0, 5).map((e, i) => (
                    <li key={i}>{e.note}{e.file && <> — <FileLink file={e.file} line={e.line} /></>}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Entry points">
          {a.entries.length === 0 ? <div className="muted">No entry points detected.</div> : (
            <table className="tbl" data-testid="entries">
              <tbody>
                {a.entries.filter((e) => e.kind !== 'route').slice(0, 25).map((e) => (
                  <tr key={e.id}><td><Badge>{e.kind}</Badge></td><td><FileLink file={e.file} line={e.line} /><div className="text-xs muted">{e.label}</div></td><td><ConfBadge c={e.conf} /></td></tr>
                ))}
                {a.routes.length > 0 && <tr><td><Badge>route</Badge></td><td colSpan={2} className="muted">{a.routes.length} route(s) — see the Flows view</td></tr>}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Read these files first" right={<span className="text-xs faint">centrality + entry proximity + size</span>}>
          <ol className="space-y-2" data-testid="read-first">
            {o.readFirst.map((r, i) => (
              <li key={r.file} className="flex gap-2 text-[13px]">
                <span className="tnum w-5 shrink-0 text-right faint">{i + 1}.</span>
                <div className="min-w-0"><FileLink file={r.file} /><div className="text-xs muted">{r.reasons.join(' · ')}</div></div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {roles.length > 0 && (
        <Card title="Roles (inferred from names, directories and framework detectors)">
          <div className="flex flex-wrap gap-2">
            {roles.map(([role, files]) => <RoleBadge key={role} role={role} title={files.slice(0, 12).map((f) => f.path).join('\n')}>{ROLE_LABEL[role]} · {files.length}</RoleBadge>)}
          </div>
        </Card>
      )}

      <Card title="Coverage and skipped files">
        <p className="mb-2 text-[13px] muted">
          {fmtNum(a.coverage.analyzed)} of {fmtNum(a.coverage.discovered)} discovered files were analysed ({a.coverage.pctFiles}% of files, {a.coverage.pctBytes}% of bytes).
          {a.reused.files > 0 && <> Incremental run: {fmtNum(a.reused.files)} unchanged file(s) were reused from the previous analysis, {fmtNum(a.reused.total - a.reused.files)} re-parsed.</>}
        </p>
        {a.l1Accuracy && (
          <p className="mb-2 text-[13px] muted" data-testid="l1-accuracy">
            Heuristic (L1) edges measured against compiler-exact (L2) edges on this project’s TypeScript/JavaScript files:
            imports {Math.round(a.l1Accuracy.imports.precision * 100)}% precision / {Math.round(a.l1Accuracy.imports.recall * 100)}% recall,
            calls {Math.round(a.l1Accuracy.calls.precision * 100)}% precision / {Math.round(a.l1Accuracy.calls.recall * 100)}% recall.
            Expect similar reliability for heuristic edges in other languages.
          </p>
        )}
        {a.files.some((f) => f.parseError) && (
          <details className="mb-2 text-[13px]" data-testid="parse-errors">
            <summary className="cursor-pointer text-[var(--warn)]">{a.files.filter((f) => f.parseError).length} file(s) could not be fully parsed (text-level results only)</summary>
            <ul className="mt-1 list-disc pl-5 muted">{a.files.filter((f) => f.parseError).slice(0, 50).map((f) => <li key={f.path}><FileLink file={f.path} /> — {f.parseError}</li>)}</ul>
          </details>
        )}
        <SkippedList a={a} />
        {a.gitMessage && !a.git && <p className="mt-3 text-[13px] muted" data-testid="git-message">History features are off: {a.gitMessage}</p>}
      </Card>
    </Page>
  );
}
