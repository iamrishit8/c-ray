import { useStore } from '../store/store';
import { fmtNum } from '../core/util';

export function ProgressPanel({ full = false }: { full?: boolean }) {
  const { progress, cancel } = useStore();
  if (!progress) return null;
  const frac = progress.total > 0 ? Math.min(1, progress.parsed / progress.total) : 0;
  const body = (
    <div className="card w-full max-w-xl p-4" data-testid="progress">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold">{progress.phase}…</div>
        <button className="btn" onClick={cancel}>Cancel</button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded bg-[var(--bg3)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${progress.total ? Math.round(frac * 100) : 5}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
        <div><span className="faint">Discovered</span> <b>{fmtNum(progress.discovered)}</b></div>
        <div><span className="faint">Parsed</span> <b>{fmtNum(progress.parsed)}</b>{progress.total ? <span className="faint"> / {fmtNum(progress.total)}</span> : null}</div>
        <div><span className="faint">Skipped</span> <b>{fmtNum(progress.skipped)}</b></div>
      </div>
      {progress.detail && <div className="mono mt-2 truncate text-xs faint">{progress.detail}</div>}
    </div>
  );
  return full ? <div className="flex h-full items-center justify-center p-6">{body}</div> : body;
}
