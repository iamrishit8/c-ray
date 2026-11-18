# TODO and roadmap

The single source of truth for what's done, what's next and what's left. Update it in the same commit as the work.
Statuses: `[ ]` open · `[~]` in progress · `[x]` done. Each milestone is done only per DEFINITION_OF_DONE.md.

## Now

**M9: Git layer is done, waiting for owner review** (2026-11-18): History view, time-travel, History export
section, planted-truth unit tests, e2e, real-repo measurement. Next, after approval: **U2** (visual redesign + rename to imex), then M10.

---

## Roadmap

| # | Milestone | Status |
|---|---|---|
| M1 | Scaffold, worker architecture, ingestion (file/folder/ZIP), filtering, L0, IndexedDB persistence, orientation page | ✅ |
| M2 | L2 TypeScript graph (compiler API), zoomable system map, search | ✅ |
| M3 | L1 tree-sitter for 13 languages, heuristic resolver, confidence labelling, L1-vs-L2 benchmark | ✅ |
| M4 | Pluggable framework detectors + request/flow tracer | ✅ |
| M5 | Dependency intelligence (cycles, coupling, god modules, layering, packages) + health signals | ✅ |
| M6 | Impact analysis (transitive dependents, affected entries/tests, risk), verified against `tsc` | ✅ |
| M7 | Schema reconstruction (11 ORM/DDL sources), ER diagram, entity read/write map | ✅ |
| M8 | Export: Markdown, Notion ZIP, print/PDF with SVG diagrams, JSON | ✅ |
| U1 | UI review + refresh (grouped nav, unified selected state, tinted badges, icon toggle) | ✅ 2026-11-18 |
| D1 | Documentation system (CLAUDE.md, docs/, Definition of Done, docs Stop hook) | ✅ 2026-11-18 |
| M9 | Git layer: churn, co-change, bus factor, time-travel | ✅ 2026-11-18 (awaiting owner review) |
| M10 | Decisions view + onboarding guide + generated docs | ⬜ |
| M11 | AI Q&A (bring-your-own key) + AI-enhanced summaries | ⬜ |
| M12 | Scale hardening, robustness tests, performance pass, polish | ⬜ |
| U2 | Visual redesign (warm palette, mono type, new diagrams) + rename to **imex** | ⬜ direction approved 2026-11-18, starts after M9 |

---

## M9: Git layer ✅

Engine: `analyzeGit` produces `GitResult` (commits, churn, authors, bus factor, co-change, message types/keywords, tags,
≤10 architecture snapshots) + churn×complexity `hotspot` findings; `diffSnapshots` (`src/core/git/diff.ts`) compares two snapshots.

- [x] History engine over an in-memory `.git` (isomorphic-git), wired in as `gitStage`
- [x] Test fixture with history: `tests/git-fixture.ts` builds the `git-history` repo at test time (12 commits,
      3 authors, a co-changing pair with no import, a single-owner file, an annotated tag, a module added late);
      planted truth in `tests/fixtures/git-history/ground-truth.json` (D28)
- [x] Unit tests `tests/unit/m9-git.test.ts` (35): churn, authors, bus factor, co-change (direct/indirect link,
      test↔test skipped), `classifyMessage`, snapshots, `diffSnapshots`, hotspots, report section, truncation,
      no `.git`, corrupt `.git`, `enableGit: false`
- [x] History view (`src/ui/HistoryView.tsx`, group *Assess*, `projectOnly`, badge = hidden-coupling pairs):
      stats, churn table with Impact jump, co-change with "hidden coupling" filter, ownership + authors,
      commit types + keywords, empty state
- [x] Time-travel: snapshot timeline + from/to pickers → files/lines/modules/complexity deltas, modules
      added/removed/changed, module edges new/dropped, complexity growth of the most complex files
- [x] Health view: hotspots render when history exists (covered by the e2e)
- [x] Export: "History" section in `report.ts` (Markdown, Notion, print)
- [x] E2E `tests/e2e/m9-history.spec.ts`: ZIP with `.git` → churn, co-change, bus factor, time-travel, hotspots, export; no-`.git` empty state
- [x] Measured on express and fastify (`npm run bench:git`); numbers and limitations in QUALITY.md
- [x] Docs: ARCHITECTURE, FLOWS §6, DECISIONS D28–D30, CONVENTIONS (`.num`), QUALITY
- Fixed on the way: snapshots of repos whose code all sat in one folder lost that folder from their paths
  (memory source `keepPaths`); `require('..')` to the project root index was unresolved (`resolve-js.ts`);
  isomorphic-git calls now share a pack cache (git stage 8× faster on express)

