// IndexedDB persistence. Usable from the main thread and from workers.
// Nothing here ever leaves the browser.
import { openDB, type IDBPDatabase } from 'idb';
import type { CachedFile } from '../core/pipeline';
import type { Analysis, FileUnit } from '../core/types';

export type Retention = '1d' | '7d' | '30d' | 'forever';
export const RETENTION_MS: Record<Retention, number | null> = {
  '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, forever: null,
};

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number | null;
  contentHash: string;
  mode: 'project' | 'file';
  files: number;
  loc: number;
  langs: string[];
  /** Approximate bytes stored for this project. */
  bytes: number;
  hasSources: boolean;
  sourcesDropped: boolean;
  hasHandle: boolean;
}

const DB_NAME = 'c-ray';
const DB_VERSION = 1;
const CHUNK = 400;

let dbp: Promise<IDBPDatabase> | null = null;
export function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('analyses');
        d.createObjectStore('sources'); // key: [projectId, path]
        d.createObjectStore('cache'); // key: [projectId, chunk]
        d.createObjectStore('settings');
        d.createObjectStore('handles');
      },
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

function range(projectId: string): IDBKeyRange {
  return IDBKeyRange.bound([projectId], [projectId, []]);
}

function isQuota(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await (await db()).get('settings', key);
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put('settings', value, key);
  } catch {
    /* storage unavailable: settings stay in memory only */
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = (await (await db()).getAll('projects')) as ProjectMeta[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadAnalysis(id: string): Promise<Analysis | undefined> {
  return (await db()).get('analyses', id);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'analyses', 'sources', 'cache', 'handles'], 'readwrite');
  await Promise.all([
    tx.objectStore('projects').delete(id),
    tx.objectStore('analyses').delete(id),
    tx.objectStore('sources').delete(range(id)),
    tx.objectStore('cache').delete(range(id)),
    tx.objectStore('handles').delete(id),
    tx.done,
  ]);
}

export async function clearAll(): Promise<void> {
  const d = await db();
  const names = ['projects', 'analyses', 'sources', 'cache', 'handles'];
  const tx = d.transaction(names, 'readwrite');
  await Promise.all([...names.map((n) => tx.objectStore(n).clear()), tx.done]);
}

/** Deletes projects past their expiry. Returns the number removed. */
export async function purgeExpired(now = Date.now()): Promise<number> {
  let n = 0;
  for (const p of await listProjects()) {
    if (p.expiresAt !== null && p.expiresAt <= now) {
      await deleteProject(p.id);
      n++;
    }
  }
  return n;
}

/** Re-applies a retention setting to every stored project. */
export async function applyRetention(retention: Retention): Promise<void> {
  const d = await db();
  const ms = RETENTION_MS[retention];
  for (const p of await listProjects()) {
    p.expiresAt = ms === null ? null : p.createdAt + ms;
    await d.put('projects', p);
  }
}

export async function saveSources(projectId: string, units: FileUnit[]): Promise<boolean> {
  const d = await db();
  try {
    await d.delete('sources', range(projectId));
    for (let i = 0; i < units.length; i += CHUNK) {
      const tx = d.transaction('sources', 'readwrite');
      for (const u of units.slice(i, i + CHUNK)) void tx.store.put(u.text, [projectId, u.path]);
      await tx.done;
    }
    return true;
  } catch (e) {
    // Quota hit (or storage failure): source previews are the first thing to go.
    await d.delete('sources', range(projectId)).catch(() => {});
    if (!isQuota(e)) console.warn('saveSources failed', e);
    return false;
  }
}

export async function getSource(projectId: string, path: string): Promise<string | undefined> {
  return (await db()).get('sources', [projectId, path]);
}

export async function loadAllSources(projectId: string): Promise<{ path: string; text: string }[]> {
  const d = await db();
  const out: { path: string; text: string }[] = [];
  let cursor = await d.transaction('sources').store.openCursor(range(projectId));
  while (cursor) {
    out.push({ path: (cursor.key as [string, string])[1], text: cursor.value as string });
    cursor = await cursor.continue();
  }
  return out;
}

