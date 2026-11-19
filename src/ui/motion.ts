// Motion helpers (D36): reduced-motion check, View Transitions with a no-op fallback, count-up numbers.
// Motion has a job here (a transition, drawing the eye, playing back a sequence); nothing loops while idle.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => unknown };

/** Runs a state change inside a View Transition (cross-fade + rise) when the browser supports it. */
export function withViewTransition(update: () => void) {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  try {
    doc.startViewTransition(() => flushSync(update));
  } catch {
    // a transition already running or an unsupported state: apply the change without animation
    update();
  }
}

/** Duration in ms of a CSS motion token, for JS-driven animations (0 under reduced motion). */
export function dur(token: 1 | 2 | 3): number {
  return reducedMotion() ? 0 : token === 1 ? 120 : token === 2 ? 200 : 320;
}

const NUM = /^-?[\d,]+(\.\d+)?$/;

/** Counts from the previous value (0 on first render) to `value`. Keeps the `en-US` thousands format. */
export function useCountUp(value: number, ms = 600): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const v = a + (value - a) * e;
      setShown(t < 1 ? v : value);
      from.current = t < 1 ? v : value;
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/** A number written as text ("1,234", "12", "0.42") that counts up; anything else renders as is. */
export function CountUp({ text }: { text: string }) {
  const parsed = NUM.test(text) ? Number(text.replace(/,/g, '')) : NaN;
  const decimals = text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
  const v = useCountUp(Number.isFinite(parsed) ? parsed : 0);
  if (!Number.isFinite(parsed)) return text;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
