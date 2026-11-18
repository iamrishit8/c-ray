# Conventions

How we write code, build UI and review changes in C-Ray. If a rule here blocks you, discuss it and record the outcome
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

Use tokens through Tailwind arbitrary values (`text-[var(--fg2)]`) or the utility classes below. **Never hard-code
colours**, because dark mode works by swapping these variables under `.dark`.

| Token | Role |
|---|---|
| `--bg` / `--bg2` / `--bg3` | page & cards / chrome & table headers / hover, chips, tracks |
| `--fg` / `--fg2` / `--fg3` | primary text / secondary (`.muted`) / tertiary (`.faint`) |
| `--line` | borders and dividers |
| `--accent`, `--accent-fg` | primary actions, links, progress; text on an accent fill |
| `--accent-soft` | selected state background (`.is-selected`) |
| `--ok` `--warn` `--bad` (+ `-soft`) | status: resolved/success · heuristic/warning · high severity/error |
| `--hl` | search-match highlight |
| `--radius`, `--shadow-sm` | card radius and elevation |

Typography: system UI font (`--font-sans`), `--font-mono` for code and paths. Page title 22 px semibold; card title
13 px semibold; body 13–14 px; meta 11–12 px. Use `.tnum` for numbers that line up or change.

### Components (`src/ui/kit.tsx`), so use these before writing new markup

| Component / class | Use for |
|---|---|
| `Page` | Every top-level view: title, intro, actions |
| `Card` | A titled block of related content (`right` slot for meta/actions) |
| `Stat` | KPI tile (label, value, sub-line) |
| `ConfBadge` | Confidence of an inferred fact. Always next to inferred items |
| `Badge tone=` | Categorical labels. `bad` = high severity, `warn` = medium/heuristic risk, `ok` = good, `accent` = key (PK), `plain` = neutral |
| `FileLink` | Every file / file:line reference (opens the source panel) |
| `Empty` | Empty states, saying what would make content appear |
| `Pending` | Data not computed yet |
| `.btn`, `.btn-primary`, `.btn-danger`, `.btn-icon` | Buttons. One primary action per area at most |
| `.is-selected` | **The** selected state for nav items, list rows, filter chips (with `.btn` it also tints the border) |
| `.input`, `table.tbl`, `.card`, `.link`, `.muted`, `.faint`, `.mono` | Form fields, data tables, surfaces, text styles |

If you need a new pattern twice, add it to `kit.tsx` / `index.css` and document it here.

### Layout
- App shell: 48 px header → side nav (192 px, grouped: Understand / Assess / Explore / Share) → content → optional source panel.
- New tabs: add to `TABS` in `ProjectView.tsx` with a `group`, `badgeTitle` if it has a count, and `projectOnly` if it needs >1 file.
- Content pages: `max-w-6xl`, 24 px padding, 16 px vertical rhythm (`space-y-4`). Two-column grids collapse at `lg`.
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
- Contrast: check new token pairs in both themes (aim for WCAG AA, 4.5:1 for body text).

### Graphs and diagrams
- Interactive graphs: `Graph.tsx` (Cytoscape). Diagrams that also go into exports: `Mermaid.tsx`.
- Edge style encodes confidence: solid = resolved, dashed = heuristic, dotted = unresolved. Keep that consistent everywhere.
- Read colours from the CSS tokens (see TODO backlog: `Graph.tsx` still has hard-coded hex values).

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
