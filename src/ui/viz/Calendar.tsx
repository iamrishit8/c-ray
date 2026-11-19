// Commit activity (History): a calendar of commits per day (local time zone) and one weekly strip per
// author. Day buckets: src/core/viz/calendar.ts.
import { useMemo, useState } from 'react';
import type { GitResult } from '../../core/types';
import { authorWeeks, commitCalendar, type CalendarDay } from '../../core/viz/calendar';
import { Card, ConfBadge, ViewSwitch, VizTip } from '../kit';
import { tipAt, useWidth } from './common';

const C = 12; // cell size
const GAP = 3;
const LEFT = 30;
const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function level(count: number, max: number): string {
  if (count === 0) return 'var(--bg4)';
  const t = Math.ceil((count / max) * 4) / 4;
  return `color-mix(in srgb, var(--accent) ${Math.round(25 + t * 75)}%, var(--bg3))`;
}

export function CommitCalendar({ g }: { g: GitResult }) {
  const tz = new Date().getTimezoneOffset();
  const cal = useMemo(() => commitCalendar(g.commits.map((c) => c.time), { tzOffsetMin: tz, maxWeeks: 53 }), [g.commits, tz]);
  const strips = useMemo(() => authorWeeks(g.commits, cal, { top: 6, tzOffsetMin: tz }), [g.commits, cal, tz]);
  const subjects = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of g.commits) {
      const d = new Date(c.time - tz * 60_000).toISOString().slice(0, 10);
      const arr = m.get(d) ?? [];
      arr.push(c.msg.split('\n')[0]);
      m.set(d, arr);
    }
    return m;
  }, [g.commits, tz]);
  const [boxRef, , box] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ d: CalendarDay; x: number; y: number } | null>(null);
  const [table, setTable] = useState(false);
  if (cal.days.length === 0) return null;
  const W = LEFT + cal.weeks * (C + GAP);
  const H = 16 + 7 * (C + GAP);
  const months = cal.days.filter((d) => d.date.endsWith('-01') || d === cal.days[0]).map((d) => ({ week: d.week, label: MONTHS[Number(d.date.slice(5, 7)) - 1] }));
  const maxWeek = Math.max(1, ...strips.flatMap((s) => s.weeks));
  return (
    <Card
      testId="activity-card"
      title="Commit activity"
      right={<div className="flex items-center gap-2"><ConfBadge c="resolved" /><ViewSwitch table={table} onChange={setTable} testId="calendar-switch" /></div>}
    >
      <p className="mb-3 text-[13px] muted">
        Commits per day in your time zone, {cal.start} to {cal.end}: {cal.total} commit{cal.total === 1 ? '' : 's'} on {cal.activeDays} day{cal.activeDays === 1 ? '' : 's'}.
        {cal.clipped > 0 && ` ${cal.clipped} older commit(s) are not shown (one year at most).`}
        {g.truncated && ' Only the most recent commits were analysed.'}
      </p>
      {table ? (
        <table className="tbl" data-testid="calendar-table">
          <thead><tr><th>Day</th><th className="num">Commits</th><th>Subjects</th></tr></thead>
          <tbody>
            {cal.days.filter((d) => d.count > 0).reverse().slice(0, 200).map((d) => <tr key={d.date}><td className="tnum">{d.date}</td><td className="num">{d.count}</td><td className="muted">{(subjects.get(d.date) ?? []).slice(0, 3).join(' · ')}</td></tr>)}
          </tbody>
        </table>
      ) : (
        <div ref={boxRef} className="relative overflow-x-auto pb-1" onMouseLeave={() => setTip(null)}>
          <svg width={W} height={H} role="img" aria-label={`Commit calendar: ${cal.total} commits on ${cal.activeDays} days between ${cal.start} and ${cal.end}`} data-testid="commit-calendar">
            {months.map((m) => <text key={m.week + m.label} x={LEFT + m.week * (C + GAP)} y={10} fontSize={10} fill="var(--fg3)">{m.label}</text>)}
            {DAYS.map((d, i) => <text key={i} x={0} y={16 + i * (C + GAP) + C - 2} fontSize={9.5} fill="var(--fg3)">{d}</text>)}
            {cal.days.map((d) => (
              <rect
                key={d.date}
                data-testid="calendar-day"
                data-date={d.date}
                data-count={d.count}
                className="viz-cell"
                x={LEFT + d.week * (C + GAP)}
                y={16 + d.weekday * (C + GAP)}
                width={C}
                height={C}
                rx={3}
                fill={level(d.count, cal.max)}
                onMouseMove={(e) => setTip({ d, ...tipAt(e, box, 240) })}
              />
            ))}
          </svg>
          {tip && (
            <VizTip x={tip.x} y={tip.y} width={240} testId="calendar-tip">
              <div className="tnum font-medium">{tip.d.count} commit{tip.d.count === 1 ? '' : 's'} on {tip.d.date}</div>
              {(subjects.get(tip.d.date) ?? []).slice(0, 3).map((m, i) => <div key={i} className="truncate muted">{m}</div>)}
            </VizTip>
          )}
        </div>
      )}
      {strips.length > 0 && (
        <div className="mt-5" data-testid="author-strips">
          <div className="label mb-2">Who committed when (commits per week)</div>
          <div className="space-y-1.5 overflow-x-auto">
            {strips.map((s) => (
              <div key={s.author} className="flex items-center gap-2 text-[12.5px]" data-author={s.author}>
                <span className="w-28 shrink-0 truncate" title={s.author}>{s.author}</span>
                <span className="flex shrink-0 gap-[3px]" aria-label={`${s.author}: ${s.total} commits`} role="img">
                  {s.weeks.map((n, w) => <i key={w} className="inline-block h-3 w-[12px] rounded-[2px]" title={n ? `${n} commit(s) in week ${w + 1}` : undefined} style={{ background: n ? `color-mix(in srgb, var(--r-service) ${Math.round(30 + (n / maxWeek) * 70)}%, var(--bg3))` : 'var(--bg3)' }} />)}
                </span>
                <span className="tnum shrink-0 faint">{s.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
