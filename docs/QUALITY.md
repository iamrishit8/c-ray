# Quality: benchmarks and known limitations

Measured numbers and honest limitations. Every milestone adds its own limitations here (Definition of Done §5).

## Benchmarks

### L1 (tree-sitter, heuristic) vs L2 (TypeScript compiler, exact)

`npm run bench:l1l2`: L1 edges are scored against L2 edges on the TS/JS fixtures
(results are written to `tests/bench/l1-vs-l2.results.json`). The same measurement
runs on every analysed project that contains TS/JS and is shown on the Orientation page.

| Fixture | Import precision | Import recall | Call precision | Call recall | Import edges | Call edges |
|---|---|---|---|---|---|---|
| express-mongoose (CommonJS) | 100.0% | 100.0% | 84.6% | 100.0% | 22 | 11 |
| nestjs-prisma | 100.0% | 100.0% | 83.3% | 100.0% | 22 | 10 |
| monorepo | 95.3% | 100.0% | 90.0% | 69.2% | 41 | 26 |
| **All** | **97.7%** | **100.0%** | **86.7%** | **83.0%** | 85 | 47 |

How to read it: L1 import edges are nearly exact because they share the module resolver. L1 call edges are right
about 87% of the time and find about 83% of real calls; most misses are calls through re-exports and JSX usage
across packages. The fixtures are small, so treat these numbers as indicative and expect lower call recall on
heavily dynamic code.

### Impact analysis vs. real compiler breakages

`tests/unit/m6-impact.test.ts` mutates four signatures/types in a copy of the monorepo fixture, runs
`tsc`, and compares the files that really fail to compile with the predicted dependents
(results in `tests/bench/impact.results.json`).

| Prediction set | Recall | Precision |
|---|---|---|
| Transitive dependents (what the Impact view lists) | 100% | 37.5% |
| Direct dependents only (distance 1) | 88.9% | 100% |

How to read it: nothing that broke was missed. Precision is low on purpose: the transitive set is the
*behavioural* blast radius (callers of callers), while a signature change only breaks compilation at direct use
sites. The view groups dependents by distance so the direct ones are easy to spot.

### Git history on real repositories

`GIT_REPO=/path/to/clone [GIT_COMMITS=500] npm run bench:git` runs the full pipeline (L2 off) on a real clone with
packfiles; results in `tests/bench/git-real.results.json`. Measured 2026-11-19 on an Apple-silicon laptop, Node, one run each.

| Repo | Files | `.git` | Commits | Git stage | Whole pipeline | Peak heap | Peak array buffers | Peak RSS |
|---|---|---|---|---|---|---|---|---|
| expressjs/express | 216 | 11.5 MB | 500 of 6,186 | 1.7 s | 2.0 s | 136 MB | 133 MB | 765 MB |
| expressjs/express | 216 | 11.5 MB | 2,000 of 6,186 | 3.7 s | 4.1 s | 203 MB | 156 MB | 708 MB |
| fastify/fastify | 389 | 12.4 MB | 500 of 4,931 | 4.2 s | 5.3 s | 174 MB | 106 MB | 851 MB |

| Repo (commits) | Co-change pairs | Hidden coupling | …with a `.d.ts` | …test ↔ code | Renames found |
|---|---|---|---|---|---|
| express (500) | 24 | 3 | 0 | 3 | 2 |
| express (2,000) | 103 | 49 | 0 | 3 | 11 |
| fastify (500) | 97 | 43 (was 55) | 28 | 7 (was 25) | 27 |

How to read it:
- **Memory.** Peak RSS is mostly not the git stage. The same fastify run with git off already peaks at ≈420 MB RSS
  (Node + vitest + tree-sitter WASM) but only 36 MB heap / 18 MB array buffers. With forced GC sampling the git stage
  *retains* ≈50 MB heap + ≈50–65 MB array buffers on fastify (the `.git` bytes, the loaded pack and its index, commit
  and churn tables) and nothing after the stage ends. The suspected unbounded cache (isomorphic-git's pack
  `offsetCache`) was measured empty on both repos; see D32. The earlier "0.5–0.8 GB" note was measuring the baseline.
