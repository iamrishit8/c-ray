import { useStore } from '../store/store';
import { fmtNum } from '../core/util';

export function ProgressPanel({ full = false }: { full?: boolean }) {
  const { progress, cancel } = useStore();
  if (!progress) return null;
  const frac = progress.total > 0 ? Math.min(1, progress.parsed / progress.total) : 0;
  const body = (
    <div className="card w-full max-w-xl px-5 py-4" data-testid="progress" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="label">Analysing in this browser</div>
          <div className="mt-0.5 font-medium">{progress.phase}…</div>
        </div>
        <button className="btn" onClick={cancel}>Cancel</button>
      </div>
      <div className="bar mt-3 !h-1.5">
        <span className="bg-[var(--accent)] transition-[width]" style={{ width: `${progress.total ? Math.round(frac * 100) : 5}%` }} />
      </div>
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
