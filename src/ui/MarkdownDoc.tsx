import { useMemo } from 'react';
import { renderMarkdown } from './markdown';
import { Mermaid } from './Mermaid';

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
    return out.map((p) => (p.kind === 'md' ? { ...p, html: renderMarkdown(p.text) } : { ...p, html: '' }));
  }, [markdown]);
  return (
    <div className="md">
      {parts.map((p, i) => (p.kind === 'mermaid' ? <Mermaid key={i} code={p.text} testId="report-diagram" /> : <div key={i} dangerouslySetInnerHTML={{ __html: p.html }} />))}
    </div>
  );
}
