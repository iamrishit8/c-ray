// The Home help manual (U4, D42): renders src/ui/help/content.ts. Layout only, no copy lives here.
// A slim section bar (below 1100 px) or a contents column with scroll-spy (above), then six sections; each page entry
// is a <details> so the manual stays scannable and works with the keyboard.
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { File as FileIcon, Search as SearchIcon } from 'lucide-react';
import { PIPELINE_STEPS } from '../../core/viz/progress';
import { TAB_ICON } from '../icons';
import { Badge, ConfBadge, InlineCode } from '../kit';
import { reducedMotion } from '../motion';
import { CONFIDENCE_HELP, LIMITS, PAGES, QUICK_START, ROUTES, SECTIONS, SHORTCUTS, TERMS, type PageEntry, type Term } from './content';
import { Schematic } from './Schematics';

const sectionId = (id: string) => `help-${id}`;
const pageId = (id: string) => `help-page-${id}`;

/** Scrolls to an element of the manual (opening it when it is a collapsed page entry) and moves focus there. */
function goTo(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };
}

/** Below this many px from the top of the screen an element counts as "reached": app header (56) + the 64 px
 *  `scroll-mt-16` that anchor jumps leave + a few px. */
const READING_LINE = 130;

/** Which manual element is current: the last one (in document order) whose top has passed the reading line.
 *  Listens to scrolling of any container (the page scrolls inside `<main>`, not the window). */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= READING_LINE) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);
  return active;
}

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section id={sectionId(id)} tabIndex={-1} className="scroll-mt-16 outline-none" data-testid={`help-section-${id}`} aria-labelledby={`${sectionId(id)}-h`}>
      <h2 id={`${sectionId(id)}-h`} className="text-[22px] font-medium tracking-[-0.03em]">{title}</h2>
      <p className="mt-1 max-w-[680px] muted">{intro}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-[13.5px]">{items.map((t, i) => <li key={i}><InlineCode text={t} /></li>)}</ul>;
}

function Sub({ children }: { children: ReactNode }) {
  return <div className="label mb-1.5 mt-4 first:mt-0">{children}</div>;
}

