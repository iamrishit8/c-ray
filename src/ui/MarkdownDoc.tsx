import { useMemo } from 'react';
import { marked } from 'marked';
import { Mermaid } from './Mermaid';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Raw HTML in generated Markdown is never trusted: render it as text.
marked.use({ renderer: { html: (token) => esc(typeof token === 'string' ? token : token.text) } });

/** Renders report Markdown; ```mermaid blocks become SVG diagrams. */
export function MarkdownDoc({ markdown }: { markdown: string }) {
  const parts = useMemo(() => {
    const out: { kind: 'md' | 'mermaid'; text: string }[] = [];
    const re = /```mermaid\n([\s\S]*?)\n```/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown))) {
      if (m.index > last) out.push({ kind: 'md', text: markdown.slice(last, m.index) });
      out.push({ kind: 'mermaid', text: m[1] });
      last = m.index + m[0].length;
    }
    if (last < markdown.length) out.push({ kind: 'md', text: markdown.slice(last) });
    return out.map((p) => (p.kind === 'md' ? { ...p, html: marked.parse(p.text, { async: false, gfm: true }) as string } : { ...p, html: '' }));
  }, [markdown]);
  return (
    <div className="md">
      {parts.map((p, i) => (p.kind === 'mermaid' ? <Mermaid key={i} code={p.text} testId="report-diagram" /> : <div key={i} dangerouslySetInnerHTML={{ __html: p.html }} />))}
    </div>
  );
}
