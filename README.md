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

See NOTES.md for design decisions, limitations and benchmark numbers.
