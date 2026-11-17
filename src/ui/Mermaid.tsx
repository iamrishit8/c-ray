import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';

let seq = 0;

/** Renders Mermaid source to inline SVG (Mermaid is loaded lazily). Falls back to showing the source on error. */
export function Mermaid({ code, testId }: { code: string; testId?: string }) {
  const theme = useStore((s) => s.theme);
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    setDone(false);
    setError(null);
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral', er: { useMaxWidth: true }, flowchart: { useMaxWidth: true, htmlLabels: true } });
        const { svg } = await mermaid.render(`mmd-${++seq}`, code);
        if (live && ref.current) {
          ref.current.innerHTML = svg;
          setDone(true);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [code, theme]);
  return (
    <div className="mermaid-box overflow-auto" data-testid={testId} data-rendered={done ? 'yes' : error ? 'error' : 'pending'}>
      <div ref={ref} />
      {error && (
        <div>
          <div className="text-xs text-[var(--bad)]">Diagram could not be rendered: {error}</div>
          <pre className="mt-1 text-xs">{code}</pre>
        </div>
      )}
    </div>
  );
}
