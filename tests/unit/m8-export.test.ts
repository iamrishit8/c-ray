import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { buildSections, fullMarkdown, md, notionPages, SECTIONS } from '../../src/core/report';
import { isSafeHref, renderMarkdown } from '../../src/ui/markdown';
import { analyzeFixture, analyzeMem, FIXTURE_NAMES } from '../helpers';

const MERMAID_TYPES = /^(flowchart (LR|TD)|erDiagram|sequenceDiagram|graph (LR|TD))$/;

/** Structural Markdown checks: balanced fences, consistent tables, resolvable anchors. */
function checkMarkdown(text: string) {
  const lines = text.split('\n');
  let inFence = false;
  let fenceLang = '';
  let fenceStart = 0;
  let tableCols = 0;
  const blocks: { lang: string; body: string }[] = [];
  let body: string[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceLang = l.slice(3).trim();
        fenceStart = i;
        body = [];
      } else {
        inFence = false;
        blocks.push({ lang: fenceLang, body: body.join('\n') });
      }
      tableCols = 0;
      return;
    }
    if (inFence) {
      body.push(l);
      return;
    }
    if (/^\|.*\|$/.test(l)) {
      const cols = l.replace(/\\\|/g, '').split('|').length - 2;
      if (tableCols === 0) tableCols = cols;
      expect(cols, `table row ${i + 1}: "${l.slice(0, 80)}"`).toBe(tableCols);
    } else tableCols = 0;
    // inline code spans are rendered literally, so only text outside them can inject markup
    expect(/<script|<img|<iframe|<svg|<a\s/i.test(l.replace(/`[^`]*`/g, '')), `raw HTML at line ${i + 1}: ${l.slice(0, 120)}`).toBe(false);
  });
  expect(inFence, `unclosed code fence opened at line ${fenceStart + 1}`).toBe(false);
  for (const b of blocks.filter((x) => x.lang === 'mermaid')) {
    expect(b.body.split('\n')[0].trim(), 'mermaid diagram type').toMatch(MERMAID_TYPES);
    expect(b.body.trim().split('\n').length).toBeGreaterThan(1);
  }
  return blocks;
}

describe('export', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: full Markdown report is structurally valid and complete`, async () => {
      const { analysis: a } = await analyzeFixture(name);
      const text = fullMarkdown(a);
      const blocks = checkMarkdown(text);
      expect(text.startsWith(`# ${name}`)).toBe(true);
      const headings = text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
      for (const t of ['Contents', 'Orientation', 'Architecture', 'Data model', 'Dependencies', 'Hotspots and health']) expect(headings, t).toContain(t);
      if (a.routes.length) expect(headings).toContain('Routes and flows');
      // table of contents anchors resolve to headings
      const slugs = new Set(headings.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')));
      for (const m of text.matchAll(/\]\(#([a-z0-9-]+)\)/g)) expect(slugs, `anchor #${m[1]}`).toContain(m[1]);
      expect(blocks.filter((b) => b.lang === 'mermaid').length).toBeGreaterThanOrEqual(2);
      expect(text).toContain('erDiagram');
    });
  }

  it('section selection limits the report; empty sections are omitted', async () => {
    const { analysis: a } = await analyzeFixture('legacy-php');
    const only = fullMarkdown(a, ['orientation', 'hotspots']);
    expect(only).toContain('## Orientation');
    expect(only).not.toContain('## Dependencies');
    const { analysis: b } = await analyzeMem({ 'a.py': 'x = 1\n', 'b.py': 'import a\n' });
    expect(buildSections(b).map((s) => s.id)).not.toContain('schema');
    expect(SECTIONS.map((s) => s.id)).toEqual(expect.arrayContaining(['orientation', 'architecture', 'flows', 'schema', 'dependencies', 'hotspots']));
  });

  it('Notion ZIP: index page + one page per section, all links resolve', async () => {
    const { analysis: a } = await analyzeFixture('nestjs-prisma');
    const pages = notionPages(a);
    const zip = zipSync(Object.fromEntries(pages.map((p) => [p.path, strToU8(p.content)])));
    const files = unzipSync(zip);
    const paths = Object.keys(files);
    const root = 'nestjs-prisma imex report';
    expect(paths).toContain(`${root}.md`);
    expect(paths.filter((p) => p.startsWith(`${root}/`)).length).toBe(buildSections(a).length);
    for (const p of paths) {
      expect(p.endsWith('.md')).toBe(true);
      const text = strFromU8(files[p]);
      checkMarkdown(text);
      expect(text.startsWith('# ')).toBe(true);
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
      for (const m of text.matchAll(/\]\(([^)#]+\.md)\)/g)) {
        const target = decodeURI(m[1]);
        const resolved = target.startsWith('../') ? target.slice(3) : dir + target;
        expect(paths, `link ${m[1]} in ${p}`).toContain(resolved);
      }
    }
    expect(strFromU8(files[`${root}.md`])).toContain('## Pages');
  });

  it('JSON export round-trips and source-derived text cannot inject markup', async () => {
    const { analysis: a } = await analyzeFixture('monorepo');
    const back = JSON.parse(JSON.stringify(a));
    expect(back.files.length).toBe(a.files.length);
    expect(back.routes).toEqual(a.routes);
    expect(md('<img src=x onerror=alert(1)> | `x` # [a](b)')).not.toMatch(/<img|\[a\]\(b\)/);
    const { analysis: evil } = await analyzeMem({
      'package.json': '{"name":"x","dependencies":{"express":"4"}}',
      'src/<script>alert(1)<script>.js': "const express = require('express');\nconst app = express();\napp.get('/a|b<img src=x onerror=1>', (req, res) => res.end());\n// TODO <script>alert(2)</script> | pipe\n",
      'src/b.js': "require('./<script>alert(1)<script>');\n",
    });
    checkMarkdown(fullMarkdown(evil));
  });
});

// Known issue closed in U2: `marked` does not sanitize link URLs. The report renderer drops unsafe schemes.
describe('report Markdown rendering is safe for untrusted text', () => {
  const hrefs = (html: string) => [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);

  it('isSafeHref allows relative, anchor and http(s)/mailto only', () => {
    for (const ok of ['#history', 'pages/01.md', '../x.md', 'https://example.com', 'HTTP://x', 'mailto:a@b.c', '/abs']) expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:x', 'java\tscript:x', 'java\nscript:x', 'javascript&colon;x', '&#106;avascript:x', '&#x6A;avascript:x', 'data:text/html,<b>', 'vbscript:x']) expect(isSafeHref(bad), bad).toBe(false);
  });

  it('renders unsafe links and images as plain text, keeps safe ones', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](JAVASCRIPT:x) ![c](javascript:y) [d](https://ok.example) <javascript:z> [e](#sec) <b onclick=x>raw</b>');
    expect(hrefs(html)).toEqual(['https://ok.example', '#sec']);
    expect(html).toContain('a');
    expect(html).not.toMatch(/<b onclick/);
    expect(html).not.toMatch(/href="\s*javascript/i);
  });

  it('a project whose README, file names and symbols carry javascript: links cannot inject one into the report', async () => {
    const evil = '[click](javascript:alert(document.domain))';
    const { analysis: a } = await analyzeMem({
      'README.md': `# Demo ${evil}\n\n${evil} <img src=x onerror=alert(1)>\n`,
      'package.json': JSON.stringify({ name: evil, description: evil }),
      'src/[x](javascript:alert(1)).ts': `export function x() { return 1; }\n`,
      'src/app.ts': `// TODO ${evil}\nexport const a = '${evil}';\nexport function run() { return '${evil}'; }\n`,
    }, evil);
    const text = fullMarkdown(a);
    expect(text).toContain('## Orientation');
    // layer 1: the report escapes analysed text (the project name used to reach the summary unescaped)
    const plain = new Marked().parse(text, { async: false, gfm: true }) as string;
    expect(hrefs(plain).filter((h) => !isSafeHref(h))).toEqual([]);
    for (const p of notionPages(a)) expect(hrefs(new Marked().parse(p.content, { async: false }) as string).filter((h) => !isSafeHref(h)), p.path).toEqual([]);
    // layer 2: the preview renderer drops unsafe schemes whatever the Markdown says
    const html = renderMarkdown(text);
    expect(hrefs(html).filter((h) => !isSafeHref(h))).toEqual([]);
    expect(html).not.toMatch(/javascript:alert[^<]*<\/a>/);
    expect(html).not.toMatch(/<img/);
  });
});
