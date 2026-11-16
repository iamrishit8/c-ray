import { useEffect } from 'react';
import { useStore } from '../store/store';
import { Home } from './Home';
import { ProjectView } from './ProjectView';
import { ProgressPanel } from './ProgressPanel';

export function App() {
  const { init, ready, status, analysis, theme, toggleTheme, goHome, error, notice, dismiss } = useStore();
  useEffect(() => {
    void init();
  }, [init]);

  const showProject = analysis && analysis.files.length > 0 && status !== 'error';
  return (
    <div className="flex h-full flex-col">
      <header className="no-print flex h-11 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg2)] px-4">
        <button className="link flex items-center gap-2 font-semibold !text-[var(--fg)] !no-underline" onClick={goHome} title="Home">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--accent)] text-[11px] font-bold text-[var(--accent-fg)]">C</span>
          C-Ray
        </button>
        {showProject && (
          <>
            <span className="faint">/</span>
            <span className="truncate font-medium" data-testid="project-name">{analysis.name}</span>
            {analysis.mode === 'file' && <span className="rounded bg-[var(--bg3)] px-1.5 text-[11px] muted">File Mode</span>}
          </>
        )}
        <span className="ml-auto hidden text-xs faint sm:inline" title="All analysis runs in this browser tab. No code, metadata or telemetry is sent anywhere.">
          100% local · nothing leaves this browser
        </span>
        <button className="btn" onClick={toggleTheme} aria-label="Toggle theme" data-testid="theme-toggle">{theme === 'dark' ? 'Light' : 'Dark'}</button>
      </header>
      {(error || notice) && (
        <div role="alert" data-testid={error ? 'error-banner' : 'notice-banner'} className={`no-print flex items-start gap-3 border-b border-[var(--line)] px-4 py-2 text-[13px] ${error ? 'text-[var(--bad)]' : 'muted'} bg-[var(--bg2)]`}>
          <span className="flex-1">{error ?? notice}</span>
          <button className="btn" onClick={dismiss}>Dismiss</button>
        </div>
      )}
      <main className="print-root min-h-0 flex-1 overflow-auto">
        {!ready ? <div className="p-6 muted">Loading…</div> : showProject ? <ProjectView /> : status === 'analyzing' ? <ProgressPanel full /> : <Home />}
      </main>
    </div>
  );
}
