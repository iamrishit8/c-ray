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
packfiles; results in `tests/bench/git-real.results.json`. Measured 2026-11-18 on an Apple-silicon laptop, Node, one run each.

| Repo | Files | `.git` | Commits analysed | Snapshots | Git stage | Whole pipeline | Peak RSS (start) |
|---|---|---|---|---|---|---|---|
| expressjs/express | 216 | 11.5 MB | 500 of 6,186 | 10 | 1.8 s | 2.1 s | 679 MB (110) |
| expressjs/express | 216 | 11.5 MB | 2,000 of 6,186 | 10 | 3.6 s | 4.0 s | 575 MB (111) |
| fastify/fastify | 389 | 12.4 MB | 500 of 4,931 | 10 | 4.2 s | 5.6 s | 838 MB (111) |

How to read it: passing one shared `cache` to isomorphic-git made the git stage 8× faster on express (15.5 s → 1.8 s)
and 4–5× on fastify. Time is now split about evenly between walking commits and re-analysing snapshots. Peak memory is
the weak spot: hundreds of MB for a 12 MB `.git` (RSS also includes the rest of the pipeline; follow-up in TODO).
Co-change results: express 24 pairs (3 hidden coupling), fastify 88 pairs (55 hidden coupling, mostly genuine:
hand-written `.d.ts` files that must change with their `.js`, see D29).

### Scale

Not measured yet (M12). Harness exists: `npm run gen:synthetic` + `npm run bench:scale`.

### Test suite (2026-11-18)

151 unit tests (+1 opt-in benchmark skipped unless `GIT_REPO` is set), 19 e2e tests, all passing.

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

### Git (M9)
- Commit walk is capped (`maxGitCommits`, default 500, most recent first); at most 10 snapshots (4 on projects with
  more than 4000 files), each up to 40 MB of code. Snapshots use L1 (heuristic) parsing only, so module edges in
  time-travel are `heuristic`.
- Only first-parent diffs are used; merge commits count for authors and message types but not for churn or co-change.
- No rename tracking: a renamed or moved file starts with fresh churn and ownership.
- Co-change ignores commits touching more than 25 code files (bulk reformatting, vendoring) and pairs seen fewer
  than 2 times (3 when more than 60 commits). Test↔test pairs are dropped. "Hidden coupling" can be a false positive
  when the import path between the files is longer than 4 hops or goes through a package name (D29).
- Bus factor and ownership use the *main author* per file (most commits), not lines authored (no blame).
  Authors are grouped by email for the author list and by name for ownership; one person with two emails appears twice.
- If isomorphic-git cannot read the `.git` folder (missing objects, some shallow clones), history is disabled and the
  reason is shown (`gitMessage`). Verified on two real repos with packfiles (express, fastify) and a generated repo
  with loose objects and an annotated tag.
- Peak memory during the git stage is high (≈0.5–0.8 GB RSS for a 12 MB `.git`); very large histories may exhaust a tab.
