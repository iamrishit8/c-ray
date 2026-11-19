# TODO and roadmap

The single source of truth for what's done, what's next and what's left. Update it in the same commit as the work.
Statuses: `[ ]` open · `[~]` in progress · `[x]` done. Each milestone is done only per DEFINITION_OF_DONE.md.

## Now

**U2: Visual redesign + rename to imex is done, waiting for owner review** (2026-11-19; owner approved going
straight through all slices with one review at the end). M9 follow-ups and the `marked` link check were fixed first
(see M9, Known issues). To confirm in review: D34 (dark text on terracotta buttons instead of the mockup's white).
Owner approved U2 on 2026-11-19 and asked for one more visual phase first: **U3 (motion + codebase
visualisations) is planned below and waiting for plan approval.** M10 starts after U3.

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
| M9 | Git layer: churn, co-change, bus factor, time-travel | ✅ 2026-11-18 |
| U3 | Motion + codebase visualisations (treemap, dependency matrix, hotspot map, activity heatmap, animated flows) | 📝 planned, awaiting approval |
| M10 | Decisions view + onboarding guide + generated docs | ⬜ |
| M11 | AI Q&A (bring-your-own key) + AI-enhanced summaries | ⬜ |
| M12 | Scale hardening, robustness tests, performance pass, polish | ⬜ |
| U2 | Visual redesign (warm palette, mono type, new diagrams) + rename to **imex** | ✅ 2026-11-19 |

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

**Follow-ups** (fixed 2026-11-19, at the start of U2)
- [x] Peak memory: profiled. The pack cache retains nothing; the git stage retains ≈50 MB heap + ≈50–65 MB
      buffers on fastify and nothing afterwards. The old 0.5–0.8 GB was the process baseline (QUALITY.md, D32)
- [x] Test ↔ code co-change shown as hidden coupling: `require('..')` and self-imports now resolve through
      `package.json` `main`/`exports` (also fixed `main: x.js` resolving to `x.d.ts`); tests link at any depth (D31).
      Fastify: 25 → 7. Planted truth: `tests/fixtures/git-moves`
- [x] Rename detection: exact + similarity renames (D32), history merged under the current name, "Renamed and
      moved files" card in History and table in the export

## U3: Motion + codebase visualisations (planned, awaiting approval)

Goal: make the codebase easier to *see*. Motion only where it explains something (what changed, where to look, how
things connect), and new pictures of the code that the tables and the node graph can't give. Everything stays local,
uses the U2 tokens, and has a plain fallback.

**Ground rules (become a DECISIONS entry on approval)**
- Motion has a job: show a transition, draw the eye, or play back a sequence. No decorative looping animation.
- `prefers-reduced-motion` turns every non-essential animation off, and the app stays fully usable without motion.
- Only `transform` / `opacity` / SVG dash offsets are animated. Graph animations switch off above 200 visible nodes.
- No animation library. CSS + Web Animations API + View Transitions API (with a no-op fallback). For layouts, either
  `d3-hierarchy` (≈ 10 KB, tree-shaken) or a hand-written squarified treemap (decided in slice 2).
- Layout maths (treemap, matrix ordering, buckets) lives in `src/core/viz/*` as pure, bounded, Node-tested
  functions. Rendering stays in `src/ui`. Every visual links back to files, and inferred values show their confidence.
- Each new picture has a table or list fallback, an accessible name/summary, and `data-testid`s.

**Slice 1: Motion foundation** (makes the whole app feel alive, little risk)
- [ ] Motion tokens in `index.css`: `--dur-1/2/3` (120 / 200 / 320 ms), `--ease-out`, `--ease-spring`, plus a global reduced-motion rule
- [ ] View changes: View Transitions API cross-fade + slight rise between tabs; the nav highlight slides to the selected item
- [ ] Enter motion: cards fade up in a short stagger on first render of a view (once, not on every re-render)
- [ ] `Stat` numbers count up; `Sparkline` draws in; `RiskBar` / language bars grow from 0
- [ ] Skeleton → content cross-fade; source panel slides in/out; chips/buttons press feedback; focus-ring transition
- [ ] **Analysis progress, redesigned**: a stepper (Read files → Parse → Graph → Detect → Schema → Health → History) that
      advances with the real pipeline stages, plus a live "file wall": one tile per file, coloured by language as it is parsed
- [ ] Unit: none (pure CSS/UI). E2E: reduced-motion emulation leaves no running animations; tab switch still works

**Slice 2: New codebase visualisations** (the "graphics" part)
- [ ] **Codebase treemap** (new hero card on Orientation): directories → files sized by lines. Colour modes: role, language,
      complexity, churn (with history). Click to drill into a folder with an animated zoom, breadcrumb to go back,
      hover card with path, size, role and confidence, double-click opens the source
- [ ] **Dependency matrix (DSM)** on Dependencies: module × module heat-map of import counts, ordered so layers read
      top-down; cycles outlined in `--bad`, layering violations in `--warn`; click a cell to list the imports behind it
- [ ] **Hotspot map** on Health: scatter of complexity (y) × churn (x), bubble size = lines, role colour, the
      "risky" top-right quadrant shaded. Without `.git`: complexity × fan-in, with a note
- [ ] **Commit activity heat-map** on History: GitHub-style calendar of commits per day, plus a per-author timeline strip
- [ ] **Language / role breakdown**: stacked bar or donut on Orientation, replacing the plain language bars
- [ ] `src/core/viz/`: `treemap.ts` (squarified, ≤ 5 000 cells, rest grouped as "other"), `matrix.ts` (module
      ordering + cell aggregation), `calendar.ts` (day buckets, time zone safe), `scatter.ts` (quadrant thresholds).
      Unit tests `u3-viz.test.ts` with planted truth on the fixtures (e.g. express-mongoose: the cycle shows as a
      symmetric pair of cells; the git-history calendar has 12 commit days)

**Slice 3: Diagrams that move**
- [ ] System map: animated expand/collapse (nodes glide from the cluster's position), "marching ants" on the edges of
      the focused node, pulse when a search result is located on the map
- [ ] System map: **size by** (lines / fan-in) and **colour by** (role / language / complexity / churn) controls
- [ ] System map: **path finder**: pick two files to highlight the shortest import path between them, step by step
- [ ] Flows: **playback**: ▶ steps through the trace, highlighting each step in the list and the graph in sync, with a
      dot travelling along the edge (the mockup's dashed "flow" line); pause / step / speed
- [ ] Impact: **blast radius** picture: radial rings by distance from the target, animated outward ripple, rings
      labelled "direct", "2 steps", …; tests and entry points marked
- [ ] History time-travel: **play through snapshots**: module graph and numbers morph from one snapshot to the next
- [ ] Data: in-app **interactive ER diagram** (entity cards with fields, relation lines with cardinality, click to
      focus); Mermaid stays for exports and print
- [ ] Export the current graph view as SVG/PNG (Cytoscape `png()`; SVG through the existing Mermaid path where possible)

**Slice 4: Illustration and polish**
- [ ] Home hero illustration: a small animated graph that assembles itself (inline SVG, token colours, static under
      reduced motion)
- [ ] Empty-state illustrations (no history, no data model, no entry points, no findings): one small inline SVG each
- [ ] Logo micro-interaction (arrows swap on hover / while analysing)
- [ ] Performance check: frame times while panning and focusing on a 500-node map, and while the treemap drills on
      the 10k-file synthetic project. Numbers go in QUALITY.md; anything over budget is turned off above a size cap
- [ ] E2E `u3-visuals.spec.ts`: treemap drill + breadcrumb, matrix cell → import list, hotspot point → file, calendar
      tooltip, flow playback reaches the last step, blast radius rings, ER focus, graph export downloads a file
- [ ] Docs: CONVENTIONS (motion tokens + rules, viz components), ARCHITECTURE (`src/core/viz`), DECISIONS (motion
      policy, layout library), QUALITY (frame-time numbers, limits), screenshots of each new picture in the phase review

**Out of scope:** 3D views (e.g. "code city" in WebGL), sound, and any animation that loops while idle.

**Open questions for the owner** (defaults in brackets)
1. Review cadence: one review at the end, or one per slice? [one per slice: this phase is more about taste]
2. 3D "code city" view: skip, or add as an optional experimental tab? [skip]
3. Is `d3-hierarchy` OK as a small new dependency? [yes, if the hand-written treemap gets fiddly]

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

## U2: Visual redesign + rename to imex ✅

Approved direction (D27): warm palette, everything in Geist Mono, terracotta accent, role colours.
Reference mockup: [docs/design/u2-mockup.html](design/u2-mockup.html) (open it in a browser; ☾ toggles dark mode).
Build in slices, each with a phase review.

**Slice 1: Tokens, type, icons**
- [x] Replace the tokens in `src/index.css` with the mockup palette. Surfaces now mean: `--bg` page, `--bg2` raised,
      `--bg3` hover/chips, `--bg4` tracks; new `--line2`, `--accent-hover`, `--accent-text` (accent as text, AA)
- [x] Role tokens `--r-route/service/model/test/int/config`, radius scale `--r-sm/md/lg` (8/12/16), `.label`
- [x] Geist Mono bundled via `@fontsource/geist-mono` (latin + latin-ext, 400/500/600); the only typeface
- [x] `lucide-react` icons (nav, theme toggle, privacy pill, close buttons)
- [x] CONVENTIONS § UI: tokens, type scale, role colours, label style, components

**Slice 2: App shell + kit**
- [x] Top bar (logo mark, privacy pill, round theme button), sidebar (icons, mono group labels, raised selected item, counts)
- [x] `kit.tsx`: `Page`/`PageHeader` (eyebrow from `PageGroup`, large title), `Card` (16 px radius, header row, `flush`),
      `Stat` (big number + `Sparkline`), `Badge`/`RoleBadge`, `ConfBadge` (mono), `Chip`, `RiskBar`, `Skeleton`,
      buttons (dark primary, accent CTA, round)
- [x] Tables: mono uppercase headers, file paths with dimmed directory (`PathText`, wraps at `/`), risk bars
      (`RiskBar`: hotspots, co-change score, instability, impact risk)
- [x] Skeleton loaders (app start, source panel, map preview, `Pending`); empty states with a title and next step

**Slice 3: Diagrams**
- [x] `Graph.tsx`: all colours from CSS tokens at runtime (`cssVar`), restyled in place on theme change
- [x] Nodes: role dot (SVG background), name + subtitle (role · size), soft folder boxes with mono uppercase labels
      (centred above the box: Cytoscape can't left-align compound labels inside), dashed + dimmed unresolved nodes
- [x] Focus mode: tapping a node highlights its neighbourhood in accent, fades the rest; edge-count pills
- [x] Right-angle (taxi) edges for ELK layouts; solid / dashed / dotted = resolved / heuristic / unresolved
- [x] Overlays: zoom + fit controls, legend (role colours present + edge styles), minimap (click/drag to pan);
      dot-grid canvas; label level-of-detail (`min-zoomed-font-size`); canvas waits for Geist Mono to load
- [x] Mermaid: `base` theme with `themeVariables` from tokens and Geist Mono (export/print still SVG)

**Slice 4: Views**
- [x] Home: hero, drop zone with icon, feature strip, **Try a sample project** (bundled `express-mongoose` fixture,
      lazy chunk, `sample-project` test id)
- [x] Restyle every view (Orientation, System map, Flows, Data, Symbols, Health, Deps, Impact, History, Export, Search):
      chips for filters, role badges, `.label` subheads, sparklines from git snapshots (Orientation, History)
- [x] Full-bleed views (System map, Flows) use `PageHeader` (eyebrow, title, intro) above the canvas/list

**Rename C-Ray → imex** (imex = import/export)
- [x] UI strings, `<title>`, favicon, `index.html`, `package.json` name, `vite.config.ts` (plugin + SW cache), README, CLAUDE.md, docs
- [x] Export headers/filenames in `src/core/report.ts` and `ExportView.tsx` (`<project>-imex.md`, `<project> imex report/`)
- [x] IndexedDB name kept as `c-ray` so saved projects survive; theme key `imex-theme` with fallback (D33);
      `m1-persistence.spec.ts` comments why

**Carried over from the old U2 list**
- [x] Responsive: icon-rail nav below 900 px; source panel as overlay below 1100 px (e2e at 820 px)
- [x] `Graph.tsx`: no hard-coded colours (tokens at runtime, D35)
- [x] Keyboard: ↑/↓/Home/End in the Flows and Data lists (`listKeys`), `/` focuses the view's filter or opens Search
- [x] Home: richer empty state + sample project
- [x] Contrast audit of all token pairs in both themes: `npm run audit:contrast`, all AA (D34, QUALITY.md)
- [x] Consistent page headers for full-bleed views

**Tests:** `tests/e2e/u2-ui.spec.ts` (branding + sample, theme key migration, keyboard, graph controls + focus mode,
narrow layout), renames e2e in `m9-history.spec.ts`. Suites: 164 unit (+1 opt-in bench), 25 e2e, all passing.

**Follow-ups**
- [ ] README screenshots (M12, now that the look is final)
- [ ] Phone-width layouts for the dense tables (card lists instead of tables) if mobile use matters
- [ ] Keyboard focus mode for graphs (Tab through nodes, Enter to focus) — today focus is mouse/touch only

---

## Backlog / ideas (unscheduled)

- [ ] Show `analysis.timings` per stage somewhere (debug panel) to help performance work
- [ ] Compare two stored projects (or two analyses of the same project) side by side
- [ ] More languages for L2-grade precision (e.g. Python via a type-inference pass)

## Known issues

Add bugs here with a one-line repro.

- [x] **Check:** `marked` does not sanitize link URLs (2026-11-19). **It could:** the project name (folder/ZIP
      name or `package.json` name) reached the Orientation summary unescaped, so `[x](javascript:…)` became a live link
      in the preview. Fixed twice: the report escapes the summary, and `src/ui/markdown.ts` drops unsafe link/image
      schemes (entity/whitespace/case obfuscation included). Tests in `m8-export.test.ts`