export async function loadCache(projectId: string): Promise<Map<string, CachedFile>> {
  const d = await db();
  const chunks = (await d.getAll('cache', range(projectId))) as [string, CachedFile][][];
  const m = new Map<string, CachedFile>();
  for (const c of chunks) for (const [k, v] of c) m.set(k, v);
  return m;
}

export async function saveCache(projectId: string, entries: Map<string, CachedFile>): Promise<void> {
  const d = await db();
  await d.delete('cache', range(projectId));
  const arr = [...entries];
  try {
    for (let i = 0, c = 0; i < arr.length; i += CHUNK, c++) await d.put('cache', arr.slice(i, i + CHUNK), [projectId, c]);
  } catch (e) {
    await d.delete('cache', range(projectId)).catch(() => {});
    throw e;
  }
}

export async function saveProject(
  a: Analysis,
  units: FileUnit[] | null,
  retention: Retention,
  hasHandle = false,
): Promise<ProjectMeta> {
  const d = await db();
  let hasSources = false;
  let sourcesDropped = false;
  let bytes = 0;
  if (units) {
    hasSources = await saveSources(a.projectId, units);
    sourcesDropped = !hasSources && units.length > 0;
    if (hasSources) bytes += units.reduce((s, u) => s + u.size, 0);
  } else {
    const prev = (await d.get('projects', a.projectId)) as ProjectMeta | undefined;
    hasSources = prev?.hasSources ?? false;
    bytes = prev?.bytes ?? 0;
  }
  if (sourcesDropped && !a.notices.some((n) => n.includes('Source previews'))) {
    a.notices.push('Browser storage is full: source previews were not stored for this project. Analysis results are kept; re-drop the project to see sources again.');
  }
  const ms = RETENTION_MS[retention];
  const meta: ProjectMeta = {
    id: a.projectId, name: a.name, createdAt: a.createdAt, expiresAt: ms === null ? null : a.createdAt + ms,
    contentHash: a.contentHash, mode: a.mode, files: a.files.length,
    loc: a.files.reduce((s, f) => s + f.loc, 0),
    langs: a.l0.languages.slice(0, 4).map((l) => l.lang),
    bytes, hasSources, sourcesDropped, hasHandle,
  };
  const put = async () => {
    const tx = d.transaction(['projects', 'analyses'], 'readwrite');
    await Promise.all([tx.objectStore('analyses').put(a, a.projectId), tx.objectStore('projects').put(meta), tx.done]);
  };
  try {
    await put();
  } catch (e) {
    if (!isQuota(e) || !hasSources) throw e;
    // Out of space even for the analysis: drop this project's sources and retry once.
    await d.delete('sources', range(a.projectId));
    meta.hasSources = false;
    meta.sourcesDropped = true;
    meta.bytes = 0;
    a.notices.push('Browser storage is full: source previews were dropped to make room for the analysis results.');
    await put();
  }
  // Rough size of the analysis record, added after the fact so the list shows real usage.
  meta.bytes += estimateSize(a);
  await d.put('projects', meta);
  return meta;
}

function estimateSize(a: Analysis): number {
  // Sampling avoids stringifying tens of MB just for a size label.
  const sample = <T,>(arr: T[]) => (arr.length === 0 ? 0 : (JSON.stringify(arr.slice(0, 200)).length / Math.min(200, arr.length)) * arr.length);
  return Math.round(sample(a.files) + sample(a.symbols) + sample(a.imports) + sample(a.refs) + sample(a.findings) + sample(a.skipped) + 20_000);
}

export async function saveHandle(projectId: string, handle: unknown): Promise<void> {
  try {
    await (await db()).put('handles', handle, projectId);
  } catch {
    /* handles are optional */
  }
}

export async function getHandle(projectId: string): Promise<unknown> {
  try {
    return await (await db()).get('handles', projectId);
  } catch {
    return undefined;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* not available */
  }
  return null;
}
