# C-Ray — engineering notes

## Milestone checklist

- [x] M1  Scaffold, worker architecture, ingestion (file/folder/ZIP), filtering, L0, IndexedDB persistence, orientation page
- [x] M2  L2 TypeScript graph, zoomable system map, search
- [ ] M3  L1 tree-sitter for all languages, confidence labelling, L1-vs-L2 benchmark
- [ ] M4  Framework detectors + flow tracer
- [ ] M5  Dependency intelligence + hotspots & health
- [ ] M6  Impact analysis
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
| 11 | Theme preference lives in `localStorage`; everything else in IndexedDB. | Avoids a flash of the wrong theme before IndexedDB opens. |

## Known limitations

(Updated per milestone — see the end of this file.)

## Benchmarks

(Recorded in M3 and M12.)
