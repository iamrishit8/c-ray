import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { worker } from '../workers/client';

const WINDOW = 400;

/** Right-hand source preview. Renders a window of lines around the target so huge files stay cheap. */
export function SourcePanel() {
  const { source, closeSource, analysis } = useStore();
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [range, setRange] = useState<[number, number]>([1, WINDOW]);
  const target = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!source) return;
    let live = true;
    setText(undefined);
    worker.call('source', { path: source.path }).then((r) => {
      if (!live) return;
      setText(r.text);
      const start = Math.max(1, source.line - WINDOW / 2);
      setRange([start, start + WINDOW]);
    }).catch(() => live && setText(null));
    return () => {
      live = false;
    };
  }, [source]);

  useEffect(() => {
    target.current?.scrollIntoView({ block: 'center' });
  }, [text, source]);

  if (!source) return null;
  const lines = text ? text.split('\n') : [];
  const info = analysis?.files.find((f) => f.path === source.path);
  const [from, to] = range;
  const hlEnd = source.endLine ?? source.line;
  return (
    <aside className="no-print flex w-[46%] min-w-[340px] max-w-[760px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--bg)]" data-testid="source-panel">
      <header className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5">
        <div className="mono min-w-0 flex-1 truncate text-xs" title={source.path}>{source.path}<span className="faint">:{source.line}</span></div>
        {info && <span className="text-xs faint">{info.lang} · {info.loc} lines</span>}
        <button className="btn" onClick={closeSource} aria-label="Close source preview">Close</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {text === undefined && <div className="p-4 muted">Loading…</div>}
        {text === null && (
          <div className="p-4 muted" data-testid="source-missing">
            Source text for this file is not available. It was not stored (browser storage was full, or the file was skipped). Re-drop the project to see sources again.
          </div>
        )}
        {text && (
          <>
            {from > 1 && <button className="link block w-full py-1 text-center text-xs" onClick={() => setRange([Math.max(1, from - WINDOW), to])}>Show earlier lines</button>}
            <pre className="m-0 text-[12px] leading-[18px]">
              {lines.slice(from - 1, to).map((l, i) => {
                const n = from + i;
                const hl = n >= source.line && n <= hlEnd;
                return (
                  <div key={n} ref={n === source.line ? target : undefined} className="flex" style={hl ? { background: 'var(--hl)' } : undefined} data-line={n}>
                    <span className="w-12 shrink-0 select-none pr-3 text-right faint">{n}</span>
                    <span className="whitespace-pre">{l || ' '}</span>
                  </div>
                );
              })}
            </pre>
            {to < lines.length && <button className="link block w-full py-1 text-center text-xs" onClick={() => setRange([from, to + WINDOW])}>Show later lines ({lines.length - to} more)</button>}
          </>
        )}
      </div>
    </aside>
  );
}
