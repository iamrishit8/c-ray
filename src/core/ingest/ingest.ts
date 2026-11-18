// Ingestion: turn a file list / ZIP / in-memory set into analysable text units,
// recording everything that was skipped and why. Never throws on odd input.
import { Unzip, UnzipInflate } from 'fflate';
import type { AnalysisOptions, FileUnit, Progress, SkipReason, SkippedFile } from '../types';
import { CODE_LANGS, detectLanguage, isTestPath } from '../l0/languages';
import { isManifest } from '../l0/l0';
import { basename, decodeText, dirname, hashString, looksBinary, normalizePath, tick } from '../util';
import { classifyByName, IgnoreMatcher, isGenerated, isMinified } from './filter';

export type InputSource =
  | { kind: 'files'; files: { path: string; file: Blob }[] }
  | { kind: 'zip'; file: Blob; name: string }
  /** `keepPaths`: paths are already repo-relative (git snapshots), so no shared root is stripped. */
  | { kind: 'memory'; files: { path: string; text?: string; bytes?: Uint8Array }[]; keepPaths?: boolean };

export interface IngestResult {
  units: FileUnit[];
  skipped: SkippedFile[];
  /** Raw .git directory contents (path relative to the repo root, starting with ".git/"). */
  gitFiles: Map<string, Uint8Array> | null;
  notices: string[];
  discovered: number;
  totalBytes: number;
  analyzedBytes: number;
  limited?: string;
}

interface Candidate {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

const GIT_CAP = 250 * 1024 * 1024;

export class IngestError extends Error {}

function priority(path: string): number {
  const lang = detectLanguage(path);
  let p = CODE_LANGS.has(lang) || isManifest(path) ? 0 : lang === 'markdown' ? 1 : 2;
  if (isTestPath(path)) p += 1;
  return p * 100 + path.split('/').length;
}

/** Strip a single shared top-level directory (the dropped folder / ZIP root). */
function commonRoot(paths: string[]): string {
  if (paths.length === 0) return '';
  const first = paths[0].split('/')[0];
  if (!first || paths.length === 1 && !paths[0].includes('/')) return '';
  for (const p of paths) {
    const i = p.indexOf('/');
    if (i < 0 || p.slice(0, i) !== first) return '';
  }
  return first;
}

class SkipLog {
  list: SkippedFile[] = [];
  private agg = new Map<string, SkippedFile & { count: number }>();
  count = 0;
  private finished = false;

  add(path: string, size: number, reason: SkipReason, detail?: string) {
    this.count++;
    this.list.push({ path, size, reason, detail });
  }

  /** Ignored directories can hold 100k files; record one row per directory. */
  addDir(dir: string, size: number, reason: SkipReason) {
    this.count++;
    const key = reason + ':' + dir;
    const a = this.agg.get(key);
    if (a) {
      a.count++;
      a.size += size;
    } else this.agg.set(key, { path: dir + '/', size, reason, count: 1 });
  }

  finish(): SkippedFile[] {
    if (this.finished) return this.list;
    this.finished = true;
    for (const a of this.agg.values()) this.list.push({ path: a.path, size: a.size, reason: a.reason, detail: `${a.count} file${a.count === 1 ? '' : 's'}` });
    return this.list;
  }
}

/** Finds the shallowest ignored ancestor directory, or null when only the file itself matches. */
function ignoredDir(m: IgnoreMatcher, path: string, cache: Map<string, boolean>): string | null {
  const parts = path.split('/');
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? cur + '/' + parts[i] : parts[i];
    let ig = cache.get(cur);
    if (ig === undefined) {
      ig = m.ignores(cur, true);
      cache.set(cur, ig);
    }
    if (ig) return cur;
  }
  return null;
}