**Follow-ups (not blocking)**
- [ ] Peak memory of the git stage is high (≈0.5–0.8 GB RSS for a 12 MB `.git`, see QUALITY.md). Profile in M12
      (suspects: inflated pack objects held by the isomorphic-git cache, per-snapshot pipelines)
- [ ] Co-change between a test and the code it exercises still shows as hidden coupling when the import path is
      longer than 4 hops or goes through a package name (`require('fastify')`)
- [ ] Rename detection: a renamed file starts with fresh churn (isomorphic-git `walk` has no rename tracking)

## M10: Decisions view + onboarding guide + generated docs

`Analysis.decisions: Decision[]` exists in the model but nothing fills it yet.

- [ ] Design the decision catalogue (DECISIONS.md entry): which architectural decisions we infer, e.g. framework, ORM,
      auth mechanism, monorepo/workspaces, layering style, API style (REST/GraphQL/RPC), state management, test strategy,
      deployment (Docker/serverless), config/secrets approach
- [ ] `decisionsStage`: each decision gets evidence (file:line), confidence and trade-offs. Read ADRs in the repo
      (`docs/adr/*`, fixture `monorepo` has one) as `resolved` decisions
- [ ] Planted truth for decisions in each fixture's `ground-truth.json` + unit tests `m10-decisions.test.ts`
- [ ] **Decisions view** (group *Understand*): list with evidence, confidence, trade-offs, "why it appears built this way"
- [ ] **Onboarding guide**: generated reading path (entry → routes → core domain → data), glossary of domain terms
      (from entity/route/symbol names), "how to run it" from manifests/README/Dockerfile, first-week checklist
- [ ] Generated docs: add Decisions + Onboarding sections to exports
- [ ] E2E `m10-decisions.spec.ts`; QUALITY.md limitations

## M11: AI Q&A (BYO key) + AI-enhanced summaries

Needs an explicit privacy design first. This is the only feature that may send data off the machine.

- [ ] DECISIONS entry: provider(s) (default Anthropic, latest Claude model), key storage (memory-only vs IndexedDB,
      opt-in), what is sent (retrieved snippets only, never the whole repo), a preview of the outgoing context
- [ ] Settings: add/remove key, provider/model, "send nothing" default. The header privacy pill switches to an
      "AI on: snippets are sent to <provider>" state whenever AI is enabled
- [ ] Retrieval: question → `SearchIndex` + graph neighbourhood → bounded context with file:line citations
- [ ] Q&A panel: streaming answer, every claim cites `FileLink`s; label AI output distinctly from static facts
- [ ] AI-enhanced summaries (Orientation, module descriptions) clearly marked as AI-generated, with static fallback
- [ ] Service worker: confirm cross-origin AI requests bypass cache; offline still works with AI off
- [ ] Tests with a mocked provider (unit + e2e); no real key in CI

## M12: Scale hardening, robustness, performance, polish

- [ ] Scale benchmark: `gen:synthetic` 10k / 50k / 100k files → time per phase, peak memory, IndexedDB size → QUALITY.md
- [ ] Robustness tests: malformed ZIP, zip bomb guard, binary disguised as text, deeply nested dirs, huge single file,
      invalid UTF-8, storage quota exceeded, worker crash mid-run, cancel mid-run
- [ ] Git stage memory (see M9 follow-ups) and time on 5k+ file repos with long histories
- [ ] Performance: profile UI-thread helpers (D22). Move to the worker if a frame is >100 ms on the 50k repo;
      virtualize long tables
- [ ] Browser matrix check: Chrome, Firefox, Safari (folder picking, nested workers, File System Access fallback)
- [ ] Final polish, README screenshots (after U2), deploy guide

## U2: Visual redesign + rename to imex

Approved direction (D27): warm palette, everything in Geist Mono, terracotta accent, role colours.
Reference mockup: [docs/design/u2-mockup.html](design/u2-mockup.html) (open it in a browser; ☾ toggles dark mode).
Build in slices, each with a phase review.

