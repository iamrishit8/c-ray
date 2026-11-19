// History view (M9): churn, co-change, ownership, commit types and architecture
// time-travel, all read from the uploaded .git folder.
import { useMemo, useState } from 'react';
import { diffSnapshots } from '../core/git/diff';
import type { GitResult } from '../core/types';
import { fmtNum } from '../core/util';
import { useStore } from '../store/store';
import { Badge, Card, Chip, ConfBadge, Empty, FileLink, Page, Pending, RiskBar, Stat, capped } from './kit';
import { CommitCalendar } from './viz/Calendar';

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const pctOf = (share: number) => `${Math.round(share * 100)}%`;
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
const TYPE_LABEL: Record<string, string> = {
  feat: 'features', fix: 'fixes', refactor: 'refactors', chore: 'chores', docs: 'docs', test: 'tests', perf: 'performance',
  build: 'build', ci: 'CI', style: 'style', revert: 'reverts', merge: 'merges', other: 'other',
};

/** Commits per time bucket (12 equal slices from the oldest to the newest analysed commit), oldest first. */
function commitsOverTime(g: GitResult): number[] {
  if (g.commits.length < 2) return [];
  const t0 = g.commits[g.commits.length - 1].time;
  const span = Math.max(1, g.commits[0].time - t0);
  const bins = new Array(12).fill(0);
  for (const c of g.commits) bins[Math.min(11, Math.floor(((c.time - t0) / span) * 12))]++;
  return bins;
}