export async function ingest(
  source: InputSource,
  opts: AnalysisOptions,
  onProgress: (p: Partial<Progress>) => void = () => {},
): Promise<IngestResult> {
  const notices: string[] = [];
  const skip = new SkipLog();
  const units: FileUnit[] = [];
  const gitRaw = new Map<string, Uint8Array>();
  let gitBytes = 0;
  let gitDropped = false;
  let discovered = 0;
  let totalBytes = 0;
  let analyzedBytes = 0;
  let limited: string | undefined;
  const matcher = new IgnoreMatcher(opts.ignore.filter((p) => p !== '.git/'));
  const dirCache = new Map<string, boolean>();
  const gitignores: { base: string; text: string }[] = [];

  const isGitPath = (p: string) => p.startsWith('.git/') || p.includes('/.git/');

  const consider = (path: string, size: number): 'git' | 'skip' | 'read' => {
    if (isGitPath(path)) return opts.enableGit && !gitDropped ? 'git' : 'skip';
    if (path.endsWith('/…')) {
      // marker left by the UI directory walk for a pruned (never enumerated) directory
      skip.list.push({ path: path.slice(0, -1), size: 0, reason: 'ignored', detail: 'directory not read' });
      return 'skip';
    }
    discovered++;
    totalBytes += size;
    const dir = ignoredDir(matcher, path, dirCache);
    if (dir) {
      skip.addDir(dir, size, 'ignored');
      return 'skip';
    }
    if (matcher.ignores(path)) {
      skip.add(path, size, /lock|\.sum$/i.test(basename(path)) ? 'lockfile' : classifyByName(path) ?? 'ignored');
      return 'skip';
    }
    const byName = classifyByName(path);
    if (byName) {
      skip.add(path, size, byName);
      if (byName === 'nested-zip') notices.push(`Nested ZIP "${path}" was not unpacked.`);
      return 'skip';
    }
    if (size > opts.maxFileBytes) {
      skip.add(path, size, 'too-large', `${(size / 1024 / 1024).toFixed(1)} MB > ${(opts.maxFileBytes / 1024 / 1024).toFixed(1)} MB cap`);
      return 'skip';
    }
    if (analyzedBytes + size > opts.maxTotalBytes) {
      skip.add(path, size, 'budget');
      limited = `Project exceeds the ${(opts.maxTotalBytes / 1024 / 1024).toFixed(0)} MB in-browser analysis budget; a prioritised subset was analysed.`;
      return 'skip';
    }
    return 'read';
  };

  const accept = (path: string, bytes: Uint8Array) => {
    if (bytes.length > opts.maxFileBytes) return skip.add(path, bytes.length, 'too-large');
    if (looksBinary(bytes)) return skip.add(path, bytes.length, 'binary', 'binary content detected');
    const text = decodeText(bytes);
    if (basename(path) === '.gitignore') gitignores.push({ base: dirname(path), text });
    if (isMinified(text)) return skip.add(path, bytes.length, 'minified', 'long lines / low whitespace');
    if (isGenerated(text)) return skip.add(path, bytes.length, 'generated', 'generated-file header');
    analyzedBytes += bytes.length;
    units.push({ path, text, lang: detectLanguage(path), hash: hashString(text), size: bytes.length });
  };

  const acceptGit = (path: string, bytes: Uint8Array) => {
    gitBytes += bytes.length;
    if (gitBytes > GIT_CAP) {
      gitDropped = true;
      gitRaw.clear();
      notices.push('The .git directory is larger than 250 MB; history features were disabled for this project.');
      return;
    }
    gitRaw.set(path, bytes);
  };

  if (source.kind === 'zip') {
    await readZip(source.file, consider, accept, acceptGit, () => onProgress({ phase: 'Reading ZIP', discovered, skipped: skip.count }));
    if (discovered === 0 && gitRaw.size === 0) throw new IngestError('The ZIP archive contains no files.');
  } else {
    const cands: Candidate[] =
      source.kind === 'files'
        ? source.files.map((f) => ({ path: normalizePath(f.path), size: f.file.size, read: async () => new Uint8Array(await f.file.arrayBuffer()) }))
        : source.files.map((f) => {
            const bytes = f.bytes ?? new TextEncoder().encode(f.text ?? '');
            return { path: normalizePath(f.path), size: bytes.length, read: async () => bytes };
          });
    cands.sort((a, b) => priority(a.path) - priority(b.path) || (a.path < b.path ? -1 : 1));
    let i = 0;
    const worker = async () => {
      while (i < cands.length) {
        const c = cands[i++];
        const verdict = consider(c.path, c.size);
        if (verdict === 'skip') continue;
        try {
          const bytes = await c.read();
          if (verdict === 'git') acceptGit(c.path, bytes);
          else accept(c.path, bytes);
        } catch (e) {
          if (verdict !== 'git') skip.add(c.path, c.size, 'read-error', e instanceof Error ? e.message : String(e));
        }
        if (i % 200 === 0) {
          onProgress({ phase: 'Reading files', discovered, skipped: skip.count });
          await tick();
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  // --- strip a shared root directory so paths are project-relative ---
  skip.finish();
  const allPaths = [...units.map((u) => u.path), ...skip.list.map((s) => s.path), ...gitRaw.keys()];
  const root = source.kind === 'memory' && source.keepPaths ? '' : commonRoot(allPaths);
  const strip = (p: string) => (root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p);
  if (root) {
    for (const u of units) u.path = strip(u.path);
    for (const s of skip.list) s.path = strip(s.path);
    for (const g of gitignores) g.base = g.base === root ? '' : strip(g.base);
  }

  // --- .gitignore (applied after reading so it also works for streamed ZIPs) ---
  let kept = units;
  if (opts.respectGitignore && gitignores.length) {
    const gi = new IgnoreMatcher();
    gitignores.sort((a, b) => a.base.length - b.base.length);
    for (const g of gitignores) gi.add(g.text.split('\n'), g.base);
    const cache = new Map<string, boolean>();
    kept = [];
    for (const u of units) {
      if (ignoredDir(gi, u.path, cache) || gi.ignores(u.path)) {
        skip.add(u.path, u.size, 'gitignore');
        analyzedBytes -= u.size;
      } else kept.push(u);
    }
  }
  kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // --- .git: keep only the repository rooted at the project root ---
  let gitFiles: Map<string, Uint8Array> | null = null;
  if (gitRaw.size) {
    gitFiles = new Map();
    for (const [p, bytes] of gitRaw) {
      const rel = strip(p);
      if (rel.startsWith('.git/')) gitFiles.set(rel, bytes);
    }
    if (gitFiles.size === 0) gitFiles = null;
  }

  return { units: kept, skipped: skip.list, gitFiles, notices, discovered, totalBytes, analyzedBytes, limited };
}

async function readZip(
  blob: Blob,
  consider: (path: string, size: number) => 'git' | 'skip' | 'read',
  accept: (path: string, bytes: Uint8Array) => void,
  acceptGit: (path: string, bytes: Uint8Array) => void,
  progress: () => void,
): Promise<void> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  let entries = 0;
  const state: { failure: Error | null } = { failure: null };
  unzip.onfile = (f) => {
    entries++;
    const path = normalizePath(f.name);
    if (!path || f.name.endsWith('/')) return;
    if (path.startsWith('__MACOSX/') || basename(path) === '.DS_Store') return;
    const verdict = consider(path, f.originalSize ?? 0);
    if (verdict === 'skip') return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    f.ondata = (err, data, final) => {
      if (err) {
        state.failure = new IngestError(`ZIP entry "${path}" is corrupted: ${err.message}`);
        return;
      }
      size += data.length;
      chunks.push(data);
      if (final) {
        const out = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        if (verdict === 'git') acceptGit(path, out);
        else accept(path, out);
      }
    };
    f.start();
  };
  const reader = blob.stream().getReader();
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      unzip.push(value, false);
      if (++n % 16 === 0) {
        progress();
        await tick();
      }
    }
    unzip.push(new Uint8Array(0), true);
  } catch (e) {
    throw new IngestError(`This file is not a readable ZIP archive (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (state.failure) throw state.failure;
  if (entries === 0) throw new IngestError('This file is not a readable ZIP archive (no entries found).');
}
