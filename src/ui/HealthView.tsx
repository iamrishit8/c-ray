import { useMemo, useState } from 'react';
import type { Finding, FindingCat } from '../core/types';
import { groupBy } from '../core/util';
import { useStore } from '../store/store';
import { Badge, Card, Chip, ConfBadge, Empty, FileLink, Page, Pending, RiskBar } from './kit';

export const CAT_LABEL: Record<FindingCat, string> = {
  hotspot: 'Hotspots (churn × complexity)', secret: 'Possible hardcoded secrets', 'tls-disabled': 'TLS verification disabled', 'sql-concat': 'SQL built by concatenation',
  eval: 'Dynamic code execution', complexity: 'High complexity', nesting: 'Deep nesting', 'oversize-function': 'Long functions', 'oversize-file': 'Large files',
  clone: 'Duplicated code', 'dead-export': 'Unused exports', todo: 'TODO / FIXME / HACK',
};
const ORDER: FindingCat[] = ['hotspot', 'secret', 'tls-disabled', 'sql-concat', 'eval', 'complexity', 'nesting', 'oversize-function', 'oversize-file', 'clone', 'dead-export', 'todo'];
const TONE = { high: 'bad', medium: 'warn', low: 'plain', info: 'plain' } as const;

function Row({ f, top }: { f: Finding; top?: number }) {
  return (
    <tr>
      <td className="whitespace-nowrap"><Badge tone={TONE[f.sev]}>{f.sev}</Badge></td>
      <td><FileLink file={f.file} line={f.line} endLine={f.endLine} />{f.cat === 'hotspot' && top && f.value ? <div className="mt-1"><RiskBar value={f.value / top} label={f.value} /></div> : null}</td>
      <td>{f.msg}{f.related?.map((r, i) => <span key={i}> — <FileLink file={r.file} line={r.line} endLine={r.endLine} /></span>)}</td>
      <td><ConfBadge c={f.conf} /></td>
    </tr>
  );
}

export function HealthView() {
  const a = useStore((s) => s.analysis)!;
  const [cat, setCat] = useState<FindingCat | 'all'>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  const groups = useMemo(() => groupBy(a.findings, (f) => f.cat), [a.findings]);
  const filtered = useMemo(() => a.findings.filter((f) => (cat === 'all' || f.cat === cat) && (!q || f.file.toLowerCase().includes(q.toLowerCase()) || f.msg.toLowerCase().includes(q.toLowerCase()))), [a.findings, cat, q]);
  if (a.stage !== 'done' && a.findings.length === 0) return <Page title="Hotspots & health"><Pending what="Health analysis" /></Page>;
  const shown = cat === 'all' ? ORDER.filter((c) => groups.has(c)) : [cat];
  return (
    <Page title="Hotspots & health" intro="Signals to review, not verdicts. Each item links to the exact location; pattern-based items (secrets, SQL, clones) are heuristic and can be false positives.">
      <div className="flex flex-wrap items-center gap-1.5" data-testid="health-cats">
        <Chip on={cat === 'all'} onClick={() => setCat('all')}>All · {a.findings.length}</Chip>
        {ORDER.filter((c) => groups.has(c)).map((c) => (
          <Chip key={c} testId={`cat-${c}`} on={cat === c} onClick={() => { setCat(c); setLimit(200); }}>{CAT_LABEL[c]} · {groups.get(c)!.length}</Chip>
        ))}
        <input className="input ml-auto" placeholder="filter by file or text…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} data-search-focus aria-label="Filter findings" />
      </div>
      {!a.git && <p className="text-[13px] muted">Churn × complexity hotspots need history: {a.gitMessage ?? 'no .git folder was provided.'}</p>}
      {a.findings.length === 0 && <Empty title="Nothing to flag">No health signals were raised for this project.</Empty>}
      {shown.map((c) => {
        const items = filtered.filter((f) => f.cat === c);
        if (items.length === 0) return null;
        return (
          <Card key={c} title={`${CAT_LABEL[c]} (${items.length})`}>
            <table className="tbl" data-testid={`findings-${c}`}>
              <tbody>{items.slice(0, cat === 'all' ? Math.min(limit, 12) : limit).map((f, i) => <Row key={i} f={f} top={c === 'hotspot' ? items[0]?.value : undefined} />)}</tbody>
            </table>
            {items.length > (cat === 'all' ? 12 : limit) && (
              <button className="link mt-2 text-[13px]" onClick={() => { setCat(c); setLimit(limit + 300); }}>Show more ({items.length - (cat === 'all' ? 12 : limit)} hidden)</button>
            )}
          </Card>
        );
      })}
    </Page>
  );
}
