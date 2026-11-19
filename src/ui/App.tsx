// App shell: top bar (logo, project crumb, privacy pill, theme), banners, then Home or the project view.
import { useEffect } from 'react';
import { Lock, Moon, Sun } from 'lucide-react';
import { useStore } from '../store/store';
import { Home } from './Home';
import { Skeleton } from './kit';
import { LogoMark } from './Logo';
import { ProjectView } from './ProjectView';
import { ProgressPanel } from './ProgressPanel';

export function App() {
  const { init, ready, status, analysis, theme, toggleTheme, goHome, error, notice, dismiss } = useStore();
  useEffect(() => {
    void init();
  }, [init]);

  const showProject = analysis && analysis.files.length > 0 && status !== 'error';
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <div className="flex h-full flex-col">
      <header className="no-print sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-4 backdrop-blur md:px-5">
        <button className="logo-link flex items-center gap-2.5 text-[18px] font-semibold tracking-[-0.03em] text-[var(--fg)]" onClick={goHome} title="Home" data-testid="home-link">
          <LogoMark busy={status === 'analyzing'} />
          imex
        </button>
        {showProject && (
          <>
            <span className="faint">/</span>
            <span className="min-w-0 truncate font-medium" data-testid="project-name">{analysis.name}</span>
            {analysis.mode === 'file' && <span className="label rounded-full bg-[var(--bg3)] px-2 py-0.5">File Mode</span>}
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-[var(--bg3)] px-3 py-1 text-[12.5px] muted" title="All analysis runs in this browser tab. No code, metadata or telemetry is sent anywhere." data-testid="privacy-pill">
          <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[var(--ok)]" />
          <Lock aria-hidden="true" size={12} className="sm:hidden" />
          <span className="hidden sm:inline">100% local · nothing leaves this browser</span>
        </span>
        <button className="btn btn-round" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel} data-testid="theme-toggle">
          {theme === 'dark' ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
        </button>
      </header>
      {(error || notice) && (
        <div role="alert" data-testid={error ? 'error-banner' : 'notice-banner'} className={`no-print flex items-start gap-3 border-b border-[var(--line)] bg-[var(--bg2)] px-5 py-2.5 text-[13px] ${error ? 'text-[var(--bad)]' : 'muted'}`}>
          <span className="flex-1">{error ?? notice}</span>
          <button className="btn" onClick={dismiss}>Dismiss</button>
        </div>
      )}
      <main className="print-root min-h-0 flex-1 overflow-auto">
        {!ready ? (
          <div className="mx-auto max-w-3xl p-10" role="status" aria-label="Loading">
            <Skeleton rows={5} />
          </div>
        ) : showProject ? <ProjectView /> : status === 'analyzing' ? <ProgressPanel full /> : <Home />}
      </main>
    </div>
  );
}
