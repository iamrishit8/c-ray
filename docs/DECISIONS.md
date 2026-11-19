# Decisions

A log of choices made while building imex (called C-Ray until U2), so they don't get re-argued. **Append only:** to change a decision, add a
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

## D29: "Hidden coupling" = co-change with no import path within 4 hops; test↔test pairs dropped
- **Date / phase:** 2026-11-18 · M9
- **Status:** Accepted
- **Context:** On express, 75 of 82 co-change pairs had no *direct* import between them. Most were test files
  changed together in suite-wide sweeps, or a test that reaches the code via `require('..')` → `index.js` → `lib/…`.
- **Decision:** A pair is `linked` if an import path of at most 4 steps exists in either direction at HEAD (bounded
  BFS over `imports`). Pairs where both files are tests are not recorded. The UI and report call unlinked pairs
  "hidden coupling" and label the interpretation `heuristic`; the counts themselves are exact.
- **Why:** A transitive path is real, visible coupling; only pairs with no path are surprising. On express this cut
  hidden-coupling pairs from 21 of 24 to 3 of 24; the remaining fastify pairs are mostly genuine (hand-written
  `.d.ts` files that must change with their `.js`).
- **Alternatives rejected:** Direct imports only (too noisy); unbounded reachability (in a connected app almost
  everything reaches everything, so nothing would ever be "hidden").

## D30: Snapshots always include the oldest analysed commit and share one module depth chosen at HEAD
- **Date / phase:** 2026-11-18 · M9
- **Status:** Accepted
- **Context:** Even spacing could skip the first commit, and each snapshot chose its own grouping depth, so a repo
  that grew from 3 to 6 folders was grouped differently over time and every module looked "added" in a diff.
- **Decision:** Snapshot picks are HEAD, the oldest commit in the window, the most recent tags (by commit time, at
  most `budget − 2`), then evenly spaced commits. The module depth is computed once from HEAD's files and used for
  every snapshot. Snapshot paths are kept repo-relative (`keepPaths` on the memory source) instead of stripping a
  shared root folder.
- **Why:** Time-travel diffs must compare like with like; "from the beginning to now" is the comparison people want first.
- **Alternatives rejected:** A per-snapshot depth (unstable diffs); storing every file per snapshot and grouping in
  the UI (bigger stored analysis for little gain).

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
- **Status:** Accepted (supersedes the "revisit in U2" note in D25; the all-mono typeface was superseded by D39)
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

## D28: Git test fixture is generated at test time with isomorphic-git
- **Date / phase:** 2026-11-18 · M9
- **Status:** Accepted
- **Context:** History tests need a repository with planted commits, but a nested `.git` folder cannot be committed
  to this repo, and binary packfiles in `tests/fixtures` would be opaque to review.
- **Decision:** `tests/git-fixture.ts` writes the `git-history` project commit by commit (fixed authors and
  timestamps, so commit ids are stable) into a temp folder and returns working tree + `.git/` as in-memory files.
  Unit tests feed those to `runPipeline`; e2e zips them. The planted facts live in
  `tests/fixtures/git-history/ground-truth.json`, written by hand from the history table.
- **Why:** The history is readable as code, deterministic, and exercises the same isomorphic-git reader as the app.
- **Alternatives rejected:** A committed `.git` renamed to `dot-git` (binary, hard to review, easy to break);
  mocking isomorphic-git (would not test the real reader).

## D31: A test is linked to any code it reaches; package directories resolve through `main`/`exports`
- **Date / phase:** 2026-11-19 · U2 (M9 follow-up) · **Status:** Accepted (refines D29 for pairs that include a test)
- **Context:** On fastify, 25 hidden-coupling pairs were a test and the code it exercises. Three causes:
  `require('..')` / `require('../..')` only tried `index.*` at the package root (Node uses `package.json` `main`);
  a declared `main: "fastify.js"` resolved to the sibling `fastify.d.ts` because the resolver stripped `.js` first;
  L1 never received `main` at all. And the 4-hop limit cut off long paths from a test into the code.
- **Decision:** (1) A relative import that lands on a directory with a `package.json` resolves through that
  package's entry, as in Node. (2) The entry is the declared file itself first, then extension variants, then
  defaults. `exports["."]` (string or conditions) counts as an entry when there is no `main`. L1 and L2 share
  `workspacePackages` (`src/core/packages.ts`). (3) In co-change, a pair that includes a test is `linked` if
  any import path exists; code↔code pairs keep the 4-hop limit from D29.
