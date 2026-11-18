# Decisions

A log of choices made while building C-Ray, so they don't get re-argued. **Append only:** to change a decision, add a
new entry that supersedes the old one and mark the old one `Superseded by D<n>`.

Template:

```
## D<n>: <short title>
- **Date / phase:** YYYY-MM-DD · Mn
- **Status:** Accepted | Superseded by D<n> | Revisit in Mn
- **Context:** what forced a choice
- **Decision:** what we chose
- **Why:** the reasons
- **Alternatives rejected:** what else was considered, and why not
```

D1–D17 were taken during M1–M7 (2026-11-16 → 17) and moved here from the old NOTES.md (numbering kept, order fixed).
D18–D24 record choices that were already in the code but never written down.

---

## Product principles

## D18: Three analysis tiers with explicit confidence labels
- **Date / phase:** 2026-11-16 · M1–M3 (written down 2026-11-18)
- **Status:** Accepted
- **Context:** Static analysis across 13 languages can't be equally precise everywhere.
- **Decision:** L0 (files/manifests), L1 (tree-sitter + heuristics), L2 (compiler-exact, TS/JS). Every inferred fact
  carries `resolved` / `heuristic` / `unresolved` and a source location, and the UI always shows it.
- **Why:** Users can only trust an explainer that says how sure it is. It also lets us measure L1 against L2 (QUALITY.md).
- **Alternatives rejected:** One "best effort" tier with no labels, which would quietly mislead users.

## D19: Fully client-side, no backend
- **Date / phase:** 2026-11-16 · M1 (written down 2026-11-18)
- **Status:** Accepted
- **Context:** Users analyse private codebases.
- **Decision:** Static site; all work in Web Workers; IndexedDB for storage; no telemetry. Future network features are opt-in only.
- **Why:** Privacy is the main selling point, and the site can be hosted anywhere for free.
- **Alternatives rejected:** A server-side analyzer, which would be faster on huge repos but needs uploads and hosting costs.

## Platform and tooling

## D1: TypeScript pinned to 5.9.x
- **Date / phase:** 2026-11-16 · M2 · **Status:** Accepted (revisit if TS 7 ships a JS API)
- **Decision:** Pin `typescript` to 5.9.x, not current `latest` (7.x).
- **Why:** TypeScript 7 is the native (Go) compiler and ships no JavaScript compiler API. L2 needs `ts.createProgram` +
  the type checker inside a Web Worker, which only the 5.x/6.x JS implementation provides.

## D2: web-tree-sitter 0.22.6 + `tree-sitter-wasms` prebuilt grammars
- **Date / phase:** 2026-11-16 · M3 · **Status:** Accepted
- **Why:** The prebuilt grammar WASMs are ABI 14 and load reliably with 0.22.x. All 13 grammars were verified to load in Node.

## D3: SQL parsed by a hand-written tokenizer, not tree-sitter
- **Date / phase:** 2026-11-17 · M7 · **Status:** Accepted
- **Why:** No prebuilt SQL grammar WASM exists in `tree-sitter-wasms`. The only maintained grammar
  (`@derekstride/tree-sitter-sql`) ships C source at ABI 15, and compiling it needs emscripten/Docker. We only need DDL
  (tables, columns, FKs, indexes), which the tokenizer handles.

## D4: Core analysis is isomorphic (`src/core`, no DOM)
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Why:** The same pipeline runs in the browser worker and in Node, so every planted-truth test exercises the real
  analysis code, not a mock.

## D20: Pluggable pipeline stages that degrade independently
- **Date / phase:** 2026-11-16 · M1 (written down 2026-11-18) · **Status:** Accepted
- **Decision:** Analysis after L0 is a list of `Stage`s (`graph` / `deep` phase). Each runs inside `time()`; an exception
  becomes a notice and the run continues. The UI receives a snapshot after L0, after the graph phase, and at the end.
- **Why:** One broken detector must not cost the user the whole analysis, and progressive snapshots make large repos feel fast.

## Architecture

## D5: Project identity = hash of the project name; `contentHash` stored separately
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Context:** The spec asked both for "keyed by project (content hash)" and for incremental re-analysis when the same
  project is re-dropped with changes.
