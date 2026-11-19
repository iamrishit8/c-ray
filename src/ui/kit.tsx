// Shared UI building blocks (D27 look). Plain and readable on purpose; colours only via CSS tokens.
import { createContext, useContext, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { Confidence, Role } from '../core/types';
import { useStore } from '../store/store';
import { CountUp } from './motion';

const CONF_TITLE: Record<Confidence, string> = {
  resolved: 'Resolved: derived exactly (compiler API, manifest or explicit declaration).',
  heuristic: 'Heuristic: inferred from syntax, names or conventions. Likely, not certain.',
  unresolved: 'Unresolved: could not be determined statically.',
};
const CONF_STYLE: Record<Confidence, string> = {
  resolved: 'text-[var(--ok)] border-[color-mix(in_srgb,var(--ok)_45%,transparent)]',
  heuristic: 'text-[var(--warn)] border-[color-mix(in_srgb,var(--warn)_55%,transparent)] border-dashed',
  unresolved: 'text-[var(--fg3)] border-[var(--line2)] border-dotted',
};

/** Confidence of an inferred fact. Colour, border style and text all differ, so colour is never the only signal. */
export function ConfBadge({ c }: { c: Confidence }) {
  return <span title={CONF_TITLE[c]} data-conf={c} className={`inline-block whitespace-nowrap rounded-md border px-2 font-mono text-[11px] leading-[18px] ${CONF_STYLE[c]}`}>{c}</span>;
}

export type Tone = 'plain' | 'accent' | 'ok' | 'warn' | 'bad';
const TONES: Record<Tone, string> = {
  plain: 'bg-[var(--bg3)] text-[var(--fg2)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
  ok: 'text-[color-mix(in_srgb,var(--ok)_var(--tint-text),var(--fg))] bg-[var(--ok-soft)]',
  warn: 'text-[color-mix(in_srgb,var(--warn)_var(--tint-text),var(--fg))] bg-[var(--warn-soft)]',
  bad: 'text-[color-mix(in_srgb,var(--bad)_var(--tint-text),var(--fg))] bg-[var(--bad-soft)]',
};

export function Badge({ children, tone = 'plain', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return <span title={title} className={`inline-block whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium leading-[19px] ${TONES[tone]}`}>{children}</span>;
}

/** The six role colour families (route, service, model, test, integration, config) shared by badges, graph and charts. */
export type RoleFamily = 'route' | 'service' | 'model' | 'test' | 'int' | 'config';
export const ROLE_FAMILY: Record<Role, RoleFamily> = {
  entry: 'route', route: 'route', controller: 'route', middleware: 'route', page: 'route', view: 'route', component: 'route', cli: 'route',
  service: 'service', util: 'service', job: 'service',
  model: 'model', repository: 'model', schema: 'model', migration: 'model',
  test: 'test',
  client: 'int', messaging: 'int',
  config: 'config', build: 'config', doc: 'config', unknown: 'config',
};
export const FAMILY_LABEL: Record<RoleFamily, string> = { route: 'Route / entry / UI', service: 'Service / logic', model: 'Model / data', test: 'Test', int: 'Integration', config: 'Config / other' };
export const roleVar = (role: Role) => `var(--r-${ROLE_FAMILY[role]})`;

/** Role pill: coloured dot + label tinted with the role colour. */
export function RoleBadge({ role, children, title }: { role: Role; children: ReactNode; title?: string }) {
  const c = roleVar(role);
  return (
    <span title={title} data-role={role} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-px pl-2 pr-2.5 text-[11.5px] font-medium leading-[18px]" style={{ color: `color-mix(in srgb, ${c} var(--tint-text), var(--fg))`, background: `color-mix(in srgb, ${c} var(--soft), var(--bg2))` }}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {children}
    </span>
  );
}

/** A path with its directory dimmed: `src/services/` + `orders.ts` + `:88`. */
export function PathText({ path, line }: { path: string; line?: number }) {
  const cut = path.lastIndexOf('/') + 1;
  return (
    <>
      {/* <wbr> lets long paths wrap after the directory instead of mid-name */}
      {cut > 0 && <><span className="dir">{path.slice(0, cut)}</span><wbr /></>}
      {path.slice(cut)}
      {line ? <span className="dir">:{line}</span> : null}
    </>
  );
}

/** Clickable file:line reference that opens the source preview. */
export function FileLink({ file, line, endLine, label, className = '' }: { file: string; line?: number; endLine?: number; label?: ReactNode; className?: string }) {
  const openSource = useStore((s) => s.openSource);
  if (!file) return <span className="faint">{label ?? '—'}</span>;
  return (
    <button className={`file mono text-left [overflow-wrap:anywhere] ${className}`} data-ref={`${file}:${line ?? 1}`} onClick={() => openSource(file, line ?? 1, endLine)} title={`Open ${file}${line ? `:${line}` : ''}`}>
      {label ?? <PathText path={file} line={line} />}
    </button>
  );
}

export function Card({ title, children, right, className = '', flush = false, testId }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string; flush?: boolean; testId?: string }) {
  return (
    <section className={`card ${className}`} data-testid={testId}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="text-[15.5px] font-medium tracking-[-0.02em]">{title}</h2>
          {right}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

/** Tiny line chart for a Stat tile. Values are scaled to the box; nothing is drawn for fewer than 2 points. */
export function Sparkline({ values, color = 'var(--fg3)', width = 64, height = 24 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * width).toFixed(1)} ${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0"><path className="draw" pathLength={1} d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function Stat({ label, value, sub, spark, sparkColor }: { label: string; value: ReactNode; sub?: ReactNode; spark?: number[]; sparkColor?: string }) {
  return (
    <div className="card relative overflow-hidden px-[18px] pb-3.5 pt-4">
      <div className="flex items-start justify-between gap-2">
        <div className="label">{label}</div>
        {spark && <Sparkline values={spark} color={sparkColor} />}
      </div>
      <div className="tnum mt-1.5 text-[28px] font-medium leading-[1.15] tracking-[-0.04em]">{typeof value === 'string' || typeof value === 'number' ? <CountUp text={String(value)} /> : value}</div>
      {sub && <div className="mt-0.5 text-[12.5px] muted">{sub}</div>}
    </div>
  );
}

export function Empty({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return (
    <div className="rounded-[var(--r-lg)] border border-dashed border-[var(--line2)] bg-[var(--bg2)] px-8 py-10 text-center muted">
      {title && <p className="mb-1 font-medium text-[var(--fg)]">{title}</p>}
      {children}
    </div>
  );
}

/** The nav group of the current view ("Understand", "Assess", …), shown as the page's eyebrow label. */
export const PageGroup = createContext<string | null>(null);

/** Page header (eyebrow, large title, intro, actions) without the page body; full-bleed views use it directly. */
export function PageHeader({ title, intro, actions, testId }: { title: ReactNode; intro?: ReactNode; actions?: ReactNode; testId?: string }) {
  const group = useContext(PageGroup);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4" data-testid={testId}>
      <div className="min-w-0">
        {group && <div className="label">{group}</div>}
        <h1 className="mt-1.5 text-[30px] font-medium leading-[1.1] tracking-[-0.04em]">{title}</h1>
        {intro && <p className="mt-2.5 max-w-[680px] muted">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ title, intro, children, actions }: { title: string; intro?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-14 pt-8 md:px-10 md:pt-9">
      <PageHeader title={title} intro={intro} actions={actions} />
      <div className="stagger mt-7 space-y-5">{children}</div>
    </div>
  );
}

/** Grey placeholder blocks shaped like the content that is about to appear. */
export function Skeleton({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel h-3.5" style={{ width: `${92 - ((i * 23) % 40)}%` }} />)}
    </div>
  );
}

export function Pending({ what }: { what: string }) {
  return (
    <div className="card p-5" role="status" data-testid="pending">
      <p className="mb-4 text-[13px] muted">{what} is still being computed. Results stream in as each analysis layer completes.</p>
      <Skeleton rows={4} />
    </div>
  );
}

/** Filter chip: a toggle button that fills dark when on. */
export function Chip({ on, onClick, children, testId, title }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string; title?: string }) {
  return <button type="button" data-testid={testId} title={title} aria-pressed={on} className={`chip ${on ? 'is-selected' : ''}`} onClick={onClick}>{children}</button>;
}

/** Horizontal bar for a 0..1 share; tone follows the value unless given. */
export function RiskBar({ value, label, tone, width = 96 }: { value: number; label?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'accent'; width?: number }) {
  const t = tone ?? (value >= 0.66 ? 'bad' : value >= 0.33 ? 'warn' : 'ok');
  const c = `var(--${t})`;
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="bar" style={{ width }}><span style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: c }} /></span>
      {label !== undefined && <span className="tnum font-mono text-[12px]" style={{ color: c }}>{label}</span>}
    </span>
  );
}

