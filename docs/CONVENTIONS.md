# Conventions

How we write code, build UI and review changes in imex. If a rule here blocks you, discuss it and record the outcome
in DECISIONS.md. Don't quietly break it.

---

## 1. Code

### TypeScript
- `strict` is on and stays on. No `any` in `src/` except at untyped library boundaries, with a comment saying why.
- Shared types go in `src/core/types.ts`. Module-local types stay in the module.
- Prefer plain functions over data. Classes only for stateful resources (`ParsePool`, `SearchIndex`, `MemFS`).
- Pure functions in `src/core` take everything they need as arguments. No hidden globals except deliberate caches.
- Use `async` only where there is real I/O or yielding (`tick()` for long loops in workers).

### Layering (who may import whom)

```
ui  ──►  store  ──►  workers/client  ──►  (postMessage)  ──►  workers/*  ──►  core, db
ui  ──►  core (types + cheap on-demand helpers only)
core ──► core            (never ui, store, workers, db, DOM)
```

- `src/core` must run in Node: no `window`, `document`, React or IndexedDB. Check with `npm test`.
- Anything that can take more than ~50 ms on a large repo runs in a worker.

### Analysis code
- Every fact you add to `Analysis` has `conf: Confidence` and a location (`file`, `line`) or `Evidence[]`.
- If you can't determine something, emit `unresolved` with the reason; don't drop it and don't guess.
- New analysis = a new `Stage` in `stages.ts`. Don't bolt work onto an existing stage.
- Bound everything: caps on list sizes, depth limits, time budgets. When a cap is hit, record a notice.
- Bump `ANALYSIS_VERSION` when the shape of a stored `Analysis` changes incompatibly.

### Errors
- Throw `IngestError` / user-facing errors only for things the user can act on. Everything else becomes a notice.
- Never swallow an error silently. `catch {}` needs a comment explaining why it's safe.

### Naming and files
- Views: `src/ui/XxxView.tsx`. Stages: `xxxStage`. Detectors: `id` in kebab-case.
- File header: one or two comment lines saying what the module is for.
- Comments explain *why*. Delete commented-out code.

### Tests
- Unit: `tests/unit/mN-topic.test.ts`. Run the real pipeline on a fixture (`tests/helpers.ts`) and assert against
  `ground-truth.json`. Add facts to ground truth **by hand**, never by copying current output.
- E2E: `tests/e2e/mN-topic.spec.ts`. Use helpers from `tests/e2e/util.ts` (`analyzeFixture`, `openTab`) and
  `data-testid` selectors only, never CSS classes or text that may change.
- New fixture? Keep it small, realistic, and document the planted facts in its `ground-truth.json`.
- Benchmarks write results JSON into `tests/bench/` and the numbers go into QUALITY.md.

---

## 2. UI

### Principles
1. **Evidence first.** Every claim links to source (`FileLink`) and shows confidence (`ConfBadge`).
2. **Explain the view.** Every page has a `Page` title and a one-sentence intro saying what it shows and how sure it is.
3. **Calm by default.** Colour carries meaning (status, confidence, selection). Decoration doesn't.
4. **Progressive.** Views render partial results while analysis is running (`Pending` for missing parts).
5. **Dense but readable.** 13–14 px body, generous line height, tables for lists of facts.

### Design tokens (`src/index.css`)

Look and feel: D27 (warm palette, Geist Mono only, terracotta accent). Reference: `docs/design/u2-mockup.html`.
Use tokens through Tailwind arbitrary values (`text-[var(--fg2)]`) or the classes below. **Never hard-code colours**:
dark mode swaps these variables under `.dark`, and `Graph.tsx` / `Mermaid.tsx` read them at runtime.

| Token | Role |
|---|---|
| `--bg` | page background (cream / warm black) |
| `--bg2` | raised surfaces: cards, inputs, menus, source panel, table headers |
| `--bg3` / `--bg4` | hover, chips, code background / bar tracks, skeletons |
| `--fg` / `--fg2` / `--fg3` | primary text / secondary (`.muted`) / tertiary (`.faint`, labels) |
| `--line` / `--line2` | dividers inside cards / control borders, chip outlines, graph boxes |
| `--accent`, `--accent-hover`, `--accent-fg` | terracotta fills: CTA buttons, progress, focus ring, graph focus; text on an accent fill (near-black in both themes for AA, D34) |
| `--accent-mark` | the logo mark's arrows (decorative, white) |
| `--accent-text` | accent used **as text** (links, selected rows): darker/lighter variant that meets AA |
| `--accent-soft` | selected list row background (`.is-selected`) |
| `--ok` `--warn` `--bad` (+ `-soft`) | status: resolved/success · heuristic/warning · high severity/error |
| `--r-route` `--r-service` `--r-model` `--r-test` `--r-int` `--r-config` | role colours (badges, graph nodes, charts); see `ROLE_FAMILY` in `kit.tsx` |
| `--hl` | highlighted source lines |
| `--tint-text` | how much of a hue badge text keeps before blending toward `--fg` (78%): `color-mix(in srgb, <hue> var(--tint-text), var(--fg))` |
| `--r-sm` / `--r-md` / `--r-lg` | radius 8 (buttons, inputs) / 12 (overlays) / 16 (cards) |
| `--shadow-sm`, `--shadow-md` | card elevation / floating overlays |