- **Decision:** Same name → same project slot. Per-file hashes decide what is re-parsed; `contentHash` says whether anything changed.
- **Alternatives rejected:** Keying by pure content hash, which makes a changed project a *different* project and defeats the cache.

## D6: Coordinator worker + nested pool of parse workers
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Why:** Keeps all heavy work off the UI thread. The pool falls back to inline processing if nested workers are
  unavailable and replaces a crashed or hung worker. Cancel = terminate the coordinator.

## D7: Ignored directories recorded as one "skipped" row per directory
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Why:** A `node_modules` with 80k files would otherwise produce 80k rows. Folder walks in the UI prune ignored
  directories without enumerating them.

## D8: `.gitignore` applied after reading, not before
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Why:** ZIPs are streamed, so a `.gitignore` can arrive after the files it covers. This keeps one code path for folders and ZIPs.

## D9: Re-analyze re-reads the folder if a handle exists, else uses stored sources
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Why:** A static site cannot re-read a dropped folder later; stored sources make "Re-analyze" work everywhere. If
  sources were dropped (quota), the user is told to re-drop.

## D10: Offline via a small generated service worker that precaches the build output
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Why:** "Works offline after load" must include lazily loaded chunks (grammars, TS compiler, Mermaid). The worker
  never touches cross-origin requests.

## D11: Theme preference in `localStorage`; everything else in IndexedDB
- **Date / phase:** 2026-11-16 · M1 · **Status:** Accepted
- **Why:** Avoids a flash of the wrong theme before IndexedDB opens (an inline script in `index.html` applies it).

## D12: Parse time limit enforced by chunked input, not `setTimeoutMicros`
- **Date / phase:** 2026-11-16 · M3 · **Status:** Accepted
- **Why:** The WASM build of tree-sitter 0.22 ignores `setTimeoutMicros` (verified: a 1 ms limit still parsed for 1.7 s).
  The source is fed in 16 KB chunks and the input is cut off at the deadline; the file is then listed as timed out.
  Extraction has its own deadline.

## D13: For TS/JS files, L2 definitions replace L1 definitions
- **Date / phase:** 2026-11-16 · M3 · **Status:** Accepted
- **Why:** Avoids mapping between two symbol tables. L1 results are kept only to measure accuracy. Files beyond the L2
  cap (default 4000) or the L2 time budget keep their L1 graph.

## D14: Unqualified cross-file calls in PHP/C/Go create a dependency edge even without an import
- **Date / phase:** 2026-11-16 · M3 · **Status:** Accepted
- **Why:** Legacy PHP relies on globals from files included elsewhere; without this the import graph misses real
  coupling. These edges are `typeref`/heuristic.

## D15: Detectors are regex/line scanners over source text plus the symbol table, not AST queries
- **Date / phase:** 2026-11-16 · M4 · **Status:** Accepted
- **Why:** One uniform plugin interface across 13 frameworks and 8 languages. Handlers are linked through L2 references
  when available (→ `resolved`) and by name through imports otherwise (→ `heuristic`). Non-literal route paths are
  recorded as `unresolved`, never guessed.

## D16: A definition's line is its name line, not its first decorator/annotation
- **Date / phase:** 2026-11-16 · M4 · **Status:** Accepted
- **Why:** Otherwise `@Get()` + `@UseGuards()` stacks and Java annotations shift every handler location.

## D17: Legacy PHP without a framework gets file-based routes
- **Date / phase:** 2026-11-16 · M4 · **Status:** Accepted
- **Decision:** Scripts with top-level request/output code that no other file includes become routes (`/index.php`,
  `/admin/export.php`). `switch ($_GET[...])` cases are listed as query-style sub-routes. Marked `heuristic`.
- **Why:** That is the actual routing model of such apps.

## D21: History via isomorphic-git over an in-memory file system
- **Date / phase:** 2026-11-17 · M9 (written down 2026-11-18) · **Status:** Accepted
- **Decision:** The uploaded `.git` folder is loaded into `MemFS`; isomorphic-git walks commits in the worker. Snapshots
  re-run a light pipeline (L1 + assemble), sharing parse results by blob hash.
- **Why:** The only way to read git history with no server. Blob-hash sharing keeps snapshot cost close to "changed files only".