/** Shows the first `limit` rows with a "show all" toggle; keeps huge lists cheap to render. */
export function capped<T>(items: T[], limit: number): { rows: T[]; more: number } {
  return { rows: items.slice(0, limit), more: Math.max(0, items.length - limit) };
}

/** ↑/↓ (and Home/End) move the selection in a list + detail view. Put the handler on the list container;
 *  rows are buttons carrying `data-key`, so focus follows the selection. */
export function listKeys<K extends string>(keys: K[], current: K | null, select: (k: K) => void) {
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || keys.length === 0) return;
    e.preventDefault();
    const i = current === null ? -1 : keys.indexOf(current);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    select(keys[next]);
    const el = e.currentTarget.querySelector<HTMLElement>(`[data-key="${CSS.escape(keys[next])}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };
}

/** Text with `backtick` spans shown as inline code (decision and onboarding text carries commands and paths). */
export function InlineCode({ text }: { text: string }) {
  return <>{text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i} className="mono rounded bg-[var(--bg3)] px-1">{part}</code> : part))}</>;
}

/** Colour tokens for categorical series that are not roles (languages, authors): the role hues, then accent. */
export const SERIES = ['var(--r-service)', 'var(--accent)', 'var(--r-int)', 'var(--r-route)', 'var(--r-model)', 'var(--r-test)', 'var(--warn)'];
/** The rest of a categorical series ("other"). */
export const SERIES_OTHER = 'var(--r-config)';

/** Stable colour per language: the project's languages by size get SERIES in order; the rest share SERIES_OTHER. */
export function langColors(langs: { lang: string; loc: number }[]): (lang: string) => string {
  const ranked = [...langs].sort((x, y) => y.loc - x.loc).map((l) => l.lang);
  const m = new Map(ranked.slice(0, SERIES.length).map((l, i) => [l, SERIES[i]]));
  return (lang) => m.get(lang) ?? SERIES_OTHER;
}

/** Sequential colour for a 0..1 value: from a faint track to the accent, then to `--bad` at the top. */
export function heat(t: number): string {
  const v = Math.max(0, Math.min(1, t));
  if (v < 0.7) return `color-mix(in srgb, var(--accent) ${Math.round(18 + (v / 0.7) * 72)}%, var(--bg3))`;
  return `color-mix(in srgb, var(--bad) ${Math.round(((v - 0.7) / 0.3) * 100)}%, var(--accent))`;
}

/** A colour swatch with a label (chart legends). */
export function Swatch({ color, children, square = true }: { color: string; children: ReactNode; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] muted">
      <i aria-hidden="true" className={`inline-block h-[9px] w-[9px] ${square ? 'rounded-[3px]' : 'rounded-full'}`} style={{ background: color }} />
      {children}
    </span>
  );
}

/** Picture / table switch for a visualisation; every picture has a plain fallback. */
export function ViewSwitch({ table, onChange, testId }: { table: boolean; onChange: (table: boolean) => void; testId?: string }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Show as" data-testid={testId}>
      <Chip on={!table} onClick={() => onChange(false)}>picture</Chip>
      <Chip on={table} onClick={() => onChange(true)}>table</Chip>
    </div>
  );
}

/** Floating tooltip positioned inside a `relative` container. */
export function VizTip({ x, y, children, testId, width = 260 }: { x: number; y: number; children: ReactNode; testId?: string; width?: number }) {
  return <div className="viz-tip" role="tooltip" data-testid={testId} style={{ left: x, top: y, width }}>{children}</div>;
}