function QuickStart() {
  return (
    <div className="space-y-5">
      <ol className="grid gap-3 md:grid-cols-2">
        {QUICK_START.map((s, i) => (
          <li key={s.title} className="card flex gap-3 px-4 py-3.5">
            <span aria-hidden="true" className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[12px] font-semibold text-[var(--accent-text)]">{i + 1}</span>
            <div>
              <h3 className="font-medium">{s.title}</h3>
              <p className="mt-0.5 text-[13px] muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="card px-4 py-3.5" data-testid="help-steps">
        <Sub>The analysis steps, in order</Sub>
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px]">
          {PIPELINE_STEPS.map((s, i) => <li key={s} className="flex items-center gap-1.5"><Badge>{s}</Badge>{i < PIPELINE_STEPS.length - 1 && <span aria-hidden="true" className="faint">→</span>}</li>)}
        </ol>
      </div>
      <div className="card px-4 py-3.5" data-testid="help-confidence">
        <Sub>The three confidence levels</Sub>
        <ul className="space-y-2 text-[13px]">
          {(['resolved', 'heuristic', 'unresolved'] as const).map((c) => (
            <li key={c} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1"><ConfBadge c={c} /><span className="min-w-0 flex-1 muted">{CONFIDENCE_HELP[c].replace(/^[A-Za-z]+: /, '')}</span></li>
          ))}
        </ul>
        <p className="mt-2 text-[12.5px] muted">Colour is never the only signal: the badge border is solid, dashed or dotted, and graph arrows follow the same pattern.</p>
      </div>
    </div>
  );
}

function Routes() {
  const title = (id: string) => PAGES.find((p) => p.id === id)?.title ?? id;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {ROUTES.map((r) => (
        <div key={r.goal} className="card px-4 py-3.5" data-testid="help-route">
          <h3 className="font-medium">{r.goal}</h3>
          <p className="mt-0.5 text-[13px] muted">{r.blurb}</p>
          <ol className="mt-3 space-y-2 text-[13px]">
            {r.steps.map((s, i) => {
              const Icon = TAB_ICON[s.tab];
              return (
                <li key={s.tab} className="flex gap-2.5">
                  <span aria-hidden="true" className="tnum w-4 shrink-0 text-right faint">{i + 1}</span>
                  <span className="min-w-0">
                    <a href={`#${pageId(s.tab)}`} onClick={goTo(pageId(s.tab))} className="link inline-flex items-center gap-1.5 font-medium">
                      {Icon && <Icon aria-hidden="true" size={14} strokeWidth={1.8} />}{title(s.tab)}
                    </a>
                    <span className="muted"> · {s.why}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function PageCard({ p }: { p: PageEntry }) {
  const Icon = TAB_ICON[p.id] ?? FileIcon;
  return (
    <details id={pageId(p.id)} tabIndex={-1} className="card group scroll-mt-16 outline-none" data-testid="help-page" data-page={p.id}>
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-[var(--r-lg)] px-4 py-3.5 [&::-webkit-details-marker]:hidden" data-testid="help-page-summary">
        <Icon aria-hidden="true" size={18} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-[15.5px] font-medium tracking-[-0.02em]">{p.title}</span>
            <span className="label">{p.group}</span>
          </span>
          <span className="mt-0.5 block text-[13px] muted">{p.question}</span>
        </span>
        <span aria-hidden="true" className="mt-1 shrink-0 text-[var(--fg3)] transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="grid gap-x-8 gap-y-4 border-t border-[var(--line)] px-5 py-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <Sub>What it shows</Sub>
          <p className="text-[13.5px]">{p.shows}</p>
          <Sub>How to use it</Sub>
          <List items={p.use} />
          <Sub>How to read it</Sub>
          <div className="grid gap-2 text-[13px] sm:grid-cols-2">
            <div className="rounded-[var(--r-sm)] bg-[var(--ok-soft)] px-3 py-2"><b className="font-medium">Healthy looks like: </b>{p.read.good}</div>
            <div className="rounded-[var(--r-sm)] bg-[var(--warn-soft)] px-3 py-2"><b className="font-medium">Worth a closer look: </b>{p.read.worry}</div>
          </div>
          <Sub>How sure it is</Sub>
          <p className="text-[13.5px]">{p.sure}</p>
          <Sub>Limits</Sub>
          <p className="text-[13.5px]">{p.limits}</p>
        </div>
        <div className="min-w-0 space-y-4">
          {p.schematic && <Schematic id={p.schematic} />}
          <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] px-3.5 py-3" data-testid="help-example">
            <div className="label">Try it on the sample project</div>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12.5px]">{p.example.steps.map((s, i) => <li key={i}><InlineCode text={s.say} /></li>)}</ol>
            <p className="mt-2 text-[12.5px]"><b className="font-medium">You see: </b><span className="muted">{p.example.sees}</span></p>
          </div>
        </div>
      </div>
    </details>
  );
}

function Pages() {
  return <div className="space-y-2.5">{PAGES.map((p) => <PageCard key={p.id} p={p} />)}</div>;
}

function matches(t: Term, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return t.term.toLowerCase().includes(s) || (t.aliases ?? []).some((a) => a.toLowerCase().includes(s)) || t.def.toLowerCase().includes(s);
}

function Terms() {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const sorted = TERMS.filter((t) => matches(t, q)).sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
    const by = new Map<string, Term[]>();
    for (const t of sorted) {
      const L = t.term[0].toUpperCase();
      by.set(L, [...(by.get(L) ?? []), t]);
    }
    return [...by];
  }, [q]);
  const count = groups.reduce((n, [, ts]) => n + ts.length, 0);
  return (
    <div>
      <label className="relative block max-w-md">
        <span className="sr-only">Filter terms</span>
        <SearchIcon aria-hidden="true" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg3)]" />
        <input data-testid="help-term-search" className="input w-full !pl-8" placeholder={`Filter ${TERMS.length} terms…`} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <p className="mt-2 text-[12.5px] faint" role="status" data-testid="help-term-count">{q ? `${count} of ${TERMS.length} terms` : `${TERMS.length} terms, A to Z`}</p>
      {count === 0 ? (
        <p className="mt-3 muted">No term matches “{q}”. Try a shorter word, or look in the page entries above.</p>
      ) : (
        <div className="mt-3 space-y-5">
          {groups.map(([letter, ts]) => (
            <div key={letter}>
              <div className="label mb-1.5" aria-hidden="true">{letter}</div>
              <dl className="card divide-y divide-[var(--line)]">
                {ts.map((t) => (
                  <div key={t.id} id={`help-term-${t.id}`} data-testid="help-term" className="px-4 py-3">
                    <dt className="font-medium">{t.term}{t.aliases && <span className="ml-2 text-[12px] font-normal faint">also: {t.aliases.join(', ')}</span>}</dt>
                    <dd className="mt-0.5 text-[13.5px]">{t.def}</dd>
                    <dd className="mt-1 text-[12.5px] muted"><b className="font-medium text-[var(--fg)]">Where: </b>{t.where} <b className="ml-1 font-medium text-[var(--fg)]">Why it matters: </b>{t.why}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Shortcuts() {
  return (
    <dl className="card divide-y divide-[var(--line)]" data-testid="help-shortcuts">
      {SHORTCUTS.map((s) => (
        <div key={s.keys} className="grid gap-1 px-4 py-2.5 text-[13.5px] sm:grid-cols-[220px_1fr] sm:gap-4">
          <dt><span className="mono rounded border border-[var(--line2)] bg-[var(--bg)] px-1.5 py-0.5 text-[12px]">{s.keys}</span></dt>
          <dd className="muted">{s.does}</dd>
        </div>
      ))}
    </dl>
  );
}

function Limits() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {LIMITS.map((g) => (
        <div key={g.title} className="card px-4 py-3.5" data-testid="help-limit">
          <h3 className="mb-2 font-medium">{g.title}</h3>
          <List items={g.items} />
        </div>
      ))}
    </div>
  );
}

const BODY: Record<string, () => ReactNode> = { 'quick-start': QuickStart, routes: Routes, pages: Pages, terms: Terms, shortcuts: Shortcuts, limits: Limits };

export function HelpManual() {
  // document order: each section, with the page entries right after the "pages" section's heading
  const ids = useMemo(() => SECTIONS.flatMap((s) => [sectionId(s.id), ...(s.id === 'pages' ? PAGES.map((p) => pageId(p.id)) : [])]), []);
  const active = useScrollSpy(ids);
  const activeSection = active.startsWith('help-page-') ? sectionId('pages') : active;
  return (
    <div id="help" data-testid="help-manual" className="pt-2">
      <div className="mb-3">
        <div className="label">Manual</div>
        <h2 className="mt-1 text-[26px] font-medium tracking-[-0.04em]">How to use imex</h2>
        <p className="mt-1 max-w-[680px] muted">What each page is for, how to read it, how far to trust it, and what every word means. The manual lives only on this page: use the imex logo to come back to it from an open project.</p>
      </div>

      {/* below 1100 px: a slim bar that sticks to the top while the manual is on screen */}
      <nav aria-label="Manual sections" data-testid="help-nav" className="sticky top-0 z-10 -mx-5 mb-5 overflow-x-auto border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] px-5 backdrop-blur min-[1100px]:hidden md:-mx-10 md:px-10">
        <ul className="flex gap-1 py-2 text-[13px]">
          {SECTIONS.map((s) => (
            <li key={s.id} className="shrink-0">
              <a href={`#${sectionId(s.id)}`} onClick={goTo(sectionId(s.id))} aria-current={activeSection === sectionId(s.id) ? 'location' : undefined} className={`nav-item block rounded-full px-3 py-1 ${activeSection === sectionId(s.id) ? 'is-selected' : ''}`}>{s.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-[1100px]:grid min-[1100px]:grid-cols-[190px_minmax(0,1fr)] min-[1100px]:gap-10">
        {/* from 1100 px: a contents column that follows the reader */}
        <aside className="hidden min-[1100px]:block">
          <nav aria-label="Manual contents" data-testid="help-toc" className="sticky top-6 max-h-[calc(100vh-48px)] overflow-auto pb-4 text-[13px]">
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${sectionId(s.id)}`} onClick={goTo(sectionId(s.id))} aria-current={active === sectionId(s.id) ? 'location' : undefined} className={`nav-item block rounded-[var(--r-sm)] px-2.5 py-1.5 ${active === sectionId(s.id) ? 'is-selected' : ''}`}>{s.label}</a>
                  {s.id === 'pages' && (
                    <ul className="mb-1 ml-2.5 mt-0.5 space-y-px border-l border-[var(--line)] pl-2">
                      {PAGES.map((p) => (
                        <li key={p.id}>
                          <a href={`#${pageId(p.id)}`} onClick={goTo(pageId(p.id))} aria-current={active === pageId(p.id) ? 'location' : undefined} className={`block rounded px-2 py-0.5 text-[12.5px] ${active === pageId(p.id) ? 'font-medium text-[var(--accent-text)]' : 'muted hover:text-[var(--fg)]'}`}>{p.title.replace(/ \(.*/, '')}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="min-w-0 space-y-12">
          {SECTIONS.map((s) => {
            const Body = BODY[s.id];
            return <Section key={s.id} id={s.id} title={s.title} intro={s.intro}><Body /></Section>;
          })}
        </div>
      </div>
    </div>
  );
}