function signed(n: number) {
  return n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(-n)}` : '±0';
}

function ChurnCard({ g }: { g: GitResult }) {
  const setTab = useStore((s) => s.setTab);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(25);
  const rows = useMemo(() => g.churn.filter((c) => !q || c.file.toLowerCase().includes(q.toLowerCase())), [g.churn, q]);
  const { rows: shown, more } = capped(rows, limit);
  return (
    <Card title={`Most changed files (${g.churn.length})`} right={<span className="flex items-center gap-2"><input className="input" placeholder="filter files…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter changed files" data-search-focus /><ConfBadge c="resolved" /></span>}>
      <p className="mb-2 text-[13px] muted">Commits that touched each file that still exists (merge commits excluded). Files that change often and are complex are the riskiest to work on; see Health → Hotspots.</p>
      {rows.length === 0 ? <div className="muted">No files match.</div> : (
        <table className="tbl" data-testid="history-churn">
          <thead><tr><th>File</th><th className="num">Commits</th><th className="num">Authors</th><th>Main author</th><th>Last change</th><th /></tr></thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.file}>
                <td><FileLink file={c.file} /></td>
                <td className="num">{c.commits}</td>
                <td className="num">{c.authors}</td>
                <td>{c.topAuthor} <span className="faint tnum">{pctOf(c.topAuthorShare)}</span></td>
                <td className="tnum whitespace-nowrap muted">{day(c.lastTime)}</td>
                <td><button className="btn" onClick={() => setTab('impact', { file: c.file })}>Impact</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more > 0 && <button className="link mt-2 text-[13px]" onClick={() => setLimit(limit + 100)}>Show more ({more} hidden)</button>}
    </Card>
  );
}

function CochangeCard({ g }: { g: GitResult }) {
  const [onlyHidden, setOnlyHidden] = useState(false);
  const rows = g.cochange.filter((c) => !onlyHidden || c.linked === false);
  const hidden = g.cochange.filter((c) => c.linked === false).length;
  const { rows: shown, more } = capped(rows, 30);
  return (
    <Card title={`Files that change together (${g.cochange.length})`} right={<ConfBadge c="heuristic" />}>
      <p className="mb-2 text-[13px] muted">
        Pairs changed in the same commits. <b>Score</b> = shared commits ÷ commits of the less-changed file (1.00 = never changed apart).
        A pair with no import between them is likely <b>hidden coupling</b>: changing one usually means changing the other, and nothing in the code says so.
      </p>
      {g.cochange.length === 0 ? <div className="muted">No pair of code files changed together often enough to be meaningful.</div> : (
        <>
          <div className="mb-3 flex gap-1.5">
            <Chip on={!onlyHidden} onClick={() => setOnlyHidden(false)}>All · {g.cochange.length}</Chip>
            <Chip testId="cochange-hidden-only" on={onlyHidden} onClick={() => setOnlyHidden(true)}>Hidden coupling · {hidden}</Chip>
          </div>
          <table className="tbl" data-testid="history-cochange">
            <thead><tr><th>Files</th><th className="num">Together</th><th className="num">Score</th><th>Import between them</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.a + '\u0000' + c.b}>
                  <td><div><FileLink file={c.a} /></div><div><FileLink file={c.b} /></div></td>
                  <td className="num">{c.count}</td>
                  <td className="num"><RiskBar value={c.score} label={c.score.toFixed(2)} tone="accent" width={56} /></td>
                  <td>{c.linked === undefined ? <span className="faint">unknown (re-analyse)</span> : c.linked ? <Badge>yes</Badge> : <Badge tone="warn">no: hidden coupling</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {more > 0 && <p className="mt-2 text-xs faint">Showing {shown.length} of {rows.length}.</p>}
        </>
      )}
    </Card>
  );
}

function OwnershipCard({ g }: { g: GitResult }) {
  return (
    <Card title="Ownership" right={<ConfBadge c="heuristic" />}>
      <p className="mb-2 text-[13px] muted">Code files with 3 or more commits where one author made at least 80% of the changes. If that person leaves, nobody else has worked on them.</p>
      {g.busFactor.risky.length === 0 ? <div className="muted">No single-owner files: knowledge looks spread out.</div> : (
        <table className="tbl" data-testid="history-risky">
          <thead><tr><th>File</th><th>Owner</th><th className="num">Share</th><th className="num">Commits</th></tr></thead>
          <tbody>{g.busFactor.risky.map((r) => <tr key={r.file}><td><FileLink file={r.file} /></td><td>{r.author}</td><td className="num">{pctOf(r.share)}</td><td className="num">{r.commits}</td></tr>)}</tbody>
        </table>
      )}
      <h3 className="label mb-1 mt-5">Authors ({g.authors.length})</h3>
      <table className="tbl" data-testid="history-authors">
        <thead><tr><th>Author</th><th className="num">Commits</th><th className="num">Files touched</th></tr></thead>
        <tbody>{g.authors.slice(0, 15).map((au) => <tr key={au.email}><td>{au.name} <span className="faint">{au.email}</span></td><td className="num">{au.commits}</td><td className="num">{au.files}</td></tr>)}</tbody>
      </table>
      {g.authors.length > 15 && <p className="mt-2 text-xs faint">Showing 15 of {g.authors.length} authors.</p>}
    </Card>
  );
}

function MessagesCard({ g }: { g: GitResult }) {
  const types = Object.entries(g.messages.types).sort((x, y) => y[1] - x[1]);
  const max = Math.max(1, ...types.map((t) => t[1]));
  return (
    <Card title="What the commits were about" right={<ConfBadge c="heuristic" />}>
      <p className="mb-2 text-[13px] muted">Commit subjects classified by Conventional Commit prefix (<code className="mono">feat:</code>, <code className="mono">fix:</code>…) or, failing that, by keywords.</p>
      <div className="space-y-1" data-testid="history-types">
        {types.map(([t, n]) => (
          <div key={t} className="flex items-center gap-2 text-[13px]" data-type={t}>
            <span className="w-24 shrink-0">{TYPE_LABEL[t] ?? t}</span>
            <span className="bar" style={{ width: '60%' }}><span className="bg-[var(--accent)]" style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="tnum muted">{n}</span>
          </div>
        ))}
      </div>
      {g.messages.keywords.length > 0 && (
        <>
          <h3 className="label mb-1.5 mt-5">Frequent words in commit subjects</h3>
          <div className="flex flex-wrap gap-1.5" data-testid="history-keywords">
            {g.messages.keywords.slice(0, 24).map((k) => <Badge key={k.word}>{k.word} <span className="faint tnum">{k.count}</span></Badge>)}
          </div>
        </>
      )}
    </Card>
  );
}

/** Files moved in the analysed history. Their churn and ownership are already merged under the current name. */
function RenamesCard({ g }: { g: GitResult }) {
  const renames = g.renames ?? [];
  const [all, setAll] = useState(false);
  if (renames.length === 0) return null;
  const { rows, more } = capped(renames, all ? renames.length : 8);
  return (
    <Card title={`Renamed and moved files (${renames.length})`} right={<span className="text-xs muted">history follows the file</span>}>
      <p className="mb-2 text-[13px] muted">Churn, ownership and co-change of the old path are counted under the current name. Identical content is exact; an edited move is matched by shared lines (50% or more).</p>
      <table className="tbl" data-testid="history-renames">
        <thead><tr><th>From</th><th>To</th><th className="num">Similarity</th><th>When</th><th>Confidence</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.oid}:${r.from}`}>
              <td className="mono break-all faint">{r.from}</td>
              <td><FileLink file={r.current} label={r.to === r.current ? r.to : `${r.to} (now ${r.current})`} /></td>
              <td className="num">{Math.round(r.similarity * 100)}%</td>
              <td className="tnum whitespace-nowrap">{day(r.time)}</td>
              <td><ConfBadge c={r.conf} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <button className="link mt-2 text-[13px]" onClick={() => setAll(true)}>Show {more} more</button>}
    </Card>
  );
}

