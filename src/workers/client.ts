// UI-thread side of the worker RPC.
import type { Requests, RpcRequest, RpcResponse, WorkerEvent } from './protocol';

export class WorkerError extends Error {
  constructor(message: string, readonly userFacing: boolean) {
    super(message);
  }
}

class Client {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onEvent?: (e: WorkerEvent) => void }>();

  private ensure(): Worker {
    if (!this.worker) {
      const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<RpcResponse>) => {
        const m = e.data;
        const p = this.pending.get(m.id);
        if (!p) return;
        if (m.kind === 'event') p.onEvent?.(m.event);
        else {
          this.pending.delete(m.id);
          if (m.kind === 'result') p.resolve(m.data);
          else p.reject(new WorkerError(m.message, m.userFacing));
        }
      };
      w.onerror = (e) => {
        // A crashed worker must not take the UI down: fail what was pending and start fresh next call.
        for (const p of this.pending.values()) p.reject(new WorkerError(`The analysis worker stopped unexpectedly (${e.message || 'out of memory?'}).`, true));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
      this.worker = w;
    }
    return this.worker;
  }

  call<K extends keyof Requests>(type: K, payload: Requests[K]['req'], onEvent?: (e: WorkerEvent) => void): Promise<Requests[K]['res']> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onEvent });
      this.ensure().postMessage({ id, type, payload } satisfies RpcRequest);
    });
  }

  /** Hard-cancel: terminate the worker (and its pool) and reject everything pending. */
  cancel() {
    for (const p of this.pending.values()) p.reject(new WorkerError('Cancelled.', true));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}

export const worker = new Client();
