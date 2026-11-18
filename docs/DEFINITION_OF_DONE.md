# Definition of Done

A task (or milestone) is **done** only when every applicable box below is true. If a box does not
apply, that's fine; if it applies and is unmet, the task stays open in [TODO.md](TODO.md) with the gap listed.

## 1. It works

- [ ] The feature does what the TODO item says, verified by running it (dev server or e2e), not only by reading code.
- [ ] Edge cases handled: empty project, single file (File Mode), huge file, unparsable file, missing `.git`, storage full.
- [ ] Failure is graceful: errors become a notice / banner with a plain-language message, never a blank screen or a stuck spinner.

## 2. It's correct and honest

- [ ] Every inferred fact shown to the user has a confidence label (`resolved` / `heuristic` / `unresolved`) and a file:line source.
- [ ] Numbers that claim accuracy (precision, recall, scores) are measured, and the measurement is in [QUALITY.md](QUALITY.md).
- [ ] No user code or metadata leaves the browser (no new network calls; check the Network tab once for UI features).

## 3. It's tested

- [ ] `npm run typecheck` is clean.
- [ ] `npm test` passes. New core logic has unit tests in `tests/unit/mN-*.test.ts` asserting against planted truth
      (fixture `ground-truth.json`), not against whatever the code currently outputs.
- [ ] New or changed UI has a Playwright test in `tests/e2e/mN-*.spec.ts` using `data-testid`s.
- [ ] `npm run test:e2e` passes.
- [ ] `npm run build` succeeds.

## 4. It fits the codebase

- [ ] Follows [CONVENTIONS.md](CONVENTIONS.md): `src/core` stays DOM-free, heavy work in workers, UI uses kit components and tokens.
- [ ] Self-reviewed the diff against the review checklist in CONVENTIONS.md § Code review.
- [ ] UI checked in **light and dark** mode and at a narrow width (~1024px), with keyboard focus visible.
- [ ] No dead code, debug logs or commented-out blocks left behind.

## 5. It's documented

- [ ] [TODO.md](TODO.md): item ticked, follow-ups added, "Now" section reflects reality.
- [ ] [DECISIONS.md](DECISIONS.md): new entry for any non-obvious choice.
- [ ] [ARCHITECTURE.md](ARCHITECTURE.md) / [FLOWS.md](FLOWS.md): updated if modules, stages, messages or data flow changed.
- [ ] [QUALITY.md](QUALITY.md): limitations and benchmark numbers updated.
- [ ] User-facing copy in the app explains what a view shows and how sure it is.

## 6. It's committed

- [ ] One coherent commit (or a few) with message `Mn: …`, code and docs together.

---

**Milestone done** = all its TODO items done + an e2e test that walks the milestone's main user story on a fixture
+ its limitations written in QUALITY.md + **the owner has reviewed it in the running app and approved it**.

## Phase review (before starting the next milestone)

1. Make sure the dev server is running at http://localhost:5173 (`npm run dev`; reuse it if it's already up) and
   smoke-test it: upload a fixture, no console errors.
2. Give the owner a short "what to try" walkthrough: what's new, where it is in the UI, which project to upload to
   see it, and what is still limited.
3. Wait for approval. Feedback becomes TODO items; the next milestone starts only after a go-ahead.