**Slice 1: Tokens, type, icons**
- [ ] Replace the tokens in `src/index.css` with the mockup palette (light: cream `#faf9f5` page, white cards,
      warm greys, `#141413` text, `#d97757` accent; dark: warm `#1a1918` page). Keep the token names where roles match
- [ ] Add role tokens `--r-route/service/model/test/int/config` + a radius scale (8 / 12 / 16) + label style (mono uppercase)
- [ ] Bundle Geist Mono via `@fontsource` (no Google Fonts request; privacy rule). It is the only typeface
- [ ] Icon set (`lucide-react`, bundled) replacing the one-off inline SVGs
- [ ] CONVENTIONS § UI: new tokens, type scale, role colours, label style

**Slice 2: App shell + kit**
- [ ] Top bar (logo mark, privacy pill, round theme button), sidebar (mono group labels, raised selected item, counts)
- [ ] `kit.tsx`: `Page` (eyebrow label, large title), `Card` (16 px radius, header row), `Stat` (big number + sparkline),
      `Badge`/role pill, `ConfBadge` (mono, solid/dashed/dotted border), filter chips, buttons (dark primary, accent CTA)
- [ ] Tables: mono uppercase headers, file paths with dimmed directory, risk bars
- [ ] Skeleton loaders instead of "Loading…"; empty states with a short explanation

**Slice 3: Diagrams**
- [ ] `Graph.tsx`: read all colours from CSS tokens at runtime (no hex), restyle on theme change
- [ ] Nodes: role dot, name + subtitle (role · size), soft folder boxes with mono labels top-left, dimmed unresolved nodes
- [ ] Focus mode: selecting a node highlights its neighbourhood in accent, fades the rest; edge-count pills
- [ ] Right-angle edges for ELK layouts; solid / dashed / dotted = resolved / heuristic / unresolved
- [ ] Overlays: zoom + fit controls, legend, minimap; dot-grid canvas background; label level-of-detail by zoom
- [ ] Mermaid: `base` theme with `themeVariables` from tokens and Geist Mono (export/print still SVG)

**Slice 4: Views**
- [ ] Home: hero, drop zone, sample project button using a bundled fixture
- [ ] Restyle every view (Orientation, System map, Flows, Data, Symbols, Health, Deps, Impact, History, Export, Search)
- [ ] Consistent page headers for full-bleed views (System map, Flows) with `Page`-style title + intro

**Rename C-Ray → imex** (imex = import/export)
- [ ] UI strings, `<title>`, `index.html`, `package.json` name, `vite.config.ts` (PWA manifest), README, CLAUDE.md, docs
- [ ] Export headers/filenames in `src/core/report.ts` and `ExportView.tsx`
- [ ] IndexedDB name in `src/db/db.ts` and storage keys in `store.ts`: migrate or keep the old DB name so saved
      projects don't disappear (decide in DECISIONS); update `m1-persistence.spec.ts`

**Carried over from the old U2 list**
- [ ] Responsive: collapse side nav to icons/drawer below ~900 px; source panel as overlay on narrow screens
- [ ] `Graph.tsx`: replace hard-coded hex colours (`#d97706`, `#dc2626`, …) with values read from CSS tokens
- [ ] Keyboard navigation for list+detail views (↑/↓ in Flows/Data lists, `/` to focus search)
- [ ] Home page: richer empty state (what you'll get, sample project button using a bundled fixture)
- [ ] Contrast audit of all token pairs in both themes (WCAG AA)
- [ ] Consistent page headers for full-bleed views (System map, Flows) with `Page`-style title + intro

---

## Backlog / ideas (unscheduled)

- [ ] Show `analysis.timings` per stage somewhere (debug panel) to help performance work
- [ ] Compare two stored projects (or two analyses of the same project) side by side
- [ ] More languages for L2-grade precision (e.g. Python via a type-inference pass)

## Known issues

Add bugs here with a one-line repro.

- [ ] **Check:** `marked` does not sanitize link URLs. Confirm that a `javascript:` URL can't reach report Markdown
      from analysed code (e.g. via a README link or symbol name). If it can, add a link renderer that drops unsafe schemes.