- **Time.** One shared isomorphic-git `cache` across calls keeps packfile indexes parsed (8× faster on express than
  without it). Rename detection adds no measurable time (it reads blobs only for commits that add *and* delete files).
- **Co-change.** Resolving `require('..')` and self-imports through `package.json` `main`/`exports` and linking tests
  at any depth (D31) took fastify's test ↔ code false positives from 25 to 7. Most of what remains are hand-written
  `.d.ts` files that must change with their `.js` (genuine, D29). The 27 fastify renames are its `*.test-d.ts` →
  `*.tst.ts` migration; those files now keep their history, which is why the pair count went up.

### Colour contrast (U2, 2026-11-19)

`npm run audit:contrast` checks every token pair the UI renders, in both themes (results printed, exit 1 on failure).
All pairs pass WCAG AA. Lowest margins: light `--fg3` on the page 4.58:1 (tertiary text, labels); light
`--r-config` badge text on its tint 4.67:1; light `--r-int` graph dot 4.48:1 (non-text, needs 3:1). The mockup's
white-on-terracotta button text (3.1:1) and raw role colours as badge text (down to 3.3:1) failed and were changed (D34).

### Scale

Not measured yet (M12). Harness exists: `npm run gen:synthetic` + `npm run bench:scale`.

### Test suite (2026-11-18)

See the latest count in TODO.md "Now"; all suites pass at every commit.

## Known limitations

### Parsing (M1–M3)
- TypeScript is pinned to 5.9 because TS 7 has no JS compiler API (D1). L2 covers TS/JS only and at most 4000 files
  (`maxL2Files`) within its time budget; the remaining files keep L1.
- SQL is handled by a hand-written tokenizer: DDL only (tables, columns, FKs, indexes), no queries or procedural SQL (D3).
- The WASM tree-sitter ignores `setTimeoutMicros`, so the per-file limit is enforced by chunked input (D12). A file
  cut off at the deadline is listed as timed out.
- L1 call recall is around 83% on TS fixtures and likely lower for dynamic languages (see benchmark above).

### Detection and flows (M4)
- Detectors are regex/line scanners (D15), so unusual formatting or metaprogramming can hide routes. Route paths that
  are not literals are recorded as `unresolved`.
- Flow tracing only follows statically visible calls. Dependency injection, event buses and reflection appear as
  dead ends.

### Dependencies, health, impact (M5–M6)
- Secrets, SQL-concat and clone findings are pattern-based and can be false positives (shown as `heuristic`).
- Dead-export detection only considers analysed files; exports used by tooling or external consumers show up as unused.
- Transitive impact over-approximates (precision 37.5%; see above).

### Schema (M7)
- Covers 11 ORM/DDL sources. Schemas built at runtime (dynamic models, migrations computed in code) are not reconstructed.

### Export (M8)
- PDF relies on the browser's print dialog; layout differs slightly between browsers.
- The Print button switches to the light theme while the dialog is open. Printing with Ctrl/Cmd+P in dark mode prints
  dark cards and diagrams on white paper.