function TimeTravelCard({ g }: { g: GitResult }) {
  const snaps = g.snapshots;
  const [fromSel, setFrom] = useState(0);
  const [toSel, setTo] = useState(Math.max(0, snaps.length - 1));
  // clamp: a re-analysis can produce fewer snapshots than the stored selection
  const from = Math.min(fromSel, Math.max(0, snaps.length - 1));
  const to = Math.min(toSel, Math.max(0, snaps.length - 1));
  const d = useMemo(() => (snaps.length >= 2 ? diffSnapshots(snaps[from], snaps[to]) : null), [snaps, from, to]);
  if (snaps.length === 0) return <Card title="Architecture over time"><div className="muted">No snapshots could be taken (no code files at the sampled commits).</div></Card>;
  return (
    <Card title={`Architecture over time (${snaps.length} snapshots)`} right={<ConfBadge c="heuristic" />}>
      <p className="mb-3 text-[13px] muted">
        The code was re-analysed (heuristic L1 parsing) at HEAD, tagged releases, the oldest commit and evenly spaced commits in between.
        Pick two points to compare modules, dependencies between modules and the most complex files.
      </p>
      <ol className="mb-3 flex flex-wrap gap-1.5" data-testid="history-timeline" aria-label="Snapshots, oldest first">
        {snaps.map((s, i) => (
          <li key={s.oid}>
            <button
              className={`btn text-left ${i === from || i === to ? 'is-selected' : ''}`}
              title={`${s.files} code files, ${fmtNum(s.loc)} lines, ${s.modules.length} modules. Click to compare ${i < to ? 'from' : 'to'} this point.`}
              aria-pressed={i === from || i === to}
              onClick={() => (i < to ? setFrom(i) : setTo(i))}
            >
              <span className="mono text-xs">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {snaps.length < 2 ? <div className="muted">Only one snapshot: nothing to compare.</div> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1.5">From <select data-testid="snap-from" className="input" value={from} onChange={(e) => setFrom(Number(e.target.value))}>{snaps.map((s, i) => <option key={s.oid} value={i}>{s.label}</option>)}</select></label>
            <label className="flex items-center gap-1.5">to <select data-testid="snap-to" className="input" value={to} onChange={(e) => setTo(Number(e.target.value))}>{snaps.map((s, i) => <option key={s.oid} value={i}>{s.label}</option>)}</select></label>
          </div>
          {d && (
            <div className="space-y-4" data-testid="snap-diff">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Code files" value={signed(d.files[1] - d.files[0])} sub={`${fmtNum(d.files[0])} → ${fmtNum(d.files[1])}`} />
                <Stat label="Lines" value={signed(d.loc[1] - d.loc[0])} sub={`${fmtNum(d.loc[0])} → ${fmtNum(d.loc[1])}`} />
                <Stat label="Modules" value={signed(snaps[to].modules.length - snaps[from].modules.length)} sub={`${snaps[from].modules.length} → ${snaps[to].modules.length}`} />
                <Stat label="Avg. function complexity" value={d.avgComplexity[1].toFixed(2)} sub={`was ${d.avgComplexity[0].toFixed(2)}`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold">Modules</h3>
                  {d.addedModules.length + d.removedModules.length + d.changedModules.length === 0 ? <div className="text-[13px] muted">No module changes.</div> : (
                    <ul className="space-y-0.5 text-[13px]" data-testid="snap-modules">
                      {d.addedModules.map((m) => <li key={'+' + m.name} data-change="added"><Badge tone="ok">added</Badge> <span className="mono">{m.name}</span> <span className="faint">{files(m.files)}</span></li>)}
                      {d.removedModules.map((m) => <li key={'-' + m.name} data-change="removed"><Badge tone="bad">removed</Badge> <span className="mono">{m.name}</span> <span className="faint">{files(m.files)}</span></li>)}
                      {d.changedModules.slice(0, 15).map((m) => <li key={'~' + m.name} data-change="changed"><Badge>changed</Badge> <span className="mono">{m.name}</span> <span className="faint tnum">{m.filesBefore} → {files(m.filesAfter)}, {signed(m.locAfter - m.locBefore)} lines</span></li>)}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold">Dependencies between modules</h3>
                  {d.addedEdges.length + d.removedEdges.length === 0 ? <div className="text-[13px] muted">No new or dropped module dependencies.</div> : (
                    <ul className="space-y-0.5 text-[13px]" data-testid="snap-edges">
                      {d.addedEdges.slice(0, 25).map((e) => <li key={'+' + e.from + e.to}><Badge tone="ok">new</Badge> <span className="mono">{e.from} → {e.to}</span></li>)}
                      {d.removedEdges.slice(0, 25).map((e) => <li key={'-' + e.from + e.to}><Badge tone="bad">dropped</Badge> <span className="mono">{e.from} → {e.to}</span></li>)}
                    </ul>
                  )}
                </div>
              </div>
              {d.hotspotGrowth.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold">Complexity of the most complex files</h3>
                  <table className="tbl" data-testid="snap-hotspots">
                    <thead><tr><th>File</th><th className="num">Before</th><th className="num">After</th><th className="num">Change</th></tr></thead>
                    <tbody>{d.hotspotGrowth.slice(0, 12).map((h) => <tr key={h.file}><td><FileLink file={h.file} /></td><td className="num">{h.before || '—'}</td><td className="num">{h.after}</td><td className="num">{signed(h.after - h.before)}</td></tr>)}</tbody>
                  </table>
                  <p className="mt-1 text-xs faint">“—” means the file was not among the most complex files (or did not exist) at the earlier snapshot.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function HistoryView() {
  const a = useStore((s) => s.analysis)!;
  const g = a.git;
  if (!g) {
    if (a.stage !== 'done' && !a.gitMessage) return <Page title="History"><Pending what="Git history" /></Page>;
    return (
      <Page title="History" intro="How the code got here: what changes often, what changes together, who knows which parts, and how the architecture evolved.">
        <div data-testid="history-empty">
          <Empty>
            <p className="font-medium text-[var(--fg)]">No git history for this project.</p>
            <p className="mt-1">{a.gitMessage ?? 'No .git folder was provided.'}</p>
            <p className="mt-2 text-[13px]">To enable it, drop the project folder itself (the <code className="mono">.git</code> folder is read automatically) or a ZIP that includes <code className="mono">.git</code>. It is read in this browser; nothing is uploaded.</p>
          </Empty>
        </div>
      </Page>
    );
  }
  const last = g.commits[g.commits.length - 1];
  return (
    <Page title="History" intro="How the code got here, read from the .git folder in your browser. Counts are exact; what they suggest (coupling, ownership risk) is a heuristic signal to check, not a verdict.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="history-stats">
        <Stat label="Commits analysed" value={fmtNum(g.totalCommits)} spark={commitsOverTime(g)} sparkColor="var(--accent)" sub={g.truncated ? 'most recent only (history truncated)' : last ? `since ${day(last.time)}` : undefined} />
        <Stat label="Authors" value={fmtNum(g.authors.length)} sub={g.authors[0] ? `most active: ${g.authors[0].name}` : undefined} />
        <Stat label="Bus factor" value={<span data-testid="bus-factor">{g.busFactor.overall}</span>} sub="fewest people who own more than half of the files" />
        <Stat label="Branch" value={<span className="mono text-lg">{g.branch}</span>} sub={<span className="mono">HEAD {g.head.slice(0, 7)}{g.tags.length ? ` · ${g.tags.length} tag(s)` : ''}</span>} />
      </div>
      {g.notes.length > 0 && (
        <ul className="space-y-1 text-[13px] text-[var(--warn)]" data-testid="history-notes">{g.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
      <CommitCalendar g={g} />
      <ChurnCard g={g} />
      <CochangeCard g={g} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OwnershipCard g={g} />
        <MessagesCard g={g} />
      </div>
      <RenamesCard g={g} />
      <TimeTravelCard g={g} />
    </Page>
  );
}
