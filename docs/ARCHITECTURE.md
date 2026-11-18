# Architecture

imex (formerly C-Ray) is a **static site**. There is no backend: ingestion, parsing, analysis, persistence and export all
happen in the browser tab. The same analysis code also runs in Node for tests and benchmarks.

## Layers at a glance

```mermaid
flowchart LR
  subgraph Main["UI thread"]
    UI["React views<br/>src/ui"] --> Store["Zustand store<br/>src/store/store.ts"]
    Store --> Client["Worker RPC client<br/>src/workers/client.ts"]
    UI -. "cheap, on demand" .-> CoreUI["core helpers:<br/>impact · flow · mapview · report"]
  end
  subgraph Coord["Coordinator worker (analysis.worker.ts)"]
    Pipe["runPipeline<br/>src/core/pipeline.ts"] --> Stages["stages<br/>src/core/stages.ts"]
    Search["SearchIndex<br/>(MiniSearch)"]
  end
  subgraph Pool["Parse workers (pool.ts → parse.worker.ts)"]
    L1["scan + L1 tree-sitter"]
  end
  L2W["L2 worker<br/>(TypeScript compiler)"]
  DB[("IndexedDB<br/>src/db/db.ts")]
  Client <-->|"postMessage RPC<br/>protocol.ts"| Pipe
  Pipe --> Pool
  Stages --> L2W
  Pipe <--> DB
  Store <--> DB
```

## Directory map

| Path | Owns | Notes |
|---|---|---|
| `src/core/` | All analysis logic. **Isomorphic**: no DOM. | Runs in workers and in Node tests. |
| `src/core/types.ts` | The `Analysis` model and every shared type. | Bump `ANALYSIS_VERSION` on breaking shape changes. |
| `src/core/pipeline.ts` | `runPipeline`: ingest → per-file scan/L1 (cached) → L0 → plugged-in stages → snapshots. | Each stage wrapped in `time()`: failures become notices. |
| `src/core/stages.ts` | The ordered stage list (`defaultStages`) + `gitStage`. | Add new analysis here. |
| `src/core/ingest/` | Reading files/folders/ZIPs, ignore rules, binary/minified/generated detection, budgets. | Skips are recorded with a reason. A shared root folder is stripped, except for memory sources with `keepPaths` (git snapshots). |
| `src/core/packages.ts` | `workspacePackages`: package.json names + entry (`source`/`main`/`module`/`exports["."]`) for L1 and L2 resolution. | D31 |
| `src/core/l0/` | L0: languages, LOC, manifests, configs, docs, tech-stack detection. | No parsing needed. |
| `src/core/l1/` | L1: tree-sitter extraction (13 grammars) + heuristic import/call resolver. | Confidence `heuristic` unless proven. |
| `src/core/l2/tsgraph.ts` | L2: TypeScript compiler API program → exact defs/imports/refs for TS/JS. | Replaces L1 for those files (D13). |
| `src/core/graph.ts` | Stages `l1Stage`, `l2Stage`, `accuracyStage` (L1-vs-L2), `assembleStage`. | Builds `symbols / imports / refs`. |
| `src/core/detect/` | Framework detectors (Express, Fastify, Nest, Next, React, Django, Flask, FastAPI, Spring, Laravel, PHP pages, Rails, Go http, ASP.NET) + generic facts. | Regex/line scanners + symbol table (D15). |
| `src/core/flow.ts` | Request/flow tracer from an entry point. | Called by the UI on demand. |
| `src/core/schema.ts` | Data-model reconstruction from 11 ORM/DDL sources, ER → Mermaid, entity read/write map. | SQL via hand tokenizer (D3). |
| `src/core/deps.ts` | Cycles, coupling metrics, god modules, layering violations, packages. | |
| `src/core/health.ts`, `scan.ts` | Findings: size, complexity, nesting, clones, dead exports, TODOs, secrets, eval, SQL concat, TLS. | |
| `src/core/impact.ts` | Transitive dependents, affected entries/tests, risk score. | Called by the UI on demand. |
| `src/core/git/` | `analyze.ts`: history from an uploaded `.git` via isomorphic-git over an in-memory FS (`memfs.ts`): churn, authors, bus factor, co-change (+ `linked`, D29/D31), renames (D32, history merged under the current name), message types, snapshots (D30), hotspot findings. `diff.ts`: `diffSnapshots` for time-travel (no isomorphic-git import, so the UI and report can use it). | Loaded lazily by `gitStage`. |
| `src/core/orientation.ts`, `roles.ts` | Summary, architecture-style guesses, "read these first", file roles. | Re-run after each phase. |
| `src/core/report.ts` | Markdown / Notion pages / diagrams for export. | |
| `src/core/search.ts` | Symbol + full-text search index. | Built lazily in the coordinator. |
| `src/core/node-env.ts` | Node implementation of the pipeline environment (tests/bench). | |
| `src/workers/` | `analysis.worker.ts` (coordinator), `pool.ts` + `parse.worker.ts` (parsing), `l2.worker.ts`, `protocol.ts`, `client.ts`. | |
| `src/db/db.ts` | IndexedDB stores: `projects`, `analyses`, `sources`, `cache`, `settings`, `handles`. | Retention + quota handling. |
| `src/store/store.ts` | Single Zustand store: app status, settings, current analysis, tab, source panel, cross-view focus. | |
| `src/ui/` | React views (one per tab), `kit.tsx` (shared components, `PageGroup` context, `listKeys`), `Graph.tsx` (Cytoscape + zoom/legend/minimap overlays, colours from tokens, D35), `Mermaid.tsx` (base theme from tokens), `SourcePanel.tsx`, `icons.ts` (lucide icon per tab), `Logo.tsx`, `sample.ts` (bundled sample project, lazy chunk), `markdown.ts` (report Markdown → HTML: raw HTML escaped, unsafe URL schemes dropped; DOM-free, unit-tested). | |
| `scripts/copy-assets.mjs` | Copies grammar WASMs + TS lib `.d.ts` into `public/` (pre-dev/build/install). | Generated, git-ignored. |
| `scripts/contrast-audit.mjs` | `npm run audit:contrast`: WCAG ratios of the token pairs in `src/index.css`, both themes (D34). | Exits 1 below AA. |
| `vite.config.ts` | Build + `offlinePlugin` that generates `sw.js` precaching all assets. | |
| `tests/` | `unit/` (Vitest, Node), `e2e/` (Playwright), `bench/`, `fixtures/` (6 planted-truth projects + `git-history` + `git-moves` ground truth), `git-fixture.ts` (builds the git-history and git-moves repos at test time, D28). | |

