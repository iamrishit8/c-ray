// Analysis progress: a stepper that follows the real pipeline phases, plus a "file wall" with one tile
// per file (sampled to ≤ 400) that fills in, coloured by language, as files are parsed.
import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { langName } from '../core/orientation';
import { fmtNum } from '../core/util';
import { PIPELINE_STEPS, stepOf } from '../core/viz/progress';
import { useStore } from '../store/store';
import { langColors, Swatch } from './kit';

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mt-4 flex items-center gap-1" data-testid="progress-steps" aria-label="Analysis steps">
      {PIPELINE_STEPS.map((s, i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'todo';
        return (
          <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="flex w-full items-center">
              <span className={`h-px flex-1 ${i === 0 ? 'opacity-0' : i <= step ? 'bg-[var(--accent)]' : 'bg-[var(--line2)]'}`} />
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] transition-colors duration-200 ${
                  state === 'done' ? 'border-transparent bg-[var(--accent)] text-[var(--accent-fg)]' : state === 'current' ? 'border-[var(--accent)] text-[var(--accent-text)]' : 'border-[var(--line2)] faint'
                }`}
              >
                {state === 'done' ? <Check aria-hidden="true" size={11} strokeWidth={3} /> : i + 1}
              </span>
              <span className={`h-px flex-1 ${i === PIPELINE_STEPS.length - 1 ? 'opacity-0' : i < step ? 'bg-[var(--accent)]' : 'bg-[var(--line2)]'}`} />
            </span>
            <span className={`truncate text-[11px] ${state === 'current' ? 'font-medium text-[var(--fg)]' : 'faint'}`}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

function FileWall({ tiles, lit }: { tiles: string[]; lit: number }) {
  const { color, top } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tiles) counts.set(t, (counts.get(t) ?? 0) + 1);
    const langs = [...counts].map(([lang, loc]) => ({ lang, loc }));
    return { color: langColors(langs), top: langs.sort((x, y) => y.loc - x.loc).slice(0, 4) };
  }, [tiles]);
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-[3px]" data-testid="file-wall" aria-hidden="true">
        {tiles.map((t, i) => (
          <span key={i} className="h-[9px] w-[9px] rounded-[2px] transition-[background-color,opacity] duration-200" style={{ background: i < lit ? color(t) : 'var(--bg4)', opacity: i < lit ? 1 : 0.6 }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {top.map((l) => <Swatch key={l.lang} color={color(l.lang)}>{langName(l.lang)}</Swatch>)}
      </div>
    </div>
  );
}

export function ProgressPanel({ full = false }: { full?: boolean }) {
  const { progress, cancel } = useStore();
  if (!progress) return null;
  const frac = progress.total > 0 ? Math.min(1, progress.parsed / progress.total) : 0;
  const step = stepOf(progress.phase);
  const tiles = progress.tiles ?? [];
  // during parsing the wall fills with the parsed share; afterwards every file has been read
  const lit = step > 1 ? tiles.length : step === 1 ? Math.round(frac * tiles.length) : 0;
  const body = (
    <div className="card w-full max-w-xl px-5 py-4" data-testid="progress" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="label">Analysing in this browser</div>
          <div className="mt-0.5 font-medium">{progress.phase}…</div>
        </div>
        <button className="btn" onClick={cancel}>Cancel</button>
      </div>
      {step >= 0 && <Stepper step={step} />}
      {full && tiles.length > 0 ? <FileWall tiles={tiles} lit={lit} /> : (
        <div className="bar mt-3 !h-1.5">
          <span className="bg-[var(--accent)] transition-[width]" style={{ width: `${progress.total ? Math.round(frac * 100) : 5}%` }} />
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
        <div><div className="label">Discovered</div><span className="tnum font-medium">{fmtNum(progress.discovered)}</span></div>
        <div><div className="label">Parsed</div><span className="tnum font-medium">{fmtNum(progress.parsed)}</span>{progress.total ? <span className="tnum faint"> / {fmtNum(progress.total)}</span> : null}</div>
        <div><div className="label">Skipped</div><span className="tnum font-medium">{fmtNum(progress.skipped)}</span></div>
      </div>
      {progress.detail && <div className="mono mt-2 truncate text-xs faint">{progress.detail}</div>}
    </div>
  );
  return full ? <div className="flex h-full items-center justify-center p-6">{body}</div> : body;
}
