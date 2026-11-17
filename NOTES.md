# C-Ray — engineering notes

## Milestone checklist

- [x] M1  Scaffold, worker architecture, ingestion (file/folder/ZIP), filtering, L0, IndexedDB persistence, orientation page
- [x] M2  L2 TypeScript graph, zoomable system map, search
- [x] M3  L1 tree-sitter for all languages, confidence labelling, L1-vs-L2 benchmark
- [x] M4  Framework detectors + flow tracer
- [x] M5  Dependency intelligence + hotspots & health
- [x] M6  Impact analysis
- [ ] M7  Database/schema reconstruction + data flow
- [ ] M8  Export (Markdown, Notion ZIP, PDF, JSON)
- [ ] M9  Git layer: churn, co-change, time-travel
- [ ] M10 Decisions view + onboarding guide + generated docs
- [ ] M11 AI Q&A (BYO key) + AI-enhanced summaries
- [ ] M12 Scale hardening, robustness tests, performance pass, polish

## Decisions made (autonomously)

| # | Decision | Why |
|---|----------|-----|
| 1 | **TypeScript pinned to 5.9.x**, not the current `latest` (7.x). | TypeScript 7 is the native (Go) compiler and ships no JavaScript compiler API. L2 needs `ts.createProgram` + the type checker running inside a Web Worker, which only the 5.x/6.x JS implementation provides. |
| 2 | **web-tree-sitter 0.22.6 + `tree-sitter-wasms` prebuilt grammars.** | The prebuilt grammar WASMs are ABI 14 and load reliably with 0.22.x. All 13 grammars were verified to load in Node. |
| 3 | **SQL is parsed by a hand-written tokenizer, not tree-sitter.** | No prebuilt SQL grammar WASM exists in `tree-sitter-wasms`; the only maintained grammar (`@derekstride/tree-sitter-sql`) ships C source at ABI 15 and compiling it needs emscripten/Docker, which were not available. SQL only needs DDL (tables, columns, FKs, indexes), which the tokenizer handles. |
| 4 | **Core analysis is isomorphic** (`src/core`, no DOM). | The same pipeline runs in the browser worker and in Node, so every planted-truth test exercises the real analysis code, not a mock. |
| 5 | **Project identity = hash of the project name**; `contentHash` is stored separately. | The spec asks both for "keyed by project (content hash)" and for incremental re-analysis when the same project is re-dropped with changes. Keying by pure content hash would make a changed project a *different* project and defeat the cache. So: same name → same project slot; per-file hashes decide what is re-parsed; `contentHash` tells whether anything changed. |
| 6 | **Coordinator worker + nested pool of parse workers.** | Keeps all heavy work off the UI thread; the pool falls back to inline processing if nested workers are unavailable and replaces a crashed/hung worker. Cancel = terminate the coordinator. |
| 7 | **Ignored directories are recorded as one "skipped" row per directory** (with a file count). | A `node_modules` with 80k files would otherwise produce 80k rows. Folder walks in the UI prune ignored directories without enumerating them. |
| 8 | **`.gitignore` is applied after reading** (not before). | ZIPs are streamed, so a `.gitignore` can arrive after the files it covers. One code path for folders and ZIPs. |
| 9 | **Re-analyze** re-reads from disk when the browser still holds a folder handle (File System Access API), otherwise re-runs on the stored source text. | A static site cannot re-read a dropped folder later; stored sources make "Re-analyze" work everywhere. If sources were dropped (quota) the user is told to re-drop. |
| 10 | **Offline** is provided by a small generated service worker that precaches the build output. | "Works offline after load" must include lazily loaded chunks (grammars, TS compiler, Mermaid). The worker never touches cross-origin requests. |
| 12 | **Parse time limit is enforced by chunked input**, not `setTimeoutMicros`. | The WASM build of tree-sitter 0.22 ignores `setTimeoutMicros` (verified: a 1 ms limit still parsed for 1.7 s). The source is fed in 16 KB chunks and the input is cut off at the deadline; the file is then listed as timed-out. Extraction has its own deadline. |
| 13 | **For TS/JS files, L2 definitions replace L1 definitions**; L1 results are kept only to measure accuracy. | Avoids mapping between two symbol tables. Files beyond the L2 cap (default 4000) or the L2 time budget keep their L1 graph. |
| 14 | **Unqualified cross-file calls in PHP/C/Go create a dependency edge** even without an import. | Legacy PHP relies on globals from files included elsewhere; without this the import graph misses real coupling. These edges are `typeref`/heuristic. |
| 15 | **Detectors are regex/line scanners over source text plus the symbol table**, not AST queries. | One uniform plugin interface across 13 frameworks and 8 languages; handlers are linked through L2 references when available (→ `resolved`) and by name through imports otherwise (→ `heuristic`). Non-literal route paths are recorded as `unresolved`, never guessed. |
| 16 | **A definition's line is its name line, not its first decorator/annotation.** | Otherwise `@Get()` + `@UseGuards()` stacks and Java annotations shift every handler location. |
| 17 | **Legacy PHP without a framework gets file-based routes** (`/index.php`, `/admin/export.php`): scripts with top-level request/output code that no other file includes. `switch ($_GET[...])` cases are listed as query-style sub-routes. | It is the actual routing model of such apps. Marked `heuristic`. |
| 11 | Theme preference lives in `localStorage`; everything else in IndexedDB. | Avoids a flash of the wrong theme before IndexedDB opens. |

## Known limitations

(Updated per milestone — see the end of this file.)

## Benchmarks

### L1 (tree-sitter, heuristic) vs L2 (TypeScript compiler, exact)

`npm run bench:l1l2` — L1 edges are scored against L2 edges on the TS/JS fixtures
(results are written to `tests/bench/l1-vs-l2.results.json`). The same measurement
runs on every analysed project that contains TS/JS and is shown on the Orientation page.

| Fixture | Import precision | Import recall | Call precision | Call recall | Import edges | Call edges |
|---|---|---|---|---|---|---|
| express-mongoose (CommonJS) | 100.0% | 100.0% | 84.6% | 100.0% | 22 | 11 |
| nestjs-prisma | 100.0% | 100.0% | 83.3% | 100.0% | 22 | 10 |
| monorepo | 95.3% | 100.0% | 90.0% | 69.2% | 41 | 26 |
| **All** | **97.7%** | **100.0%** | **86.7%** | **83.0%** | 85 | 47 |

Reading: L1 import edges are near-exact (they share the module resolver). L1 call edges are
right about 87% of the time and find about 83% of real calls; the misses are mostly calls
through re-exports and JSX usage across packages. These fixtures are small — treat the numbers
as indicative, and expect lower call recall on heavily dynamic code.

### Impact analysis vs. real compiler breakages

`tests/unit/m6-impact.test.ts` mutates four signatures/types in a copy of the monorepo fixture, runs
`tsc`, and compares the files that really fail to compile with the predicted dependents
(results in `tests/bench/impact.results.json`).

| Prediction set | Recall | Precision |
|---|---|---|
| Transitive dependents (what the Impact view lists) | 100% | 37.5% |
| Direct dependents only (distance 1) | see results file | see results file |

Reading: nothing that broke was missed. Precision is low by design — the transitive set is the
*behavioural* blast radius (callers of callers), while a signature change only breaks compilation
at direct use sites. The view groups dependents by distance so the direct ones are obvious.

### Scale

(Recorded in M12.)
