import { useMemo, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { buildSections, fullMarkdown, notionPages, SECTIONS } from '../core/report';
import { useStore } from '../store/store';
import { worker } from '../workers/client';
import { Card, Page } from './kit';
import { MarkdownDoc } from './MarkdownDoc';

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

/** Paper is white: print in the light theme. Switch temporarily, wait (bounded) for the diagrams to
 *  re-render in light colours, print, then switch back. */
async function printLight() {
  const { theme, toggleTheme } = useStore.getState();
  const dark = theme === 'dark';
  if (dark) {
    toggleTheme();
    const until = Date.now() + 4000;
    await new Promise((r) => requestAnimationFrame(r));
    while (Date.now() < until && document.querySelector('[data-testid="report-diagram"][data-rendered="pending"]')) await new Promise((r) => setTimeout(r, 50));
  }
  window.print();
  if (dark) toggleTheme();
}

export function ExportView() {
  const a = useStore((s) => s.analysis)!;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(SECTIONS.map((s) => s.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const ids = useMemo(() => SECTIONS.filter((s) => picked.has(s.id)).map((s) => s.id), [picked]);
  const sections = useMemo(() => buildSections(a, ids), [a, ids]);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };
  const base = fileSafe(a.name);
  const run = async (label: string, fn: () => void | Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Page title="Export" intro="Take the analysis with you. Files are generated in your browser and saved locally — nothing is uploaded.">
      <div className="no-print space-y-4">
        <Card title="Sections to include">
          <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid="export-sections">
            {SECTIONS.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[var(--accent)]" data-testid={`section-${s.id}`} checked={picked.has(s.id)} onChange={() => toggle(s.id)} />{s.title}</label>
            ))}
          </div>
          {a.stage !== 'done' && <p className="mt-2 text-xs text-[var(--warn)]">Analysis is still running; exports will be more complete once it finishes.</p>}
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Markdown">
            <p className="mb-2 text-[13px] muted">One file with a table of contents; diagrams are embedded as Mermaid code blocks (rendered by GitHub, GitLab, Obsidian, VS Code…).</p>
            <button className="btn btn-primary" data-testid="export-md" disabled={!!busy || ids.length === 0} onClick={() => run('md', () => download(`${base}-imex.md`, new Blob([fullMarkdown(a, ids)], { type: 'text/markdown' })))}>Download .md</button>
          </Card>
          <Card title="Notion">
            <p className="mb-2 text-[13px] muted">A ZIP of linked Markdown pages (one per section). In Notion: <b>Settings → Import → Text &amp; Markdown</b>, then choose the ZIP. Notion creates an index page with the sections as sub-pages; Mermaid blocks render as diagrams.</p>
            <button className="btn btn-primary" data-testid="export-notion" disabled={!!busy || ids.length === 0} onClick={() => run('notion', () => {
              const files = Object.fromEntries(notionPages(a, ids).map((p) => [p.path, strToU8(p.content)]));
              download(`${base}-notion.zip`, new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }));
            })}>Download Notion .zip</button>
          </Card>
          <Card title="PDF">
            <p className="mb-2 text-[13px] muted">Opens your browser’s print dialog with a print-optimised layout of the report below (diagrams as vector SVG). Choose “Save as PDF”.</p>
            <button className="btn btn-primary" data-testid="export-pdf" disabled={ids.length === 0} onClick={() => void printLight()}>Print / Save as PDF</button>
          </Card>
          <Card title="JSON">
            <p className="mb-2 text-[13px] muted">The raw analysis data (files, symbols, edges, routes, schema, findings…) for reuse in your own tools. Always complete, regardless of the section selection.</p>
            <button className="btn btn-primary" data-testid="export-json" disabled={!!busy} onClick={() => run('json', async () => {
              const { blob } = await worker.call('exportJson', {});
              download(`${base}-analysis.json`, blob ?? new Blob([JSON.stringify(a)], { type: 'application/json' }));
            })}>Download .json</button>
          </Card>
        </div>
        <h2 className="label pt-3">Report preview</h2>
      </div>
      <article className="card px-6 py-7 md:px-10" data-testid="report">
        <div className="label">imex report</div>
        <h1 className="mt-1.5 text-[28px] font-medium leading-[1.15] tracking-[-0.04em]">{a.name} — codebase report</h1>
        <p className="mt-2 text-[13px] muted">Generated by imex on {new Date(a.createdAt).toLocaleDateString()}. Facts are labelled resolved (exact), heuristic (inferred) or unresolved.</p>
        {sections.map((s) => (
          <section key={s.id} data-section={s.id}>
            <div className="md"><h2>{s.title}</h2></div>
            <MarkdownDoc markdown={s.markdown} />
          </section>
        ))}
        {sections.length === 0 && <p className="mt-4 muted">Select at least one section.</p>}
      </article>
    </Page>
  );
}
