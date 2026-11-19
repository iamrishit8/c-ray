import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { cssVar } from './Graph';

/** Mermaid's `base` theme fed from the app tokens (hex values; Mermaid derives shades from them). */
function themeVariables() {
  const v = (n: string) => cssVar(`--${n}`);
  return {
    fontFamily: '"Geist Mono", monospace', fontSize: '12.5px',
    background: v('bg2'), mainBkg: v('bg2'), primaryColor: v('bg2'), primaryTextColor: v('fg'), primaryBorderColor: v('line2'),
    secondaryColor: v('bg3'), secondaryTextColor: v('fg'), secondaryBorderColor: v('line2'),
    tertiaryColor: v('bg3'), tertiaryTextColor: v('fg2'), tertiaryBorderColor: v('line2'),
    lineColor: v('fg3'), textColor: v('fg'), nodeTextColor: v('fg'), titleColor: v('fg'),
    clusterBkg: v('bg3'), clusterBorder: v('line2'), edgeLabelBackground: v('bg2'),
    // ER diagrams
    attributeBackgroundColorOdd: v('bg2'), attributeBackgroundColorEven: v('bg3'), rowOdd: v('bg2'), rowEven: v('bg3'),
    // sequence diagrams
    actorBkg: v('bg2'), actorBorder: v('line2'), actorTextColor: v('fg'), actorLineColor: v('line2'), signalColor: v('fg2'), signalTextColor: v('fg'),
    labelBoxBkgColor: v('bg3'), labelBoxBorderColor: v('line2'), labelTextColor: v('fg'), loopTextColor: v('fg2'),
    noteBkgColor: v('hl'), noteBorderColor: v('accent'), noteTextColor: v('fg'), activationBkgColor: v('bg3'), activationBorderColor: v('accent'),
    darkMode: document.documentElement.classList.contains('dark'),
  };
}

let seq = 0;

/** Mermaid source → SVG markup with the app theme (used by <Mermaid> and the graph SVG export). */
export async function renderMermaidSvg(code: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVariables(), er: { useMaxWidth: true }, flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' } });
  return (await mermaid.render(`mmd-${++seq}`, code)).svg;
}

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
        const svg = await renderMermaidSvg(code);
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
