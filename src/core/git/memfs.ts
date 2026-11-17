// Minimal in-memory file system implementing the subset of the Node fs
// promises API that isomorphic-git needs. Holds the uploaded .git directory.
function err(code: string, path: string): Error {
  const e = new Error(`${code}: ${path}`) as Error & { code: string };
  e.code = code;
  return e;
}
const norm = (p: string) => '/' + p.split('/').filter((s) => s && s !== '.').join('/');
const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';

class Stat {
  mode: number;
  ino = 0;
  uid = 1;
  gid = 1;
  dev = 1;
  ctimeMs: number;
  constructor(readonly type: 'file' | 'dir', readonly size: number, readonly mtimeMs: number) {
    this.mode = type === 'dir' ? 0o40755 : 0o100644;
    this.ctimeMs = mtimeMs;
  }
  isFile() { return this.type === 'file'; }
  isDirectory() { return this.type === 'dir'; }
  isSymbolicLink() { return false; }
}

export class MemFS {
  private files = new Map<string, Uint8Array>();
  private dirs = new Map<string, Set<string>>([['/', new Set()]]);
  private clock = 1;

  private mkdirp(p: string) {
    if (this.dirs.has(p)) return;
    this.mkdirp(parent(p));
    this.dirs.set(p, new Set());
    this.dirs.get(parent(p))!.add(p.slice(p.lastIndexOf('/') + 1));
  }

  /** Synchronous bulk load (used for uploaded .git contents). */
  load(path: string, data: Uint8Array) {
    const p = norm(path);
    this.mkdirp(parent(p));
    this.files.set(p, data);
    this.dirs.get(parent(p))!.add(p.slice(p.lastIndexOf('/') + 1));
  }

  entries(prefix = '/'): [string, Uint8Array][] {
    const pre = norm(prefix);
    return [...this.files].filter(([p]) => p === pre || p.startsWith(pre === '/' ? '/' : pre + '/'));
  }

  promises = {
    readFile: async (path: string, opts?: { encoding?: string } | string): Promise<Uint8Array | string> => {
      const data = this.files.get(norm(path));
      if (!data) throw err(this.dirs.has(norm(path)) ? 'EISDIR' : 'ENOENT', path);
      const enc = typeof opts === 'string' ? opts : opts?.encoding;
      return enc === 'utf8' ? new TextDecoder().decode(data) : data;
    },
    writeFile: async (path: string, data: Uint8Array | string): Promise<void> => {
      const p = norm(path);
      if (!this.dirs.has(parent(p))) throw err('ENOENT', path);
      this.load(p, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
      this.clock++;
    },
    unlink: async (path: string): Promise<void> => {
      const p = norm(path);
      if (!this.files.delete(p)) throw err('ENOENT', path);
      this.dirs.get(parent(p))?.delete(p.slice(p.lastIndexOf('/') + 1));
    },
    readdir: async (path: string): Promise<string[]> => {
      const d = this.dirs.get(norm(path));
      if (!d) throw err(this.files.has(norm(path)) ? 'ENOTDIR' : 'ENOENT', path);
      return [...d].sort();
    },
    mkdir: async (path: string): Promise<void> => {
      const p = norm(path);
      if (this.dirs.has(p) || this.files.has(p)) throw err('EEXIST', path);
      if (!this.dirs.has(parent(p))) throw err('ENOENT', path);
      this.mkdirp(p);
    },
    rmdir: async (path: string): Promise<void> => {
      const p = norm(path);
      const d = this.dirs.get(p);
      if (!d) throw err('ENOENT', path);
      if (d.size) throw err('ENOTEMPTY', path);
      this.dirs.delete(p);
      this.dirs.get(parent(p))?.delete(p.slice(p.lastIndexOf('/') + 1));
    },
    stat: async (path: string): Promise<Stat> => {
      const p = norm(path);
      const f = this.files.get(p);
      if (f) return new Stat('file', f.length, this.clock);
      if (this.dirs.has(p)) return new Stat('dir', 0, this.clock);
      throw err('ENOENT', path);
    },
    lstat: async (path: string): Promise<Stat> => this.promises.stat(path),
    readlink: async (path: string): Promise<string> => {
      throw err('EINVAL', path);
    },
    symlink: async (_target: string, path: string): Promise<void> => {
      throw err('EPERM', path);
    },
    chmod: async (): Promise<void> => {},
  };
}