**Type.** Geist Mono everywhere (bundled via `@fontsource`, no network). Page title 30 px / 500 / −0.04em; card title
15.5 px / 500; body 13.5 px; meta 12–12.5 px; `.label` = 11 px mono uppercase, +0.05em, `--fg3` (eyebrows, table
headers, stat labels, nav groups). Big numbers in `Stat` 28 px. Use `.tnum` for numbers that line up or change.

**Icons.** `lucide-react` only (bundled). Nav icons live in `src/ui/icons.ts`. Icon-only buttons need `aria-label`.

**Motion (D36).** Tokens `--dur-1` 120 ms (hover, press), `--dur-2` 200 ms (panels, view change), `--dur-3` 320 ms
(enter, zoom, morph); easing `--ease-out` (default) or `--ease-spring` (small pops). Rules: motion needs a job (a
transition, drawing the eye, a playback); nothing loops while idle; animate only `transform`, `opacity` and SVG dash
offsets; enter animations use `fill-mode: backwards`. Classes: `.stagger` (Page body: cards fade up once),
`.fade-in`, `.pop`, `.ripple`, `.morph` (transform/opacity transitions), `.draw` (SVG path with `pathLength=1`),
`.slide-in` / `.slide-out`. JS: `reducedMotion()`, `dur(1|2|3)` (0 under reduced motion), `useCountUp` / `CountUp`,
`withViewTransition()` in `src/ui/motion.ts`. The app must work the same with `prefers-reduced-motion: reduce`.

### Components (`src/ui/kit.tsx`), so use these before writing new markup

| Component / class | Use for |
|---|---|
| `Page` / `PageHeader` | Every top-level view: eyebrow (nav group, from `PageGroup` context), title, intro, actions. Full-bleed views (System map, Flows) render `PageHeader` themselves |
| `Card` | A titled block (`right` slot for meta/actions, `flush` for edge-to-edge tables/graphs) |
| `Stat` | KPI tile: label, big value, sub-line, optional `spark` values |
| `ConfBadge` | Confidence of an inferred fact. Always next to inferred items (mono; solid/dashed/dotted border) |
| `Badge tone=` | Categorical labels. `bad` high severity, `warn` medium/heuristic risk, `ok` good, `accent` key (PK), `plain` neutral |
| `RoleBadge` | A file's role, tinted with its role colour |
| `FileLink` / `PathText` | Every file / file:line reference (opens the source panel); directory part dimmed |
| `Chip` | Filter toggles (fill dark when on, `aria-pressed`) |
| `RiskBar` | A 0..1 share or score with a coloured bar |
| `Stat` value | A plain number or `fmtNum` string counts up (`CountUp`); pass a node to opt out |
| `Empty`, `Pending`, `Skeleton` | Empty states (say what would make content appear) / not computed yet / loading placeholders |
| `.btn`, `.btn-primary` (dark), `.btn-accent` (terracotta CTA), `.btn-danger`, `.btn-icon`, `.btn-round` | Buttons. At most one primary or accent action per area |
| `.is-selected` | Selected state: soft accent for list rows; raised white for `.nav-item`; dark fill for `.chip` |
| `.input`, `table.tbl`, `.card`, `.link`, `.file`, `.muted`, `.faint`, `.label`, `.mono`, `.bar`, `.skel`, `.canvas`, `.overlay` | Form fields, data tables, surfaces, text styles, bars, skeletons, graph canvas + floating panels |
| `th.num` / `td.num` (in `table.tbl`) | Numeric columns: right-aligned header and cells, tabular figures |

If you need a new pattern twice, add it to `kit.tsx` / `index.css` and document it here.

### Layout
- App shell: 56 px translucent top bar → side nav (236 px, grouped: Understand / Assess / Explore / Share; an icon
  rail below 900 px) → content → optional source panel (an overlay below 1100 px).