## Analysis model

`Analysis` (in `types.ts`) is one serialisable object per project. Key fields:
`files`, `skipped`, `coverage`, `l0`, `symbols`, `imports`, `refs`, `frameworks`, `routes`, `entries`, `facts`,
`schema`, `deps`, `findings`, `git` (`GitResult` or `null`; `gitMessage` says why it is null), `decisions` (M10, empty today), `orientation`, `notices`, `timings`, `stage`.

`stage` moves `l0 → graph → done`; the UI renders whatever is available (progressive snapshots).

### Analysis tiers and confidence

| Tier | Source | Confidence |
|---|---|---|
| L0 | File names, manifests, configs, text scan | `resolved` for declared facts, `heuristic` for inferred |
| L1 | tree-sitter syntax trees (all 13 languages) + name-based resolver | `heuristic` |
| L2 | TypeScript compiler API + type checker (TS/JS only, ≤4000 files) | `resolved` |
| L0-git | `.git` objects via isomorphic-git | `resolved` (history facts) |

Anything that cannot be determined statically is recorded as `unresolved`, never guessed.

## Stage order (`defaultStages`)

`graph` phase: `l1Stage` → `l2Stage` + `accuracyStage` (browser/with L2) → `assembleStage` → `detectStage` → `schemaStage` → `depsStage` → `healthStage`
`deep` phase: `gitStage`

(The `phase` field decides which snapshot a stage's output appears in.) Adding a stage = implement `Stage` and insert
it in `defaultStages`; it gets timing, error isolation and progress for free.

## Worker protocol (`protocol.ts`)

Requests: `analyze`, `reanalyze`, `open`, `source`, `search`, `occurrences`, `exportJson`, `close`.
Events streamed back during a request: `progress`, `snapshot`. Errors carry `userFacing` so the UI can show them as-is.
Cancel = terminate the coordinator worker (the client re-creates it).

## UI shell

`App` (56 px top bar: logo, project crumb, privacy pill, theme; banners) → `Home` (hero, drop zone, sample project,
feature strip, settings, stored projects) or `ProjectView` (grouped side nav with icons, an icon rail below 900 px;
current view wrapped in `PageGroup` so `Page` shows the group as its eyebrow; `SourcePanel`, an overlay below
1100 px). `ProjectView` also owns the `/` shortcut (focus `[data-search-focus]` or open Search). Tabs are declared in `TABS` in `ProjectView.tsx` with a `group` (Understand / Assess / Explore / Share; History
sits in Assess after Impact);
`projectOnly` tabs are hidden in File Mode. Views read `analysis` from the store; cross-view navigation uses
`setTab(tab, focus)`.

## Persistence

Per project: metadata, the `Analysis`, sources (chunked; dropped first when quota is hit), and the per-file parse
cache keyed by content hash (incremental re-analysis). Project id = hash of the name (D5). Retention: 1d/7d/30d/forever.
Theme is in `localStorage` under `imex-theme` (D11, D33). The IndexedDB name is still `c-ray` (D33).
