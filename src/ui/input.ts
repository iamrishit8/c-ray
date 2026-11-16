// Turning user gestures (drop, file picker, folder picker) into an InputSource.
// Directory walks prune ignored directories early so node_modules is never enumerated.
import { IgnoreMatcher } from '../core/ingest/filter';
import type { InputSource } from '../core/ingest/ingest';

export interface Picked {
  source: InputSource;
  name: string;
  handle?: FileSystemDirectoryHandle;
}

type FileItem = { path: string; file: File };

function isZip(f: File): boolean {
  return /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
}

function finish(files: FileItem[], fallbackName: string): Picked | null {
  if (files.length === 0) return null;
  if (files.length === 1 && isZip(files[0].file)) {
    return { source: { kind: 'zip', file: files[0].file, name: files[0].file.name }, name: files[0].file.name.replace(/\.zip$/i, '') };
  }
  const first = files[0].path.split('/')[0];
  const rooted = files.every((f) => f.path.includes('/') && f.path.split('/')[0] === first);
  const name = rooted ? first : files.length === 1 ? files[0].file.name : fallbackName;
  return { source: { kind: 'files', files }, name };
}

export function fromFileList(list: FileList | File[]): Picked | null {
  const files: FileItem[] = [...list].map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f }));
  return finish(files, `${files.length} files`);
}

function dirMatcher(ignore: string[]): IgnoreMatcher {
  return new IgnoreMatcher(ignore.filter((p) => p !== '.git/'));
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: FileItem[], m: IgnoreMatcher): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File | null>((res) => (entry as FileSystemFileEntry).file(res, () => res(null)));
    if (file) out.push({ path, file });
    return;
  }
  if (m.ignores(path.split('/').slice(1).join('/') || entry.name, true) && prefix) {
    // keep one marker so the ignored directory still shows up in the skipped list
    out.push({ path: `${path}/…`, file: new File([], '…') });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
    if (batch.length === 0) break;
    for (const e of batch) await walkEntry(e, path, out, m);
  }
}

/** Must be called synchronously inside the drop handler (entries are only valid there). */
export function fromDrop(dt: DataTransfer, ignore: string[]): Promise<Picked | null> {
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of [...dt.items]) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) loose.push(f);
    }
  }
  if (entries.length === 0) return Promise.resolve(fromFileList(loose.length ? loose : [...dt.files]));
  const m = dirMatcher(ignore);
  return (async () => {
    const out: FileItem[] = [];
    for (const e of entries) await walkEntry(e, '', out, m);
    return finish(out, `${out.length} files`);
  })();
}

export async function fromDirectoryHandle(handle: FileSystemDirectoryHandle, ignore: string[]): Promise<Picked | null> {
  const m = dirMatcher(ignore);
  const out: FileItem[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, rel: string) => {
    // @ts-expect-error async iteration of directory handles is not in every TS DOM lib
    for await (const [name, h] of dir.entries()) {
      const p = rel ? `${rel}/${name}` : name;
      if (h.kind === 'file') {
        try {
          out.push({ path: `${handle.name}/${p}`, file: await h.getFile() });
        } catch {
          /* unreadable file: skip */
        }
      } else if (m.ignores(p, true)) out.push({ path: `${handle.name}/${p}/…`, file: new File([], '…') });
      else await walk(h, p);
    }
  };
  await walk(handle, '');
  const picked = finish(out, handle.name);
  return picked ? { ...picked, name: handle.name, handle } : null;
}

export const canPickDirectory = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