### UI (U2)
- Folder labels in graphs sit centred above the box: Cytoscape can't place a compound node's label inside its top-left
  corner (the mockup's position).
- Graph labels are one font size: the subtitle line (role · size) can't be smaller or dimmer than the name.
- Canvas waits at most 1.5 s for Google Sans (Geist Mono before D39); on a very slow first load a graph may draw in the fallback monospace
  until it is rebuilt (e.g. filter change).
- Below 900 px the side nav is an icon rail (labels in tooltips); below 1100 px the source panel overlays the view.
  Phone widths are usable but not designed for (dense tables scroll).

### Git (M9)
- Commit walk is capped (`maxGitCommits`, default 500, most recent first); at most 10 snapshots (4 on projects with
  more than 4000 files), each up to 40 MB of code. Snapshots use L1 (heuristic) parsing only, so module edges in
  time-travel are `heuristic`.
- Only first-parent diffs are used; merge commits count for authors and message types but not for churn or co-change.
- Renames: exact moves are always found; edited moves only when ≥ 50% of lines are shared, the extension is the same,
  both blobs are ≤ 512 KB, and the commit has at most 400 add×delete candidate pairs (D32). A rename inside a merge
  commit is not seen (first-parent diffs only), and a file split into two keeps history on at most one of them.
- Co-change ignores commits touching more than 25 code files (bulk reformatting, vendoring) and pairs seen fewer
  than 2 times (3 when more than 60 commits). Test↔test pairs are dropped. "Hidden coupling" can be a false positive
  for two code files linked only by an import path longer than 4 hops (D29), or when the link is dynamic
  (`require(variable)`, dependency injection). Tests count as linked at any depth (D31).
- Bus factor and ownership use the *main author* per file (most commits), not lines authored (no blame).
  Authors are grouped by email for the author list and by name for ownership; one person with two emails appears twice.
- If isomorphic-git cannot read the `.git` folder (missing objects, some shallow clones), history is disabled and the
  reason is shown (`gitMessage`). Verified on two real repos with packfiles (express, fastify) and a generated repo
  with loose objects and an annotated tag.
- Memory: the git stage holds the whole `.git` in memory (it is uploaded that way) plus ≈2–4× its size while walking;
  a multi-GB `.git` will not fit in a tab. Ingest caps `.git` at 250 MB.

### Visualisations (U3)
- Treemap: at most 5 000 cells; folders recurse up to 6 levels while a cell is at least 8 px; small siblings fold
  into one "N more" cell. File labels appear only on cells wide enough; the hover card always has the full path.
- Dependency matrix: type-only imports and tests are left out (as in the cycle list). Above 40 files it groups by
  folder, so a file-level cycle inside one folder shows on the diagonal, not as a pair. A module-level cycle can
  exist without a file-level one (A/x → B/y, B/z → A/w); it is outlined as a cycle too.
- Hotspot map: the "risky" cut-offs are relative (75th percentile), so every project has a risky corner unless
  values are flat; without `.git` the x axis is fan-in, not churn.
- Commit calendar: one year at most (older commits counted as "not shown"); days use the viewer's time zone.
- Graph motion (glide, marching ants, travelling dot) is off above 200 nodes. The System map often opens zoomed
  out far enough that node labels hide (`min-zoomed-font-size`), as before U3; zoom in or use the legend/hover.
- SVG export of the map is a Mermaid redraw of the current nodes and edges (layout differs from the canvas);
  PNG is exactly what is on screen.
- Not measured yet: frame times on a 500-node map and the 10k-file treemap (U3 slice 4).
- Tests after U3 slices 1–3 (2026-11-19): 181 unit (+1 opt-in bench) and 34 e2e, all passing.

### Decisions and onboarding (M10)
- **Decisions are inferred, not recovered.** Each detector reads facts earlier stages found, so it inherits their
  limits (L1 routes are `heuristic`, dynamic route paths are listed as `unresolved`). "REST-style" is a judgement about
  HTTP routes, so that decision is `heuristic` even when every route is exact.
- **"Why" is only what the repo says.** An ADR's context, or the first README/docs sentence that mentions the
  technology *and* contains a cue such as "chose", "decided", "because", "instead of". A rationale written in other
  words, in a wiki, or in another language is missed, and the view then says the repository doesn't state why. A
  sentence can be a coincidence (a "because" sentence that happens to name the technology); it is quoted with its
  file and line so it can be checked. Docs scanned: README + up to 12 prose docs, each ≤ 200 KB.
- **Trade-offs are general knowledge** from the tech table (`src/core/l0/tech.ts`), shown as such; only ADR
  consequences are the team's words. imex does not check that code still follows an ADR; a superseded or deprecated
  status is surfaced as a warning.
- **Auth is the weakest detector.** It recognises auth-like middleware/guard names, auth dependencies (JWT, Passport,
  Spring Security, Devise, NextAuth) and Django's `django.contrib.auth`. Custom checks inside handlers, gateways and
  proxies are invisible, hence the `unresolved` "either open or not recognised" result; the "N of M routes pass
  through auth middleware" count only appears when at least one route has it (frameworks that don't expose per-route
  middleware would otherwise read as "0 of M").
