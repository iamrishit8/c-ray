// Small shared UI building blocks. Plain and readable on purpose.
import type { ReactNode } from 'react';
import type { Confidence } from '../core/types';
import { useStore } from '../store/store';

export function ConfBadge({ c }: { c: Confidence }) {
  const style: Record<Confidence, string> = {
    resolved: 'border-[var(--ok)] text-[var(--ok)]',
    heuristic: 'border-[var(--warn)] text-[var(--warn)] border-dashed',
    unresolved: 'border-[var(--fg3)] text-[var(--fg3)] border-dotted',
  };
  const title: Record<Confidence, string> = {
    resolved: 'Resolved: derived exactly (compiler API, manifest or explicit declaration).',
    heuristic: 'Heuristic: inferred from syntax, names or conventions. Likely, not certain.',
    unresolved: 'Unresolved: could not be determined statically.',
  };
  return <span title={title[c]} data-conf={c} className={`inline-block rounded border px-1.5 text-[11px] leading-[18px] ${style[c]}`}>{c}</span>;
}

export function Badge({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'accent' | 'ok' | 'warn' | 'bad'; title?: string }) {
  const tones = { plain: 'bg-[var(--bg3)] text-[var(--fg2)]', accent: 'bg-[var(--accent-soft)] text-[var(--accent)]', ok: 'text-[var(--ok)] bg-[var(--ok-soft)]', warn: 'text-[var(--warn)] bg-[var(--warn-soft)]', bad: 'text-[var(--bad)] bg-[var(--bad-soft)]' };
  return <span title={title} className={`inline-block rounded px-1.5 text-[11px] font-medium leading-[18px] whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

/** Clickable file:line reference that opens the source preview. */
export function FileLink({ file, line, endLine, label, className = '' }: { file: string; line?: number; endLine?: number; label?: ReactNode; className?: string }) {
  const openSource = useStore((s) => s.openSource);
  if (!file) return <span className="faint">{label ?? '—'}</span>;
  return (
    <button className={`link mono break-all ${className}`} data-ref={`${file}:${line ?? 1}`} onClick={() => openSource(file, line ?? 1, endLine)} title={`Open ${file}${line ? `:${line}` : ''}`}>
      {label ?? (line ? `${file}:${line}` : file)}
    </button>
  );
}

export function Card({ title, children, right, className = '' }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide faint">{label}</div>
      <div className="tnum mt-0.5 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs muted">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[var(--radius)] border border-dashed border-[var(--line)] bg-[var(--bg2)] p-8 text-center muted">{children}</div>;
}

export function Page({ title, intro, children, actions }: { title: string; intro?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {intro && <p className="mt-1 max-w-3xl muted">{intro}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function Pending({ what }: { what: string }) {
  return <Empty>{what} is still being computed — results stream in as each analysis layer completes.</Empty>;
}

/** Shows the first `limit` rows with a "show all" toggle; keeps huge lists cheap to render. */
export function capped<T>(items: T[], limit: number): { rows: T[]; more: number } {
  return { rows: items.slice(0, limit), more: Math.max(0, items.length - limit) };
}
