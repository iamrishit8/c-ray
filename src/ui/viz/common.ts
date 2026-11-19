// Small helpers shared by the SVG visualisations in src/ui/viz.
import { useLayoutEffect, useState } from 'react';

/** Width of an element (callback ref, so a remounted element is picked up), kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, fallback]);
  return [setEl, w, el] as const;
}

/** Position for a tooltip near the pointer, kept inside the container. */
export function tipAt(e: { clientX: number; clientY: number }, box: HTMLElement | null, tipW = 260): { x: number; y: number } {
  if (!box) return { x: 0, y: 0 };
  const r = box.getBoundingClientRect();
  const x = e.clientX - r.left + 14;
  return { x: Math.max(4, Math.min(x, r.width - tipW - 4)), y: e.clientY - r.top + 14 };
}

/** Shortens text to roughly fit `px` at ~7 px per mono character, keeping the end (file names matter most). */
export function fit(text: string, px: number, keepEnd = false): string {
  const n = Math.floor(px / 7);
  if (n <= 1) return '';
  if (text.length <= n) return text;
  return keepEnd ? '…' + text.slice(text.length - n + 1) : text.slice(0, n - 1) + '…';
}
