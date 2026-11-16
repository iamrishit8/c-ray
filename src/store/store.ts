import { create } from 'zustand';
import type { InputSource } from '../core/ingest/ingest';
import { DEFAULT_IGNORE, DEFAULT_OPTIONS, type Analysis, type AnalysisOptions, type Progress } from '../core/types';
import * as db from '../db/db';
import type { ProjectMeta, Retention } from '../db/db';
import { fromDirectoryHandle, type Picked } from '../ui/input';
import { worker, WorkerError } from '../workers/client';

export interface Settings {
  retention: Retention;
  ignore: string[];
  respectGitignore: boolean;
  maxFileMB: number;
  parseTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  retention: '7d', ignore: DEFAULT_IGNORE, respectGitignore: true, maxFileMB: 2, parseTimeoutMs: 2000,
};

export type Tab = string;

interface State {
  theme: 'light' | 'dark';
  ready: boolean;
  projects: ProjectMeta[];
  settings: Settings;
  storage: { usage: number; quota: number } | null;
  status: 'idle' | 'analyzing' | 'ready' | 'error';
  error: string | null;
  notice: string | null;
  progress: Progress | null;
  analysis: Analysis | null;
  persisted: boolean;
  tab: Tab;
  source: { path: string; line: number; endLine?: number } | null;
  /** Cross-view selection (e.g. "show impact of this file"). */
  focus: { file?: string; symbol?: number; entry?: string } | null;

  init: () => Promise<void>;
  toggleTheme: () => void;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshProjects: () => Promise<void>;
  analyze: (picked: Picked) => Promise<void>;
  reanalyze: (id: string) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  cancel: () => void;
  goHome: () => void;
  setTab: (tab: Tab, focus?: State['focus']) => void;
  openSource: (path: string, line?: number, endLine?: number) => void;
  closeSource: () => void;
  dismiss: () => void;
}

function optionsFrom(s: Settings): Partial<AnalysisOptions> {
  return {
    ignore: s.ignore, respectGitignore: s.respectGitignore,
    maxFileBytes: Math.round(s.maxFileMB * 1024 * 1024) || DEFAULT_OPTIONS.maxFileBytes,
    parseTimeoutMs: s.parseTimeoutMs || DEFAULT_OPTIONS.parseTimeoutMs,
  };
}