- **Why:** A test exercises everything it reaches, so a long path is real coupling. Code↔code keeps the limit
  because in a connected app almost everything reaches everything (D29's reason still holds there). On fastify,
  hidden test↔code pairs went from 25 to 7.
- **Alternatives rejected:** Unbounded reachability for every pair (makes "hidden" meaningless, see D29);
  treating `.d.ts` ↔ `.js` pairs as linked by name (they are real coupling the code doesn't express, D29).

## D32: Rename detection: exact blob match, then line similarity ≥ 50% within a bounded comparison budget
- **Date / phase:** 2026-11-19 · U2 (M9 follow-up) · **Status:** Accepted
- **Context:** isomorphic-git's `walk` has no rename tracking, so a moved file started with fresh churn and ownership.
- **Decision:** Per commit (first-parent, non-merge), pair deleted and added paths: same blob oid first
  (`resolved`, similarity 1), then same-extension pairs scored by line-multiset similarity (2·shared / total
  non-blank trimmed lines, like git's rename score), greedily by best score, ≥ 0.5 (`heuristic`). Only when there
  are at most 400 candidate pairs, and only blobs ≤ 512 KB and not binary. Walking newest → oldest, the old path
  is aliased to the current name, so older commits count toward the file as it exists at HEAD (chains collapse).
  `GitResult.renames` keeps up to 200 renames for the UI and report.
- **Why:** Git's own default (50% similarity) is the convention people know. The bounds keep bulk moves
  (vendoring, reformatting) from turning into O(n²) blob reads; exact renames are found regardless.
- **Alternatives rejected:** No rename tracking (wrong ownership for moved code); `git log --follow`-style
  per-file tracing (one walk per file, far too slow in a browser).
- **Memory investigation (same follow-up):** the suspected leak (isomorphic-git's pack `offsetCache`) holds
  nothing on real repos (it only caches deep delta bases). Rotating the cache saved no memory and cost time,
  so it was not kept. The old "0.5–0.8 GB" figure was mostly the Node + tree-sitter baseline. See QUALITY.md.

## D33: The rename to imex keeps the IndexedDB name `c-ray`; the theme key moves with a fallback
- **Date / phase:** 2026-11-19 · U2 · **Status:** Accepted
- **Context:** Renaming the database would hide every saved project unless a migration copied all stores
  (analyses and chunked sources can be hundreds of MB, and a half-finished copy under quota pressure loses data).
- **Decision:** `DB_NAME` stays `'c-ray'` (an internal name nobody sees). The theme preference is written to
  `imex-theme`; `index.html` reads `imex-theme`, then falls back to the old `c-ray-theme`. The service worker cache is
  renamed to `imex-<version>`; its activate step already deletes every other cache, including old `c-ray-*` ones.
  Everything user-visible says imex: title, header, reports ("— codebase report", "Generated by imex"), download
  names (`<project>-imex.md`, Notion root `<project> imex report`).
- **Why:** Zero risk to stored data, nothing to migrate, and no user-visible trace of the old name.
- **Alternatives rejected:** Open both DBs and copy (slow, quota-sensitive, needs its own failure handling);
  a fresh DB (silently drops saved projects).

## D34: Accessibility over the mockup in two places: dark text on terracotta, tinted badge text blended toward fg
- **Date / phase:** 2026-11-19 · U2 · **Status:** Accepted (owner to confirm in the U2 review)
- **Context:** The contrast audit (`npm run audit:contrast`, all token pairs, both themes) found that the mockup's
  white text on `#d97757` is 3.1:1, below AA for 13 px button labels, and that role/status colours as text on
  their own 10–16% tints were 3.3–4.5:1.
- **Decision:** `--accent-fg` is near-black `#141413` in light mode too (5.9:1, the same pairing dark mode uses);
  the logo arrows stay white via a decorative `--accent-mark`. Badge text is `color-mix(<hue> 78%, var(--fg))`
  (`--tint-text`), which darkens it in light mode and lightens it in dark mode while keeping the hue. Light
  `--accent-text` (accent used as text) is `#a94c33`; `--fg3` and `--warn` were darkened slightly from the mockup.
- **Why:** CONVENTIONS asks for AA on every text pair; these changes keep the palette's character.
- **Alternatives rejected:** A darker terracotta fill (changes the brand colour more than the text change does);
  thicker/bolder badge text (still fails for the lightest roles).

## D35: Graph rendering follows the tokens at runtime; overlays are React, not Cytoscape extensions
- **Date / phase:** 2026-11-19 · U2 · **Status:** Accepted
- **Decision:** `Graph.tsx` reads `--bg…`, `--r-*`, `--accent` with `getComputedStyle` when it builds the stylesheet
  and calls `cy.style()` again on theme change (layout, zoom and focus survive). Role dots are SVG data-URI
  backgrounds. Zoom/fit, legend and minimap are plain React overlays (the minimap draws node boxes on a canvas from
  `cy` on `viewport`/`render` events). Canvas waits (≤ 1.5 s) for Geist Mono, because canvas text never swaps fonts.
  Mermaid uses its `base` theme with `themeVariables` from the same tokens. Print switches to the light theme
  for the duration of the print dialog (paper is white).
- **Why:** One palette for everything without new dependencies; Cytoscape navigator/minimap plugins are unmaintained
  and would add another styling system.
- **Alternatives rejected:** Two hard-coded palettes in `Graph.tsx` (what U1 had; drifted from the tokens);
  `cytoscape-navigator` (old, DOM-thumbnail based, slow on 500 nodes).

## D36: Motion policy: purposeful, CSS-first, off under reduced motion; no animation library
- **Date / phase:** 2026-11-19 · U3 slice 1 · **Status:** Accepted
- **Context:** U3 adds motion to make the codebase easier to see. Motion can also make a dense tool tiring, slow
  on big graphs, and inaccessible for people who get motion sick.
- **Decision:** Motion must have a job: show a transition, draw the eye, or play back a sequence. Nothing loops
  while idle (the graph's "marching ants" stop after 1.6 s). Tokens `--dur-1/2/3` (120/200/320 ms), `--ease-out`,
  `--ease-spring`. Only `transform`, `opacity` and SVG dash offsets are animated. Tools: CSS keyframes, the Web
  Animations API and the View Transitions API (tab changes, via `setTab` in the store; plain state change where it
  is unsupported). `prefers-reduced-motion: reduce` turns every animation and transition off with one global rule,
  and JS-driven motion checks `reducedMotion()` (`src/ui/motion.ts`). Graph animations switch off above 200 nodes
  (`ANIMATE_MAX_NODES`). Enter animations use `fill-mode: backwards`, never `both`: a filled transform keeps a
  stacking context and lets later cards cover dropdowns (found in the Impact suggestions list).
- **Why:** No new dependency, nothing to load, and the browser runs these on the compositor.
- **Alternatives rejected:** Framer Motion / GSAP (≈ 30–60 KB for effects CSS already does); per-component
  reduced-motion handling (easy to forget one).

## D37: Visualisation layouts are hand-written pure functions in `src/core/viz`; no d3
- **Date / phase:** 2026-11-19 · U3 slice 2 · **Status:** Accepted (answers U3 open question 3)
- **Decision:** Squarified treemap (Bruls et al.), DSM ordering (Tarjan SCCs, then a topological order of the
  component graph so importers come first; ties by role layer, then name), commit calendar (day buckets with an
  explicit time-zone offset), hotspot scatter, ER grid, rings and circles are small pure functions in
  `src/core/viz/*`, unit-tested in Node against planted truth. Rendering is plain React SVG in `src/ui/viz/*` with
  colours from the tokens. Bounds: treemap ≤ 5 000 cells (smallest siblings fold into "N more"), DSM ≤ 40 modules
  (files when they fit, else the deepest folder depth that fits), calendar ≤ 53 weeks, scatter ≤ 1 500 points,
  ER ≤ 60 entities. The hotspot "risky" quadrant is the project's own 75th percentile on both axes (never below 1);
  without history the x axis is fan-in, said so in the UI. Every picture has a table fallback.
- **Why:** Each layout is 50–150 lines; d3-hierarchy would add a dependency for one of them, and a shared,
  tested core keeps the pictures honest (the DSM test proves every non-cycle cell is above the diagonal).
- **Alternatives rejected:** `d3-hierarchy` (fine, but unnecessary); Cytoscape for the matrix/treemap (wrong tool,
  canvas text, no table fallback); fixed thresholds for "risky" (meaningless across projects of different sizes).

## D38: Diagrams that move: graph motion stays inside `Graph.tsx`; in-app ER is SVG, Mermaid stays for export
- **Date / phase:** 2026-11-19 · U3 slice 3 · **Status:** Accepted
- **Decision:** `Graph.tsx` owns all graph motion so views only pass data: new nodes glide out of the folder node
  they replaced (expand), the focused node's edges "march" for 1.6 s and then return to their confidence style
  (solid/dashed/dotted must stay readable), `highlight` fades everything except a path or playback prefix, `travel`
  moves a dot along one edge (flow playback), `pulse` centres and rings a located node. All off above 200 nodes
  and under reduced motion; the stepping itself still works. The Data view draws its own SVG ER diagram
  (`src/core/viz/er.ts`, click to focus); the Mermaid diagram is one click away ("as exported") and is still what
  exports and print use. Graph export: PNG via Cytoscape (what you see); SVG by rendering the current view as a
  Mermaid flowchart (so the SVG matches the exported diagrams' style).
- **Why:** One place to enforce the motion rules (D36) and the node cap; Mermaid ER layouts can't be made
  interactive, while the exported diagrams must stay text so they travel into Markdown and Notion.
- **Alternatives rejected:** Continuous edge animation while a node is focused (loops while idle, hides the
  confidence encoding); `cytoscape-svg` for SVG export (another extension with its own styling path, D35).

## D39: Google Sans for the interface, bundled; Geist Mono kept for code, paths and labels
- **Date / phase:** 2026-11-20 · font change (owner request, before M10)
- **Status:** Accepted (supersedes the "Geist Mono as the only typeface" part of D27; the palette, tokens and layout of D27 stand)
- **Context:** The owner asked for Google Sans and supplied the Google Fonts embed (`family=Google+Sans:ital,opsz,wght@0,17..18,400..700;…`).
  That embed loads the font from `fonts.googleapis.com` / `fonts.gstatic.com` on every visit. The service worker never
  touches cross-origin requests (D10), so the font would be missing offline, and every visit would tell Google that
  someone opened imex, which contradicts the "100% local · nothing leaves this browser" pill (CLAUDE.md privacy rule).
- **Decision:** Self-host the same typeface: `@fontsource-variable/google-sans` (OFL, the Google Fonts files, variable
  weight 400–700 and optical size). `src/index.css` declares only its `latin` and `latin-ext` faces with the package's
  own unicode ranges, because the service worker precaches every emitted file. `--font-sans` is Google Sans
  (`system-ui` fallback); `--font-mono` stays Geist Mono for code, file paths, the source panel, table headers and the
  uppercase `.label` style. Cytoscape and Mermaid text use Google Sans (canvas font preload updated). No italic face is
  shipped: nothing in the UI is italic.
- **Why:** Same look the owner asked for, zero network requests, works offline, no cookie/IP exposure. Paths and code
  need fixed-width alignment, and mono labels are part of the U2 identity, so only the reading text changes.
- **Alternatives rejected:** The Google Fonts `<link>` as supplied (breaks the privacy promise and offline use; one line
  to switch back if the owner prefers it, but then the pill text must change); Google Sans for everything including
  code (paths and the source viewer would lose alignment); shipping every script of the package (≈ 1.5 MB more precached).

## D40: Decision catalogue: detectors over finished analysis, three kinds of "why", no invented absences
- **Date / phase:** 2026-11-20 · M10
- **Status:** Accepted
- **Context:** `Analysis.decisions` existed since M1 but nothing filled it. A "decision" a tool infers can easily become
  fiction (why was Express chosen?), which would break the rule that every fact carries a confidence and a source.
- **Decision:** `decisionsStage` (`src/core/decisions/`) runs as a `deep` stage after deps, health and git, and builds:
  (1) one `Documented` decision per ADR (Nygard and MADR layouts, `docs/adr`, `docs/decisions`, `adr-NNN`), always
  `resolved`, with status/date/number, the record's context as its "why" and its consequences as trade-offs; (2) up to
  16 inferred decisions from detectors: architecture style (top two, since layered and monolith are both true),
  repository layout, messaging, languages, application framework, UI framework, state, build tooling, datastores
  (dependencies and databases named in config: Prisma datasource, JDBC URL, Django ENGINE, `mysqli_*`), data access,
  API style, authentication, deployment, configuration/secrets, background jobs, test strategy. Each has evidence
  (`file:line`), a confidence that is the weakest part of what it claims, and three separate text fields:
  **why** (the project's own words only: an ADR context or a README sentence containing a "why" cue such as "chose …
  because …", `resolved` with its location; architecture also gets a `heuristic` structural sentence; otherwise empty
  and the UI says the repo doesn't say), **observed** (counted facts about how the decision holds up here: layering
  violations, routes without auth middleware, hardcoded secrets, no tests; each with its own confidence), and
  **tradeoffs** (general knowledge from the tech table, labelled as such; for ADRs, the record's own consequences).
  Absences are reported only where exact and useful: no recognised auth on an HTTP API is `unresolved` ("either open or
  not recognised"), never "none"; no test files is a counted fact; nothing is said about auth for projects without HTTP.
- **Why:** Reasoning about intent is where tools lie. Separating quotes, counts and general knowledge keeps each claim
  checkable. Detectors read already-established facts, so they are cheap (6 ms on 3 000 files) and degrade one by one
  (a throwing detector adds a notice and the rest continue).
- **Alternatives rejected:** Free-text "rationale" generated from templates (plausible but unverifiable); an LLM (M11,
  opt-in only); one detector per technology (the TECH table already carries those facts).

## D41: Onboarding is computed in the worker and stored; commands are verbatim or labelled as conventional; env values only from templates
- **Date / phase:** 2026-11-20 · M10
- **Status:** Accepted
- **Context:** "How do I run it?" needs the text of README, Dockerfile, Makefile, manifests and `.env` files, which the
  UI never holds (D22 covers only what can be derived from the stored `Analysis`).
- **Decision:** `onboardingStage` (`src/core/onboarding/`) stores `Analysis.onboarding` (reading path, glossary,
  how-to-run, first-week checklist); `ANALYSIS_VERSION` is now 2, and a version-1 analysis shows a "re-analyse" hint
  instead of an empty page. Commands copied from a file (manifest scripts, Makefile targets, README fenced blocks under
  setup/run headings) are `resolved`; conventional ones derived from a manifest (`pip install -r`, `mvn spring-boot:run`,
  `php -S`) are `heuristic`, and a verbatim copy replaces a derived one. imex never runs anything. Example values come
  from template files only (`.env.example`, `.sample`, `.template`, `.dist`); a real `.env` contributes names, never
  values. The reading path lets specialised steps (docs, entry, routes, data, config, rough edges) repeat a file but
  fills the generic "core logic" step last and without repeats. The glossary drops plumbing words (service, controller,
  util …) and needs an entity, a route noun or use in ≥ 2 files. Checklist ticks are per-viewer, kept in `localStorage`
  (works without it). Stage order is `deps → health → git → decisions → onboarding` so ownership and hotspots are known.
- **Why:** Everything shown has a source line a newcomer can open, and nothing is executed or leaked: a real `.env`
  can hold live secrets, and "run this" suggestions from a tool must not be mistaken for tested commands.
- **Alternatives rejected:** Deriving it in the UI (no file text); one big "guide" string (no per-item confidence or
  links); ticking items in IndexedDB (a per-viewer convenience doesn't need the analysis store).

## D42: The help manual lives on Home only, and its content is data checked against the app
- **Date / phase:** 2026-11-20 · U4
- **Status:** Accepted
- **Context:** A first-time visitor needs to learn what each page is for, how to read it and how far to trust it, and the
  app's vocabulary. Help text written inside each view is spread over thirteen files, drifts as the views change, and
  clutters the working pages. The owner asked for one complete manual on the introductory page (U4 plan).
- **Decision:** One scrolling section on Home (no separate Guide view, no help panels inside project views; the logo brings
  you back). Its content is typed data in `src/ui/help/content.ts` (sections, a quick start, routes by goal, one entry per
  page with the same shape, terminology, shortcuts, privacy and limits) and `HelpManual.tsx` only renders it. Drift guards:
  a unit test fails if a tab has no entry, an entry names a page that is gone, a documented control's `data-testid` is not
  in the UI code, a quoted threshold (god module, complexity colours) differs from the code, or the confidence levels have
  a second wording (`ConfBadge` tooltips import `CONFIDENCE_HELP` from the manual). Every page entry ends with a worked
  example on the bundled sample project, written as test-id actions plus checks and replayed in Playwright. On Home the
  order is hero, drop zone, stored projects, settings, feature strip, manual; the manual has one navigation that adapts:
  a slim sticky section bar below 1100 px, a contents column with scroll-spy above (both together was redundant).
- **Why:** Prose that is not tested goes stale silently. As data it can be searched (terms), reused (tooltips) and verified;
  the worked examples double as end-to-end walks of each page on a project with planted truth.
- **Alternatives rejected:** Per-view help panels (more files to keep true, noisy in a dense tool); a separate Guide tab
  (the first-run question is answered before a project exists, so it belongs on the first page); screenshots (stale after
  every restyle; drawn SVG schematics use the tokens and follow light/dark); Markdown files rendered at runtime (no types,
  nothing to hang the drift guards on).
