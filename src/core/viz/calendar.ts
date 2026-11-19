// Commit activity calendar (GitHub-style weeks × weekdays) and per-author weekly strips.
// Days are bucketed in a given time zone (offset in minutes, as Date#getTimezoneOffset returns),
// so the result is the same in Node tests and in any browser.

const DAY_MS = 86_400_000;

export interface CalendarDay {
  date: string;
  count: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Column (0 = first week shown). */
  week: number;
}

export interface Calendar {
  days: CalendarDay[];
  weeks: number;
  max: number;
  total: number;
  activeDays: number;
  start: string;
  end: string;
  /** Commits older than the first week shown. */
  clipped: number;
  /** Day index (days since 1970-01-01 in the chosen zone) of the first cell; used by `authorWeeks`. */
  startDay: number;
}

export interface CalendarOptions {
  /** Minutes to subtract from UTC to get local time (Date#getTimezoneOffset). Default 0 = UTC. */
  tzOffsetMin?: number;
  /** At most this many week columns, ending with the newest commit. */
  maxWeeks?: number;
}

const dayIndex = (t: number, tz: number) => Math.floor((t - tz * 60_000) / DAY_MS);
const isoDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
// 1970-01-01 was a Thursday
const weekdayOf = (d: number) => (((d + 4) % 7) + 7) % 7;

/** `times` in milliseconds. */
export function commitCalendar(times: number[], opts: CalendarOptions = {}): Calendar {
  const tz = opts.tzOffsetMin ?? 0;
  const maxWeeks = opts.maxWeeks ?? 53;
  if (times.length === 0) return { days: [], weeks: 0, max: 0, total: 0, activeDays: 0, start: '', end: '', clipped: 0, startDay: 0 };
  const idx = times.map((t) => dayIndex(t, tz));
  const last = Math.max(...idx);
  const first = Math.min(...idx);
  const lastWeekStart = last - weekdayOf(last);
  const start = Math.max(first - weekdayOf(first), lastWeekStart - (maxWeeks - 1) * 7);
  const counts = new Map<number, number>();
  let clipped = 0;
  for (const d of idx) {
    if (d < start) clipped++;
    else counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const days: CalendarDay[] = [];
  for (let d = start; d <= last; d++) days.push({ date: isoDay(d), count: counts.get(d) ?? 0, weekday: weekdayOf(d), week: Math.floor((d - start) / 7) });
  return {
    days, weeks: Math.floor((last - start) / 7) + 1, max: Math.max(0, ...counts.values()), total: times.length - clipped,
    activeDays: counts.size, start: isoDay(start), end: isoDay(last), clipped, startDay: start,
  };
}

export interface AuthorWeeks { author: string; total: number; weeks: number[] }

/** Commits per author per calendar week, for the `top` most active authors in the calendar's range. */
export function authorWeeks(commits: { author: string; time: number }[], cal: Calendar, opts: { top?: number; tzOffsetMin?: number } = {}): AuthorWeeks[] {
  const tz = opts.tzOffsetMin ?? 0;
  const by = new Map<string, number[]>();
  for (const c of commits) {
    const w = Math.floor((dayIndex(c.time, tz) - cal.startDay) / 7);
    if (w < 0 || w >= cal.weeks) continue;
    let arr = by.get(c.author);
    if (!arr) {
      arr = new Array<number>(cal.weeks).fill(0);
      by.set(c.author, arr);
    }
    arr[w]++;
  }
  return [...by]
    .map(([author, weeks]) => ({ author, weeks, total: weeks.reduce((s, n) => s + n, 0) }))
    .sort((x, y) => y.total - x.total || (x.author < y.author ? -1 : 1))
    .slice(0, opts.top ?? 6);
}
