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

### Scale

Not measured yet (M12). Harness exists: `npm run gen:synthetic` + `npm run bench:scale`.

### Test suite (2026-11-18)

115 unit tests, 17 e2e tests, all passing.

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

### Git (M9, in progress)
- Commit walk is capped (`maxGitCommits`); at most 10 snapshots of up to 40 MB each.
- If isomorphic-git cannot read the `.git` folder (e.g. some shallow clones or unusual packfiles), history is
  disabled and the reason is shown (`gitMessage`). Not yet verified against real-world repos.
