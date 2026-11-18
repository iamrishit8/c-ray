// WCAG contrast audit of the design tokens in src/index.css, light and dark (U2).
// Checks the text/background pairs the UI actually renders. Exits 1 if any pair is below its minimum.
// Usage: npm run audit:contrast
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const block = (sel) => {
  const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(css);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]]));
};
const light = block(':root');
const dark = { ...light, ...block('.dark') };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** color-mix(in srgb, a p%, b) */
const mix = (a, b, p) => '#' + rgb(a).map((v, i) => Math.round(v * p / 100 + rgb(b)[i] * (1 - p / 100)).toString(16).padStart(2, '0')).join('');
const TINT_TEXT = 78;

let failures = 0;
const rows = [];
for (const [name, t] of [['light', light], ['dark', dark]]) {
  const soft = name === 'dark' ? 16 : 10;
  const check = (label, fg, bg, need) => {
    const r = ratio(fg, bg);
    if (r < need) failures++;
    rows.push(`${name.padEnd(5)} ${r >= need ? 'ok ' : 'LOW'} ${label.padEnd(34)} ${r.toFixed(2).padStart(5)}  (min ${need})`);
  };
  for (const [fg, bg] of [['fg', 'bg'], ['fg', 'bg2'], ['fg2', 'bg'], ['fg2', 'bg2'], ['fg2', 'bg3'], ['fg3', 'bg'], ['fg3', 'bg2'], ['accent-text', 'bg'], ['accent-text', 'bg2'], ['bg', 'fg'], ['ok', 'bg2'], ['warn', 'bg2'], ['bad', 'bg2']]) check(`${fg} on ${bg}`, t[fg], t[bg], 4.5);
  check('accent-fg on accent (button text)', t['accent-fg'], t.accent, 4.5);
  check('accent-text on accent-soft (selected)', t['accent-text'], mix(t.accent, t.bg2, name === 'dark' ? 18 : 12), 4.5);
  for (const k of ['ok', 'warn', 'bad']) check(`${k} badge text on its tint`, mix(t[k], t.fg, TINT_TEXT), mix(t[k], t.bg2, k === 'warn' ? (name === 'dark' ? 16 : 12) : soft), 4.5);
  for (const f of ['route', 'service', 'model', 'test', 'int', 'config']) {
    check(`r-${f} role badge text on its tint`, mix(t[`r-${f}`], t.fg, TINT_TEXT), mix(t[`r-${f}`], t.bg2, soft), 4.5);
    check(`r-${f} graph dot on bg2`, t[`r-${f}`], t.bg2, 3);
  }
}
console.log(rows.join('\n'));
console.log(failures ? `\n${failures} pair(s) below minimum` : '\nall pairs pass');
process.exit(failures ? 1 : 0);
