import { useRef, useState } from 'react';
import { DEFAULT_IGNORE } from '../core/types';
import { fmtBytes, fmtNum } from '../core/util';
import type { Retention } from '../db/db';
import { useStore } from '../store/store';
import { canPickDirectory, fromDirectoryHandle, fromDrop, fromFileList } from './input';
import { SkippedList } from './Orientation';

function when(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function Home() {
  const { projects, settings, setSettings, analyze, openProject, reanalyze, deleteProject, clearAll, storage, analysis, status } = useStore();
  const [over, setOver] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const [ignoreText, setIgnoreText] = useState(settings.ignore.join('\n'));
  const [msg, setMsg] = useState<string | null>(null);

  const start = (p: Awaited<ReturnType<typeof fromDrop>>) => {
    if (!p) return setMsg('Nothing to analyse: the selection was empty.');
    setMsg(null);
    void analyze(p);
  };

  const pickDir = async () => {
    if (canPickDirectory) {
      try {
        const handle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
        start(await fromDirectoryHandle(handle, settings.ignore));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') dirInput.current?.click();
      }
    } else dirInput.current?.click();
  };

  const used = projects.reduce((s, p) => s + p.bytes, 0);
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Understand an unfamiliar codebase</h1>
        <p className="mt-1 muted">
          Drop a file, a folder or a ZIP. C-Ray maps the structure, traces request flows, reconstructs the data model and flags risky spots —
          with a confidence level and a source location for every inferred fact. Everything runs in this tab; your code never leaves your machine.
        </p>
      </div>

      <div
        data-testid="dropzone"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void fromDrop(e.dataTransfer, settings.ignore).then(start); }}
        className={`rounded-lg border-2 border-dashed p-10 text-center ${over ? 'border-[var(--accent)] bg-[var(--bg2)]' : 'border-[var(--line)]'}`}
      >
        <div className="text-base font-medium">Drop a folder, files or a ZIP here</div>
        <div className="mt-1 text-[13px] muted">Include the <code>.git</code> folder to unlock history features (churn, co-change, time-travel).</div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={pickDir}>Choose folder</button>
          <button className="btn" onClick={() => fileInput.current?.click()}>Choose files or ZIP</button>
        </div>
        <input ref={fileInput} data-testid="file-input" type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) start(fromFileList(e.target.files)); e.target.value = ''; }} />
        <input ref={dirInput} data-testid="dir-input" type="file" hidden {...({ webkitdirectory: '', directory: '' } as object)} onChange={(e) => { if (e.target.files?.length) start(fromFileList(e.target.files)); e.target.value = ''; }} />
        {msg && <div className="mt-3 text-[13px] text-[var(--bad)]">{msg}</div>}
      </div>

      {status === 'error' && analysis && analysis.skipped.length > 0 && (
        <div className="card p-4" data-testid="skipped-only">
          <SkippedList a={analysis} open />
        </div>
      )}

      <div className="card">
        <button className="flex w-full items-center justify-between px-4 py-2 text-left text-[13px] font-semibold" onClick={() => setShowSettings(!showSettings)} data-testid="settings-toggle">
          Analysis settings: ignore list and limits
          <span className="faint">{showSettings ? 'Hide' : 'Show'}</span>
        </button>
        {showSettings && (
          <div className="grid gap-4 border-t border-[var(--line)] p-4 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-[13px] font-medium">Ignore list (gitignore syntax, one per line)</div>
              <textarea data-testid="ignore-list" className="input mono h-48 w-full" value={ignoreText} onChange={(e) => setIgnoreText(e.target.value)} onBlur={() => void setSettings({ ignore: ignoreText.split('\n').map((l) => l.trim()).filter(Boolean) })} />
              <button className="link mt-1 text-xs" onClick={() => { setIgnoreText(DEFAULT_IGNORE.join('\n')); void setSettings({ ignore: DEFAULT_IGNORE }); }}>Reset to defaults</button>
            </label>
            <div className="space-y-3 text-[13px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.respectGitignore} onChange={(e) => void setSettings({ respectGitignore: e.target.checked })} />
                Respect <code>.gitignore</code> files
              </label>
              <label className="flex items-center justify-between gap-2">
                Per-file size cap (MB)
                <input className="input w-24" type="number" min={0.1} step={0.5} value={settings.maxFileMB} onChange={(e) => void setSettings({ maxFileMB: Number(e.target.value) || 2 })} />
              </label>
              <label className="flex items-center justify-between gap-2">
                Per-file parse timeout (ms)
                <input className="input w-24" type="number" min={100} step={100} value={settings.parseTimeoutMs} onChange={(e) => void setSettings({ parseTimeoutMs: Number(e.target.value) || 2000 })} />
              </label>
              <p className="muted">Minified, generated, binary and image files are detected and skipped automatically. Everything skipped is listed with its reason after analysis.</p>
            </div>
          </div>
        )}
      </div>

      <div className="card" data-testid="project-list">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2">
          <h2 className="text-[13px] font-semibold">Stored projects</h2>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="muted" data-testid="storage-used">
              Storage used: {fmtBytes(storage?.usage ?? used)}{storage?.quota ? ` of ${fmtBytes(storage.quota)}` : ''}
            </span>
            <label className="flex items-center gap-1">
              Keep for
              <select className="input" data-testid="retention" value={settings.retention} onChange={(e) => void setSettings({ retention: e.target.value as Retention })}>
                <option value="1d">1 day</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="forever">until cleared</option>
              </select>
            </label>
            <button className="btn btn-danger" data-testid="clear-all" disabled={projects.length === 0} onClick={() => { if (confirm('Delete all stored projects and analysis data from this browser?')) void clearAll(); }}>Clear all data</button>
          </div>
        </header>
        {projects.length === 0 ? (
          <div className="p-6 text-center muted">No stored projects yet. Analyses are kept in this browser (IndexedDB) and survive refreshes and restarts.</div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Project</th><th>Size</th><th>Languages</th><th>Analysed</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} data-testid="project-row">
                  <td><button className="link font-medium" onClick={() => void openProject(p.id)}>{p.name}</button>{p.sourcesDropped && <div className="text-xs text-[var(--warn)]">source previews not stored (storage full)</div>}</td>
                  <td>{fmtNum(p.files)} files · {fmtNum(p.loc)} lines<div className="text-xs faint">{fmtBytes(p.bytes)} stored</div></td>
                  <td>{p.langs.join(', ')}</td>
                  <td>{when(p.createdAt)}</td>
                  <td>{p.expiresAt === null ? 'never' : new Date(p.expiresAt).toLocaleDateString()}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn" onClick={() => void openProject(p.id)}>Open</button>{' '}
                    <button className="btn" title="Re-run the analysis (re-reads the folder when the browser still has access, otherwise uses stored sources). Unchanged files are not re-parsed." onClick={() => void reanalyze(p.id)}>Re-analyze</button>{' '}
                    <button className="btn btn-danger" onClick={() => void deleteProject(p.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
