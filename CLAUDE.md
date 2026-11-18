# C-Ray — Codebase X-Ray

A static web app that explains an unfamiliar codebase (structure, request flows, data model, risk,
history) **entirely in the browser**. The user drops a file, folder or ZIP; nothing leaves the machine.
React 19 + TypeScript + Vite + Tailwind v4, analysis in Web Workers, IndexedDB for persistence.

## Start of every session / new task

1. Read [docs/TODO.md](docs/TODO.md): what phase we are in and what is next. Pick work from there.
2. Skim [docs/DECISIONS.md](docs/DECISIONS.md) so you don't re-open settled questions.
3. Read the part of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (and [docs/FLOWS.md](docs/FLOWS.md)) that covers the code you will touch.
4. For UI work, read [docs/CONVENTIONS.md](docs/CONVENTIONS.md) § UI.
5. Before calling anything finished, go through [docs/DEFINITION_OF_DONE.md](docs/DEFINITION_OF_DONE.md).

## Docs are part of the change

Update docs **in the same commit** as the code:

| When you… | Update |
|---|---|
| start / finish / discover a task | `docs/TODO.md` (move it, tick it, add follow-ups) |
| make a choice someone could reasonably question later | `docs/DECISIONS.md` (new numbered entry, never rewrite old ones; supersede instead) |
| add/move a module, stage, worker message, store field or DB store | `docs/ARCHITECTURE.md` |
| change how data moves at runtime (analysis, persistence, export…) | `docs/FLOWS.md` |
| add a UI pattern, token or coding rule | `docs/CONVENTIONS.md` |
| measure something / learn a limitation | `docs/QUALITY.md` |

A Stop hook (`.claude/hooks/docs-check.sh`) blocks once if `src/` or `tests/` changed with no doc change.
If truly no doc applies, say why in your reply.

## Commands

```bash
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit + bench (Node, real pipeline on fixtures)
npm run test:e2e     # Playwright (builds, serves on :4317)
npm run build        # typecheck + static build to dist/
npm run bench:l1l2   # L1 vs L2 accuracy → tests/bench/l1-vs-l2.results.json
```

## Non-negotiable rules

- **Privacy:** no network calls with user code or metadata. The service worker ignores cross-origin requests. Any future
  opt-in network feature (AI, M11) must be off by default, clearly labelled, and must change the "100% local" indicator.
- **`src/core` is isomorphic:** no DOM, no `window`, no React. It must run in Node so tests exercise real code.
- **Never block the UI thread** with analysis. Heavy work runs in `src/workers`; UI-side helpers in core
  (impact, flow tracing, map view) must stay cheap and bounded.
- **Every inferred fact carries a confidence** (`resolved` | `heuristic` | `unresolved`) **and a source location**.
  Never guess silently; record `unresolved` instead.
- **Stages degrade, they don't crash:** a failing stage adds a notice to `analysis.notices` and the pipeline continues.
- **Tests use planted truth:** fixtures in `tests/fixtures/<name>/` with a `ground-truth.json`; assert against it.
- **Stable test hooks:** keep every `data-testid`. E2E tests depend on them; add new ones for new UI.

## Code style (short version; full version in docs/CONVENTIONS.md)

- TypeScript strict. Shared types live in `src/core/types.ts`. Prefer plain functions and data over classes.
- File header comment says what the module is for. Comments explain *why*, not *what*.
- UI: use `src/ui/kit.tsx` components and the CSS tokens in `src/index.css` (`var(--…)`); never hard-code colours.
- Names: views `XxxView.tsx`, stages `xxxStage`, tests `mN-topic.test.ts` / `mN-topic.spec.ts` (N = milestone).

## Git

- Commit per milestone slice; message `Mn: what changed` (or `docs:` / `ui:` / `fix:` for cross-cutting work).
- Work is on `main` for now; don't push or open PRs unless asked.
