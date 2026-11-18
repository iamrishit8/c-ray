# C-Ray — Codebase X-Ray

Drop in a file, a folder or a ZIP and get an interactive explanation of an unfamiliar codebase:
what it is, how it is organised, how requests and data flow, what is risky, and why it appears to be
built the way it is. **Everything runs in your browser. Your code never leaves your machine.**

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

## Build a static site

```bash
npm run build        # outputs dist/ — deploy anywhere static (Vercel, GitHub Pages, S3 …)
npm run preview
```

## Test

```bash
npm test             # unit + integration (Vitest)
npm run test:e2e     # end-to-end (Playwright, needs: npx playwright install chromium)
```

## Documentation

| Doc | What's in it |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Working rules for this repo; read first |
| [docs/TODO.md](docs/TODO.md) | Roadmap, current milestone, remaining tasks |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every design decision and why |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, layers, analysis model, worker protocol |
| [docs/FLOWS.md](docs/FLOWS.md) | Runtime flows (analyse, re-analyse, export, history, offline) |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Code style, UI system, code review checklist |
| [docs/DEFINITION_OF_DONE.md](docs/DEFINITION_OF_DONE.md) | What "complete" means for a task or milestone |
| [docs/QUALITY.md](docs/QUALITY.md) | Benchmarks and known limitations |
