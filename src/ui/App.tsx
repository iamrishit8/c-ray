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
      <header className="no-print flex h-12 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg2)] px-4">
        <button className="link flex items-center gap-2 font-semibold !text-[var(--fg)] !no-underline" onClick={goHome} title="Home">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent)] text-[12px] font-bold text-[var(--accent-fg)]">C</span>
          C-Ray
        </button>
        {showProject && (
          <>
            <span className="faint">/</span>
            <span className="truncate font-medium" data-testid="project-name">{analysis.name}</span>
            {analysis.mode === 'file' && <span className="rounded bg-[var(--bg3)] px-1.5 text-[11px] muted">File Mode</span>}
          </>
        )}
        <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg)] px-2.5 py-0.5 text-xs muted sm:inline-flex" title="All analysis runs in this browser tab. No code, metadata or telemetry is sent anywhere.">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          100% local · nothing leaves this browser
        </span>
        <button className="btn btn-icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} data-testid="theme-toggle">
          {theme === 'dark' ? (
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          ) : (
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          )}
        </button>
      </header>
      {(error || notice) && (
        <div role="alert" data-testid={error ? 'error-banner' : 'notice-banner'} className={`no-print flex items-start gap-3 border-b border-[var(--line)] px-4 py-2 text-[13px] ${error ? 'text-[var(--bad)]' : 'muted'} bg-[var(--bg2)]`}>
          <span className="flex-1">{error ?? notice}</span>
          <button className="btn" onClick={dismiss}>Dismiss</button>
        </div>
      )}
      <main className="print-root min-h-0 flex-1 overflow-auto">
        {!ready ? <div className="p-6 muted" role="status">Loading…</div> : showProject ? <ProjectView /> : status === 'analyzing' ? <ProgressPanel full /> : <Home />}
      </main>
    </div>
  );
}
