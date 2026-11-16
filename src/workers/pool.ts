// A small pool of nested parse workers. Falls back to inline processing when
// nested workers are unavailable, and survives individual worker crashes.
import type { FileResult } from '../core/pipeline';
import type { AnalysisOptions, FileUnit } from '../core/types';
import { tick } from '../core/util';
import { processUnit } from './process';

const BATCH_BYTES = 400_000;
const BATCH_FILES = 60;

export class ParsePool {
  private workers: Worker[] = [];
  private failed = false;

  constructor(private size = Math.max(1, Math.min(6, (self.navigator?.hardwareConcurrency ?? 4) - 1))) {}

  private spawn(): Worker | null {
    if (this.failed) return null;
    try {
      return new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.failed = true;
      return null;
    }
  }

  async run(units: FileUnit[], opts: AnalysisOptions, onFile: (path: string) => void): Promise<FileResult[]> {
    const results: FileResult[] = new Array(units.length);
    const batches: number[][] = [];
    let cur: number[] = [];
    let bytes = 0;
    units.forEach((u, i) => {
      cur.push(i);
      bytes += u.size;
      if (bytes >= BATCH_BYTES || cur.length >= BATCH_FILES) {
        batches.push(cur);
        cur = [];
        bytes = 0;
      }
    });
    if (cur.length) batches.push(cur);

    const inline = async (batch: number[]) => {
      for (const i of batch) {
        results[i] = await processUnit(units[i], opts);
        onFile(units[i].path);
      }
      await tick();
    };

    let next = 0;
    const lane = async (slot: number) => {
      let w: Worker | null = this.workers[slot] ?? this.spawn();
      if (w) this.workers[slot] = w;
      while (next < batches.length) {
        const batch = batches[next++];
        if (!w) {
          await inline(batch);
          continue;
        }
        try {
          const res = await new Promise<FileResult[]>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('parse worker timed out')), Math.max(30_000, batch.length * (opts.parseTimeoutMs + 500)));
            w!.onmessage = (e) => {
              clearTimeout(timer);
              resolve(e.data.results);
            };
            w!.onerror = (e) => {
              clearTimeout(timer);
              reject(new Error(e.message || 'parse worker crashed'));
            };
            w!.postMessage({ id: next, units: batch.map((i) => units[i]), opts });
          });
          batch.forEach((i, k) => {
            results[i] = res[k];
            onFile(units[i].path);
          });
        } catch {
          // The worker died or hung: replace it and process this batch inline so nothing is lost.
          w.terminate();
          w = this.spawn();
          if (w) this.workers[slot] = w;
          await inline(batch);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.size, Math.max(1, batches.length)) }, (_, i) => lane(i)));
    return results;
  }

  dispose() {
    for (const w of this.workers) w?.terminate();
    this.workers = [];
  }
}