## D22: On-demand views compute on the UI thread from the stored `Analysis`
- **Date / phase:** 2026-11-17 · M2–M8 (written down 2026-11-18) · **Status:** Revisit in M12
- **Decision:** Impact, flow tracing, map layout and export sections run in the UI from the in-memory analysis.
- **Why:** They are interactive and cheap on typical repos; a worker round-trip would add latency and complexity.
- **Revisit:** Move to the worker if M12 scale tests show frames longer than 100 ms.

## UI

## D23: UI stack: React 19 + one Zustand store + Tailwind v4 with CSS-variable tokens, no component library
- **Date / phase:** 2026-11-16 · M1 (written down 2026-11-18) · **Status:** Accepted
- **Why:** A small surface area, offline-friendly bundle, full control over density. Theming is done by swapping
  CSS variables under `.dark`. Shared building blocks live in `src/ui/kit.tsx`.

## D24: Cytoscape (+ ELK / fcose) for interactive graphs, Mermaid for document diagrams
- **Date / phase:** 2026-11-16 · M2/M7 (written down 2026-11-18) · **Status:** Accepted
- **Why:** Cytoscape handles large, zoomable, clustered graphs (System map, dependencies). Mermaid produces text
  diagrams that also travel into Markdown / Notion exports and print as SVG.

## D25: UI refresh: grouped navigation and one soft "selected" treatment
- **Date / phase:** 2026-11-18 · U1
- **Status:** Accepted
- **Context:** Review of the UI: a flat 10-item nav, solid-accent selected states competing with primary buttons,
  grey severity badges (high didn't read as urgent), an ambiguous "Dark/Light" text toggle, unexplained nav counts.
- **Decision:** Nav grouped into Understand / Assess / Explore / Share, with an accent bar on the active item. The
  `.is-selected` class (soft accent tint) is used for every selected nav item, list row and filter chip. Tinted
  `-soft` tokens for badges, an icon theme toggle with aria-label, a privacy pill, tooltips on nav counts, tabular numbers.
- **Why:** Hierarchy and scanability, with no new dependencies and no test-ID churn. Solid accent is now reserved for primary actions.
- **Alternatives rejected:** A full redesign or a component library, which costs too much mid-roadmap. Revisit in U2.

## D27: U2 visual direction: warm palette, all-mono type; app renamed to imex
- **Date / phase:** 2026-11-18 · U2 (planning)
- **Status:** Accepted (supersedes the "revisit in U2" note in D25)
- **Context:** The U1 UI is clean but generic: system fonts, stock Tailwind blue, a graph palette hard-coded apart
  from the app tokens, Mermaid's stock themes, identical graph nodes. Two mockups were compared: a dark "X-ray" look
  (navy + cyan) and a warm, editorial light look modelled on claude.com/features/artifacts.
- **Decision:** The warm look, with Geist Mono as the only typeface. Cream/warm-grey surfaces,
  `#141413` text, terracotta `#d97757` accent for focus and calls to action, muted role colours shared by badges,
  graph nodes and charts. Graph and Mermaid colours come from the same tokens. Reference: `docs/design/u2-mockup.html`.
  The app is renamed from C-Ray to **imex** (import/export).
- **Why:** Calm and readable for long reading sessions, distinct from typical dev-tool dark UIs; a mono face fits a
  code tool and keeps paths and prose in one voice. Fonts are bundled, so the privacy rule holds.
- **Alternatives rejected:** "X-ray" dark-first (memorable but heavier, glow effects fight with dense tables);
  a serif + sans pairing (tried in the mockup; owner preferred all-mono).

## Process

## D26: Living docs + Definition of Done, enforced by a Stop hook
- **Date / phase:** 2026-11-18 · docs
- **Status:** Accepted
- **Decision:** `CLAUDE.md` (rules), `docs/` (TODO, DECISIONS, ARCHITECTURE, FLOWS, CONVENTIONS, DEFINITION_OF_DONE,
  QUALITY), updated in the same commit as code. `.claude/hooks/docs-check.sh` blocks a Claude turn once if `src/` or
  `tests/` changed with no doc change. NOTES.md removed so nothing is duplicated.
- **Why:** Sessions start cold. Without a central, current record, decisions and remaining work get lost.
- **Alternatives rejected:** A single NOTES.md, which mixed checklist, decisions and benchmarks and was already drifting.
