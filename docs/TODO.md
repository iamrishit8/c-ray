# TODO and roadmap

The single source of truth for what's done, what's next and what's left. Update it in the same commit as the work.
Statuses: `[ ]` open · `[~]` in progress · `[x]` done. Each milestone is done only per DEFINITION_OF_DONE.md.

## Now

**Current milestone: M9: Git layer (finish).** The engine is in (`src/core/git/`, commit 9e85fdc). What's missing is
the UI, tests and docs. After that comes M10.

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
| **M9** | **Git layer: churn, co-change, bus factor, time-travel** | 🟡 engine done, UI/tests pending |
| M10 | Decisions view + onboarding guide + generated docs | ⬜ |
| M11 | AI Q&A (bring-your-own key) + AI-enhanced summaries | ⬜ |
| M12 | Scale hardening, robustness tests, performance pass, polish | ⬜ |
| U2 | UI polish pass 2 (responsive, keyboard, graph tokens) | ⬜ (alongside M12) |

---

## M9: Git layer (finish)

Engine: `analyzeGit` produces `GitResult` (commits, churn, authors, bus factor, co-change, message types/keywords, tags,
≤10 architecture snapshots) + churn×complexity `hotspot` findings; `diffSnapshots` compares two snapshots.

- [x] History engine over an in-memory `.git` (isomorphic-git), wired in as `gitStage`
- [ ] **Test fixture with history**: helper that builds a small repo with isomorphic-git at test time (planted commits,
      authors, a co-changing pair, a single-owner file, a tag), plus a `ground-truth.json`
- [ ] **Unit tests** `tests/unit/m9-git.test.ts`: churn counts, authors, bus factor, co-change pairs/scores,
      `classifyMessage`, snapshot selection, `diffSnapshots`, hotspot findings; "no .git" and "corrupt .git" paths
- [ ] **History view** (`src/ui/HistoryView.tsx`, group *Assess*, `projectOnly`):
  - [ ] Overview stats: commits (truncated?), authors, bus factor, branch/head
  - [ ] Churn table (file, commits, authors, top author share, last change) with `FileLink`s + "Impact" jump
  - [ ] Co-change pairs (files that change together with no import between them = hidden coupling)
  - [ ] Bus-factor risk list (single-owner files)
  - [ ] Commit-type breakdown + top keywords
  - [ ] Empty state when no `.git` (explains how to include it)
- [ ] **Time-travel**: snapshot timeline → pick two → module/edge/hotspot diff (`diffSnapshots`), modules added/removed
- [ ] Health view: hotspots render correctly when history exists (verify with fixture)
- [ ] Export: add a "History" section to `report.ts` (Markdown + Notion + print)
- [ ] **E2E** `tests/e2e/m9-history.spec.ts`: upload fixture ZIP with `.git`, see churn/co-change/bus factor, diff two snapshots
- [ ] Measure on one real mid-size repo (time + memory); write numbers and limitations in QUALITY.md
- [ ] Docs: ARCHITECTURE (view, any protocol change), FLOWS §6, DECISIONS for any new choice

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
- [ ] Performance: profile UI-thread helpers (D22). Move to the worker if a frame is >100 ms on the 50k repo;
      virtualize long tables
- [ ] Browser matrix check: Chrome, Firefox, Safari (folder picking, nested workers, File System Access fallback)
- [ ] Final polish (see U2), README screenshots, deploy guide

## U2: UI polish pass 2

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