- **Databases declared in config**: Prisma datasource, JDBC URLs in `application.*`, Django `ENGINE`, `mysqli_*`/PDO-mysql.
  The PHP match is `heuristic` (a MySQL driver, not proof of the server). Other config styles (Rails `database.yml`,
  `DATABASE_URL` strings, Docker Compose images) are not read yet.
- **Test strategy counts files by path convention** (`isTestPath`), so "no test files found" can be wrong when tests
  are excluded by ignore rules or live outside the analysed files; the text says so.
- **Run commands are copied or conventional, never executed.** Verbatim sources: manifest scripts, Makefile targets
  (`install|setup|run|dev|start|serve|test|build|lint|migrate`), README fenced blocks under headings containing
  install/setup/getting started/run/usage/development/build/test whose line starts with a known tool (npm, pip,
  docker, make, mvn, go, cargo, …). Conventional commands (`mvn spring-boot:run`, `python manage.py runserver`,
  `php -S localhost:8000`) are `heuristic`. The package manager comes from the lockfile the ingest step skipped, or
  `pnpm-workspace.yaml`; with neither it says `npm`. Not read: `.nvmrc`/`.tool-versions`, CI workflow steps,
  compose `environment:` blocks, `package.json` `engines` beyond `node`.
- **Environment variables**: names from every `.env*` file, example values from template files only (`example`,
  `sample`, `template`, `dist` in the name); a real `.env` is never copied (tested). Ports: Dockerfile `EXPOSE`,
  compose `ports:`, a numeric `PORT` in a template.
- **Glossary** is lexical: words in entity names, route paths, class/interface/type names and file names, split on case
  and punctuation, crudely singularised ("status", "address" kept), minus a stop list of plumbing words. It cannot tell
  that two words are synonyms and has no definitions beyond where the word is used; non-Latin identifiers pass through
  unsplit.
- **Reading path ranking** reuses the orientation "read first" score (centrality 45%, hops from an entry 35%, size 20%);
  it favours the middle of the import graph, so leaf utilities and generated code rank low on purpose.
- **Cost**: the two stages took 6 ms (decisions) and 28 ms (onboarding) on a synthetic 3 000-file project and
  < 5 ms on every fixture (total analysis 1.2 s for the 3 000 files), so they are not worth moving off the worker's
  critical path. Not measured on a large real repo with hundreds of docs.
- **Stale analyses**: a project stored before M10 (`version` 1) has no onboarding and no decisions until re-analysed;
  both views say so.
- **Typeface (D39)**: Google Sans is bundled (latin + latin-ext, 87 KB); text in other scripts falls back to the
  system font. The font is loaded with `font-display: swap`, so the first paint on a cold cache can use the fallback
  for a moment; canvas text (System map) waits up to 1.5 s for it. Geist Mono is still used for paths, code and labels.
- Tests after M10 (2026-11-20): 255 unit (+1 opt-in bench) and 40 e2e, all passing; planted truth for decisions and
  onboarding is in each fixture's `ground-truth.json` (written by hand from the fixture files). Writing it found two
  real gaps (databases declared only in config, and the git stage running after onboarding), both fixed.