- New tabs: add to `TABS` in `ProjectView.tsx` with a `group`, `badgeTitle` if it has a count, and `projectOnly` if it needs >1 file.
- Content pages: max 1180 px, 40 px side padding (20 px on small screens), 20 px vertical rhythm (`space-y-5`). Two-column grids collapse at `lg`.
- Keyboard: `/` focuses the element marked `data-search-focus` in the current view (or opens Search); list + detail
  views move the selection with ↑/↓ when the list has focus.
- List + detail views (Flows, Data): left list with sticky filter input, detail on the right.

### States (every view must handle these)
- **Loading / partial:** `Pending` or a progress bar. Never an empty white area.
- **Empty:** `Empty` with an explanation and a next step ("Upload including the .git folder to…").
- **Error / limitation:** inline warn text or a notice. Say what happened and what the user can do.
- **Large data:** cap rendering (`capped()`), show "Showing N of M" with a way to see more.

### Accessibility
- Keyboard: everything clickable is a `<button>` or `<a>`; focus ring comes from `:focus-visible`. Don't remove it.
- Icon-only buttons need `aria-label` (and `title`). Decorative SVGs get `aria-hidden="true"`.
- The current nav item has `aria-current="page"`. Alerts use `role="alert"`, loading uses `role="status"`.
- Colour is never the only signal: confidence badges also differ by border style and text; severity has a text label.
- Contrast: run `npm run audit:contrast` after changing tokens; every text pair must reach WCAG AA (4.5:1), graph
  dots and other non-text marks 3:1. Text on a tinted background uses `--tint-text` blending (D34).

### Graphs and diagrams
- Interactive graphs: `Graph.tsx` (Cytoscape). Diagrams that also go into exports: `Mermaid.tsx`.
- Edge style encodes confidence: solid = resolved, dashed = heuristic, dotted = unresolved. Keep that consistent everywhere.
- Colours come from the CSS tokens at runtime (`cssVar()` in `Graph.tsx`); the graph restyles on theme change.

### Visualisations (`src/ui/viz/`, D37)
- Layout maths goes in `src/core/viz/*` (pure, bounded, unit-tested); the component only renders SVG.
- Every picture: an accessible name (`role="img"` + `aria-label` summary), a `ViewSwitch` table fallback, a legend
  (`Swatch`), hover detail in `VizTip`, `data-testid`s on the picture and its marks, and marks that link to files.
- Colours: role → `roleVar()`, language/author series → `langColors()` / `SERIES`, quantities → `heat(0..1)`,
  status → `--bad` / `--warn` (soft fill + outline, so they read on top of `heat`). Inferred values say so.
- Keep keyboard access: the main marks are focusable (`tabIndex`, Enter activates); don't make thousands focusable.

### Copy
- Plain, specific, sentence case. Say what a number means ("2 high/medium findings", not "2").
- Hedge exactly as much as the confidence label says. "Likely", "appears to" for heuristic; plain statements for resolved.
- Privacy wording must stay true: "100% local · nothing leaves this browser".

---

## 3. Code review checklist

Run through this on your own diff before committing (and when reviewing someone else's).

**Correctness**
- [ ] Does it do what the TODO item asked, on all six fixtures and in File Mode?
- [ ] Edge cases: empty input, huge input, unparsable file, missing optional data (`git`, `l1Accuracy`).
- [ ] Are new facts labelled with the *right* confidence (not `resolved` unless exact)?

**Architecture**
- [ ] `src/core` still DOM-free; heavy work off the UI thread; new analysis is a `Stage`.
- [ ] Worker protocol changes are reflected in `protocol.ts` types *and* ARCHITECTURE.md.
- [ ] Stored-shape change → `ANALYSIS_VERSION` bumped.

**Performance**
- [ ] No O(n²) over files/symbols without a cap. Lists rendered with caps.
- [ ] No re-computation in render that should be `useMemo`'d.

**Privacy and safety**
- [ ] No new network requests. No `eval` / `new Function` on user code.
- [ ] Text that comes from analysed code is never injected as HTML: Markdown goes through `MarkdownDoc` (raw HTML
      escaped), Mermaid stays `securityLevel: 'strict'`, report strings go through `md()` in `report.ts`.

**UI**
- [ ] Uses kit components and tokens; no hard-coded colours; works in light and dark.
- [ ] Loading, empty and error states present; `data-testid` on new interactive elements.
- [ ] Keyboard and screen-reader basics (labels, focus, `aria-*`).

**Tests and docs**
- [ ] Unit tests against planted truth; e2e for UI; all suites green.
- [ ] TODO / DECISIONS / ARCHITECTURE / FLOWS / QUALITY updated as needed (see DEFINITION_OF_DONE.md).
