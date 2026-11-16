/// <reference lib="webworker" />
// Dedicated worker for the TypeScript compiler (large, lazily loaded).
import { runL2, type L2Input } from '../core/l2/tsgraph';

self.onmessage = (e: MessageEvent<L2Input>) => {
  try {
    (self as unknown as Worker).postMessage({ ok: true, result: runL2(e.data) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