function describeError(e: unknown): string {
  if (e instanceof WorkerError) return e.userFacing ? e.message : `Analysis failed: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export const useStore = create<State>((set, get) => {
  const run = async (name: string, start: (onEvent: (e: import('../workers/protocol').WorkerEvent) => void) => Promise<{ meta: ProjectMeta | null; persisted: boolean }>) => {
    set({ status: 'analyzing', error: null, notice: null, analysis: null, progress: { phase: 'Starting', discovered: 0, parsed: 0, skipped: 0, total: 0 }, tab: 'orientation', source: null, focus: null });
    try {
      const res = await start((e) => {
        if (e.type === 'progress') set({ progress: e.progress });
        else set({ analysis: e.analysis });
      });
      const a = get().analysis;
      if (!a || a.files.length === 0) {
        const skipped = a?.skipped.length ?? 0;
        set({
          status: 'error', analysis: skipped ? a : null, progress: null,
          error: skipped
            ? `Nothing analysable was found in "${name}": all ${a!.coverage.discovered} file(s) were skipped (binary, ignored, too large …). See the skipped list below.`
            : `"${name}" contains no files.`,
        });
        return;
      }
      set({ status: 'ready', progress: null, persisted: res.persisted });
      await get().refreshProjects();
    } catch (e) {
      if (e instanceof WorkerError && e.message === 'Cancelled.') set({ status: 'idle', progress: null, analysis: null });
      else set({ status: 'error', error: describeError(e), progress: null, analysis: null });
    }
  };

  return {
    theme: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    ready: false, projects: [], settings: DEFAULT_SETTINGS, storage: null,
    status: 'idle', error: null, notice: null, progress: null, analysis: null, persisted: false,
    tab: 'orientation', source: null, focus: null,

    async init() {
      try {
        const saved = await db.getSetting<Partial<Settings>>('settings', {});
        set({ settings: { ...DEFAULT_SETTINGS, ...saved } });
        const purged = await db.purgeExpired();
        if (purged) set({ notice: `${purged} expired project${purged === 1 ? ' was' : 's were'} removed from browser storage.` });
      } catch {
        set({ notice: 'Browser storage (IndexedDB) is unavailable; analyses will not be saved between visits.' });
      }
      await get().refreshProjects();
      set({ ready: true });
    },

    toggleTheme() {
      const theme = get().theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', theme === 'dark');
      try {
        localStorage.setItem('c-ray-theme', theme);
      } catch {
        /* private mode */
      }
      set({ theme });
    },

    async setSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      await db.setSetting('settings', settings);
      if (patch.retention) {
        await db.applyRetention(patch.retention).catch(() => {});
        await db.purgeExpired().catch(() => {});
        await get().refreshProjects();
      }
    },

    async refreshProjects() {
      try {
        set({ projects: await db.listProjects(), storage: await db.storageEstimate() });
      } catch {
        set({ projects: [] });
      }
    },

    async analyze(picked) {
      const { settings } = get();
      await run(picked.name, async (onEvent) => {
        const res = await worker.call('analyze', { source: picked.source as InputSource, name: picked.name, options: optionsFrom(settings), retention: settings.retention, hasHandle: !!picked.handle }, onEvent);
        if (picked.handle && res.meta) await db.saveHandle(res.meta.id, picked.handle);
        return res;
      });
    },

    async reanalyze(id) {
      const { settings, projects } = get();
      const meta = projects.find((p) => p.id === id);
      // Prefer re-reading from disk when the browser still holds a folder handle.
      const handle = (await db.getHandle(id)) as (FileSystemDirectoryHandle & { requestPermission?: (o: { mode: string }) => Promise<string> }) | undefined;
      if (handle?.requestPermission) {
        try {
          if ((await handle.requestPermission({ mode: 'read' })) === 'granted') {
            const picked = await fromDirectoryHandle(handle, settings.ignore);
            if (picked) return get().analyze(picked);
          }
        } catch {
          /* fall back to stored sources */
        }
      }
      await run(meta?.name ?? 'project', (onEvent) => worker.call('reanalyze', { projectId: id, options: optionsFrom(settings), retention: settings.retention }, onEvent));
    },

    async openProject(id) {
      set({ status: 'analyzing', error: null, progress: { phase: 'Loading from browser storage', discovered: 0, parsed: 0, skipped: 0, total: 0 }, source: null, focus: null });
      try {
        const { analysis } = await worker.call('open', { projectId: id });
        if (!analysis) {
          set({ status: 'error', error: 'This project is no longer in browser storage.', progress: null });
          await get().refreshProjects();
          return;
        }
        set({ analysis, status: 'ready', progress: null, persisted: true, tab: 'orientation' });
      } catch (e) {
        set({ status: 'error', error: describeError(e), progress: null });
      }
    },

    async deleteProject(id) {
      await db.deleteProject(id).catch(() => {});
      await get().refreshProjects();
    },

    async clearAll() {
      await db.clearAll().catch(() => {});
      await get().refreshProjects();
      set({ notice: 'All stored projects were deleted.' });
    },

    cancel() {
      worker.cancel();
    },

    goHome() {
      void worker.call('close', {}).catch(() => {});
      set({ status: 'idle', analysis: null, error: null, progress: null, source: null, focus: null });
      void get().refreshProjects();
    },

    setTab(tab, focus) {
      set({ tab, focus: focus ?? null });
    },
    openSource(path, line = 1, endLine) {
      set({ source: { path, line, endLine } });
    },
    closeSource() {
      set({ source: null });
    },
    dismiss() {
      if (get().status === 'error') set({ status: 'idle', analysis: null, error: null, notice: null });
      else set({ error: null, notice: null });
    },
  };
});
