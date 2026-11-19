// React wrapper around Cytoscape (lazy-loaded) shared by the system map, flow graphs and call graphs.
// Every colour comes from the CSS tokens at runtime, so the graph follows the theme (D27).
// Node data: `label`, optional `sub` (second line), `role` (role dot), `kind: 'dir'` (cluster), `tone`, `conf`,
// `dotColor` (a token like 'var(--r-int)', replaces the role dot), `heat` (0..1, replaces the role dot), `pad` (size).
// Edge data: `count` (width + pill label), `conf` (solid / dashed / dotted), `tone`.
// Motion (D36): new nodes glide out of the folder they were in, focused edges march briefly, a dot can travel
// along an edge (flow playback), a located node pulses. All of it is off above 200 nodes or under reduced motion.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Core, EdgeCollection, ElementDefinition, LayoutOptions, StylesheetJson } from 'cytoscape';
import { Download, Maximize2, Minus, Plus } from 'lucide-react';
import type { Role } from '../core/types';
import { useStore } from '../store/store';
import { FAMILY_LABEL, ROLE_FAMILY, type RoleFamily } from './kit';
import { renderMermaidSvg } from './Mermaid';
import { reducedMotion } from './motion';

export interface GraphProps {
  elements: ElementDefinition[];
  layout?: 'fcose' | 'elk' | 'breadthfirst' | 'grid';
  onSelect?: (id: string | null) => void;
  onOpen?: (id: string) => void;
  onZoom?: (cy: Core) => void;
  className?: string;
  testId?: string;
  /** Extra legend rows (e.g. flow step tones), shown under the role colours. */
  legend?: { label: string; color: string; dashed?: boolean; fill?: boolean }[];
  /** Hide the minimap (small graphs). Defaults to hiding it below 12 nodes. */
  minimap?: boolean;
  /** Elements to highlight (path finder, flow playback); everything else fades. `current` / `edge` mark the active step. */
  highlight?: { nodes: string[]; edges: string[]; current?: string; edge?: string } | null;
  /** Animate a dot along this edge (flow playback); change `key` to replay. */
  travel?: { edge: string; key: number; ms: number } | null;
  /** Centre on this node and pulse it (e.g. a search result located on the map); change `key` to replay. */
  pulse?: { id: string; key: number } | null;
  /** Shows the export menu; the download is named `<exportName>.png|svg`. */
  exportName?: string;
  /** Mermaid source of the current view, for the SVG export. */
  toMermaid?: () => string;
  /** Hide the role legend rows (when nodes are coloured by something else). */
  hideRoles?: boolean;
}

/** Above this many nodes graph animations are switched off (D36). */
export const ANIMATE_MAX_NODES = 200;

let registered = false;
async function load() {
  const [{ default: cytoscape }, { default: fcose }] = await Promise.all([import('cytoscape'), import('cytoscape-fcose')]);
  if (!registered) {
    cytoscape.use(fcose);
    registered = true;
  }
  return cytoscape;
}
let elkRegistered = false;
async function loadElk(cytoscape: { use: (ext: never) => void }) {
  if (!elkRegistered) {
    const { default: elk } = await import('cytoscape-elk');
    cytoscape.use(elk as never);
    elkRegistered = true;
  }
}

/** Resolved value of a CSS custom property on <html> (where `.dark` swaps them). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const FAMILIES: RoleFamily[] = ['route', 'service', 'model', 'test', 'int', 'config'];
// Canvas font strings reject some CSS generics (ui-monospace, system-ui), so keep this list plain.
const FONT = '"Google Sans Variable", "Google Sans", sans-serif';
/** Canvas text only uses a webfont that is already loaded; wait for it (bounded) before drawing. */
const fontsReady = typeof document !== 'undefined' && document.fonts
  ? Promise.race([Promise.all(['500 11px "Google Sans Variable"', '600 11px "Google Sans Variable"'].map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 1500))])
  : Promise.resolve();

function tokens() {
  const v = (n: string) => cssVar(`--${n}`);
  return {
    bg: v('bg'), bg2: v('bg2'), bg3: v('bg3'), fg: v('fg'), fg2: v('fg2'), fg3: v('fg3'), line: v('line'), line2: v('line2'),
    accent: v('accent'), ok: v('ok'), warn: v('warn'), bad: v('bad'),
    roles: Object.fromEntries(FAMILIES.map((f) => [f, v(`r-${f}`)])) as Record<RoleFamily, string>,
    resolve: (color: string) => (color.startsWith('var(') ? v(color.slice(6, -1)) : color),
  };
}
type Tokens = ReturnType<typeof tokens>;

/** Mixes two #rrggbb colours (canvas styles cannot use color-mix()). */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => { const v = h.replace('#', ''); const f = v.length === 3 ? v.split('').map((c) => c + c).join('') : v; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
  const [x, y] = [p(a), p(b)];
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return b;
  return '#' + x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('');
}
/** Same scale as `heat()` in kit.tsx, in 6 bins so Cytoscape caches few dot images. */
function heatHex(c: Tokens, t: number): string {
  const v = Math.round(Math.max(0, Math.min(1, t)) * 5) / 5;
  return v < 0.7 ? mixHex(c.bg3, c.accent, 0.18 + (v / 0.7) * 0.72) : mixHex(c.accent, c.bad, (v - 0.7) / 0.3);
}

const dot = (color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3.5" fill="${color}"/></svg>`)}`;

function stylesheet(c: Tokens, elk: boolean): StylesheetJson {
  return [
    { selector: 'node', style: {
      label: 'data(label)', 'font-family': FONT, 'font-size': 11.5, 'font-weight': 500, color: c.fg, 'text-valign': 'center', 'text-halign': 'center',
      'background-color': c.bg2, 'border-width': 1, 'border-color': c.line2, shape: 'round-rectangle', width: 'label', height: 'label', padding: '9px',
      'text-wrap': 'ellipsis', 'text-max-width': '200px', 'min-zoomed-font-size': 6, 'transition-property': 'opacity', 'transition-duration': 120,
    } },
    { selector: 'node[sub]', style: { label: (n: { data: (k: string) => string }) => `${n.data('label')}\n${n.data('sub')}`, 'text-wrap': 'wrap', 'line-height': 1.45, 'text-justify': 'left' } },
    // role dot on the left; the label is nudged right to make room
    ...FAMILIES.map((f) => ({ selector: `node[family="${f}"]`, style: {
      'background-image': dot(c.roles[f]), 'background-width': '7px', 'background-height': '7px', 'background-position-x': '9px', 'background-position-y': '11px',
      'background-clip': 'none', 'background-image-containment': 'over', 'text-margin-x': 7, padding: '12px',
    } })),
    // colour-by / size-by overrides
    { selector: 'node[dotc]', style: {
      'background-image': (n: { data: (k: string) => string }) => { const d = n.data('dotc'); return dot(d.startsWith('heat:') ? heatHex(c, Number(d.slice(5))) : c.resolve(d)); },
      'background-width': '7px', 'background-height': '7px', 'background-position-x': '9px', 'background-position-y': '11px',
      'background-clip': 'none', 'background-image-containment': 'over', 'text-margin-x': 7, padding: '12px',
    } },
    { selector: 'node[pad]', style: { padding: (n: { data: (k: string) => number }) => `${n.data('pad')}px` } },
    // collapsed directory = cluster you can open
    { selector: 'node[kind="dir"]', style: { 'background-color': c.bg3, 'border-color': c.line2, 'font-weight': 600 } },
    // expanded directory = soft folder box with a mono label at its top-left
    { selector: ':parent', style: {
      'background-color': c.bg3, 'background-opacity': 0.55, 'border-color': c.line2, 'border-width': 1, shape: 'round-rectangle', padding: '18px',
      'text-valign': 'top', 'text-halign': 'center', 'text-justify': 'left', 'text-margin-y': -4, 'font-size': 10.5, 'font-weight': 500, color: c.fg3,
      'text-transform': 'uppercase', 'text-max-width': '400px',
    } },
    { selector: 'node[tone="accent"]', style: { 'border-color': c.accent, 'border-width': 1.6 } },
    { selector: 'node[tone="warn"]', style: { 'border-color': c.warn, 'border-width': 1.6 } },
    { selector: 'node[tone="bad"]', style: { 'border-color': c.bad, 'border-width': 1.6 } },
    // unresolved = what static analysis could not see: dashed and dimmed
    { selector: 'node[conf="unresolved"]', style: { 'border-style': 'dashed', color: c.fg3, opacity: 0.75 } },
    { selector: 'edge', style: {
      width: 'mapData(count, 1, 20, 1.1, 3.5)', 'line-color': c.fg3, 'target-arrow-color': c.fg3, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.75,
      'line-opacity': 0.5, 'curve-style': elk ? 'taxi' : 'bezier', 'taxi-direction': 'rightward', 'taxi-turn': '50%', 'taxi-turn-min-distance': 12,
      label: 'data(label)', 'font-family': FONT, 'font-size': 10, 'font-weight': 500, color: c.fg2, 'min-zoomed-font-size': 7,
      'text-background-color': c.bg2, 'text-background-opacity': 1, 'text-background-shape': 'round-rectangle', 'text-background-padding': '3px',
      'text-border-width': 1, 'text-border-color': c.line2, 'text-border-opacity': 1,
    } },
    { selector: 'edge[label=""]', style: { 'text-background-opacity': 0, 'text-border-opacity': 0 } },
    { selector: 'edge[conf="heuristic"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [5, 4] } },
    { selector: 'edge[conf="unresolved"]', style: { 'line-style': 'dotted', 'line-dash-pattern': [1.5, 4], 'line-cap': 'round' } },
    { selector: 'edge[tone="bad"]', style: { 'line-color': c.bad, 'target-arrow-color': c.bad, 'line-opacity': 0.9 } },
    // focus mode: the selected node, its neighbours and their edges stand out; everything else fades
    { selector: '.faded', style: { opacity: 0.28 } },
    { selector: 'edge.faded', style: { opacity: 0.12 } },
    { selector: 'node.nb', style: { 'border-color': c.accent, 'border-opacity': 0.55 } },
    { selector: 'node.focus', style: { 'border-color': c.accent, 'border-width': 2, 'border-opacity': 1 } },
    { selector: 'edge.hot', style: { 'line-color': c.accent, 'target-arrow-color': c.accent, 'line-opacity': 1, width: 'mapData(count, 1, 20, 1.7, 4)', color: c.accent, 'text-border-color': c.accent, 'z-index': 10 } },
    { selector: 'edge:selected', style: { 'line-color': c.accent, 'target-arrow-color': c.accent, 'line-opacity': 1 } },
    // highlighted path / playback step
    { selector: 'node.on-path', style: { 'border-color': c.accent, 'border-width': 1.8, opacity: 1 } },
    { selector: 'edge.on-path', style: { 'line-color': c.accent, 'target-arrow-color': c.accent, 'line-opacity': 0.95, opacity: 1, width: 2.4, 'z-index': 9 } },
    { selector: 'node.step', style: { 'border-width': 3, 'background-color': mixHex(c.bg2, c.accent, 0.16) } },
    { selector: 'edge.step', style: { width: 3.4 } },
  ] as unknown as StylesheetJson;
}

/** "Marching ants" on the focused node's edges for a moment, to show direction; then the confidence style returns. */
let stopAnts: (() => void) | null = null;
function ants(cy: Core, edges: EdgeCollection) {
  stopAnts?.();
  if (reducedMotion() || cy.nodes().length > ANIMATE_MAX_NODES || edges.empty()) return;
  const t0 = performance.now();
  let frame = 0;
  const clear = () => {
    cancelAnimationFrame(frame);
    if (!cy.destroyed()) edges.removeStyle('line-style line-dash-pattern line-dash-offset');
    stopAnts = null;
  };
  const step = (now: number) => {
    if (cy.destroyed()) return;
    const t = now - t0;
    if (t > 1600) return clear();
    edges.style({ 'line-style': 'dashed', 'line-dash-pattern': [6, 4], 'line-dash-offset': -t / 25 });
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  stopAnts = clear;
}

function focus(cy: Core, id: string | null) {
  stopAnts?.();
  cy.batch(() => {
    cy.elements().removeClass('faded nb focus hot');
    if (!id) return;
    const el = cy.getElementById(id);
    if (!el.nonempty() || !el.isNode()) return;
    const hood = el.closedNeighborhood();
    // keep the folder boxes around the neighbourhood visible
    const keep = hood.union(hood.ancestors());
    cy.elements().not(keep).addClass('faded');
    hood.nodes().not(el).addClass('nb');
    el.addClass('focus');
    el.connectedEdges().addClass('hot');
  });
  if (id) ants(cy, cy.getElementById(id).connectedEdges());
}

/** New nodes start where their folder was and glide to their place (expanding a cluster). */
function glide(inst: Core, oldPos: Map<string, { x: number; y: number }>) {
  if (reducedMotion() || oldPos.size === 0 || inst.nodes().length > ANIMATE_MAX_NODES) return;
  inst.nodes().forEach((n) => {
    if (n.isParent() || oldPos.has(n.id())) return;
    const path = n.id().replace(/^(file|dir):/, '');
    const parts = path.split('/');
    for (let k = parts.length - 1; k > 0; k--) {
      const from = oldPos.get('dir:' + parts.slice(0, k).join('/'));
      if (!from) continue;
      const to = { ...n.position() };
      n.position(from);
      n.animate({ position: to }, { duration: 320, easing: 'ease-out-cubic' });
      return;
    }
  });
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Small overview of the whole graph with the current viewport; click or drag to move there. */
function Minimap({ cy }: { cy: Core }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 150;
  const H = 96;
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = 0;
      const canvas = ref.current;
      if (!canvas || cy.destroyed()) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const bb = cy.elements().boundingBox();
      if (!isFinite(bb.w) || bb.w === 0) return;
      const s = Math.min((W - 8) / bb.w, (H - 8) / bb.h);
      const ox = (W - bb.w * s) / 2 - bb.x1 * s;
      const oy = (H - bb.h * s) / 2 - bb.y1 * s;
      ctx.fillStyle = cssVar('--fg3');
      ctx.globalAlpha = 0.45;
      cy.nodes().forEach((n) => {
        if (n.isParent()) return;
        const b = n.boundingBox();
        ctx.fillRect(b.x1 * s + ox, b.y1 * s + oy, Math.max(2, b.w * s), Math.max(2, b.h * s));
      });
      const f = cy.nodes('.focus');
      if (f.nonempty()) {
        const b = f.boundingBox();
        ctx.globalAlpha = 1;
        ctx.fillStyle = cssVar('--accent');
        ctx.fillRect(b.x1 * s + ox, b.y1 * s + oy, Math.max(3, b.w * s), Math.max(3, b.h * s));
      }
      const e = cy.extent();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cssVar('--accent');
      ctx.lineWidth = 1.5;
      ctx.strokeRect(e.x1 * s + ox, e.y1 * s + oy, e.w * s, e.h * s);
      (canvas as HTMLCanvasElement & { _map?: { s: number; ox: number; oy: number } })._map = { s, ox, oy };
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    cy.on('viewport render layoutstop', schedule);
    schedule();
    return () => {
      cy.removeListener('viewport render layoutstop', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [cy]);
  const move = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ev.currentTarget as HTMLCanvasElement & { _map?: { s: number; ox: number; oy: number } };
    const m = canvas._map;
    if (!m) return;
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left - m.ox) / m.s;
    const y = (ev.clientY - r.top - m.oy) / m.s;
    const z = cy.zoom();
    cy.pan({ x: cy.width() / 2 - x * z, y: cy.height() / 2 - y * z });
  };
  return (
    <div className="overlay bottom-3.5 right-3.5 p-1.5 max-[900px]:hidden" data-testid="graph-minimap">
      <canvas ref={ref} style={{ width: W, height: H, display: 'block', cursor: 'pointer' }} aria-label="Minimap: click to move the view" role="img"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }} onPointerMove={(e) => e.buttons === 1 && move(e)} />
    </div>
  );
}

export function Graph({ elements, layout = 'fcose', onSelect, onOpen, onZoom, className = '', testId, legend, minimap, highlight, travel, pulse, exportName, toMermaid, hideRoles }: GraphProps) {
  const dotRef = useRef<HTMLSpanElement>(null);
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [cy, setCy] = useState<Core | null>(null);
  const theme = useStore((s) => s.theme);
  const handlers = useRef({ onSelect, onOpen, onZoom });
  handlers.current = { onSelect, onOpen, onZoom };

  // role colours actually present, for the legend
  const families = useMemo(() => {
    const seen = new Set<RoleFamily>();
    for (const e of elements) if (e.data.role) seen.add(ROLE_FAMILY[e.data.role as Role]);
    return FAMILIES.filter((f) => seen.has(f));
  }, [elements]);
  const withFamily = useMemo(() => elements.map((e) => {
    const d = { ...e.data };
    if (d.role) d.family = ROLE_FAMILY[d.role as Role];
    if (typeof d.heat === 'number') d.dotc = `heat:${d.heat}`;
    else if (d.dotColor) d.dotc = d.dotColor;
    return { ...e, data: d };
  }), [elements]);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const [cytoscape] = await Promise.all([load(), fontsReady]);
      if (layout === 'elk') await loadElk(cytoscape);
      if (dead || !ref.current) return;
      const prev = cyRef.current;
      const oldPos = new Map<string, { x: number; y: number }>();
      prev?.nodes().forEach((n) => void oldPos.set(n.id(), { ...n.position() }));
      const hadView = prev ? { zoom: prev.zoom(), pan: { ...prev.pan() } } : null;
      prev?.destroy();
      const inst = cytoscape({ container: ref.current, elements: withFamily, minZoom: 0.05, maxZoom: 4, wheelSensitivity: 0.3, style: stylesheet(tokens(), layout === 'elk') });
      cyRef.current = inst;
      const keep = oldPos.size > 0 && inst.nodes().toArray().some((n) => oldPos.has(n.id()));
      if (keep) inst.nodes().forEach((n) => { const p = oldPos.get(n.id()); if (p && !n.isParent()) n.position(p); });
      const n = inst.nodes().length;
      const opts: Record<string, unknown> =
        layout === 'elk' ? { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.spacing.nodeNode': 26, 'elk.layered.spacing.nodeNodeBetweenLayers': 70 }, fit: !hadView, padding: 28 }
        : layout === 'breadthfirst' ? { name: 'breadthfirst', directed: true, spacingFactor: 1.15, fit: true, padding: 28 }
        : layout === 'grid' ? { name: 'grid', fit: true, padding: 28 }
        : { name: 'fcose', quality: n > 250 ? 'draft' : 'default', randomize: !keep, animate: false, fit: !keep, padding: 32, nodeRepulsion: 9000, idealEdgeLength: 100, nodeSeparation: 70, packComponents: true, numIter: n > 250 ? 800 : 2500 };
      try {
        inst.layout(opts as unknown as LayoutOptions).run();
      } catch {
        inst.layout({ name: 'grid' }).run();
      }
      if (keep && hadView) inst.viewport(hadView);
      // tiny graphs: fitting would blow 3 nodes up to poster size
      else if (inst.zoom() > 1.25) {
        inst.zoom(1.25);
        inst.center();
      }
      glide(inst, oldPos);
      inst.on('tap', 'node', (e) => {
        focus(inst, e.target.id());
        handlers.current.onSelect?.(e.target.id());
      });
      inst.on('tap', 'edge', (e) => handlers.current.onSelect?.(e.target.id()));
      inst.on('tap', (e) => {
        if (e.target !== inst) return;
        focus(inst, null);
        handlers.current.onSelect?.(null);
      });
      inst.on('dbltap', 'node', (e) => handlers.current.onOpen?.(e.target.id()));
      let timer: ReturnType<typeof setTimeout> | undefined;
      inst.on('zoom', () => {
        clearTimeout(timer);
        timer = setTimeout(() => handlers.current.onZoom?.(inst), 180);
      });
      (window as unknown as { __cy?: Core }).__cy = inst;
      setCy(inst);
    })();
    return () => {
      dead = true;
    };
  }, [withFamily, layout]);

  // theme change: restyle in place (keeps layout, zoom and focus)
  useEffect(() => {
    cyRef.current?.style(stylesheet(tokens(), layout === 'elk'));
  }, [theme, layout]);

  useEffect(() => () => cyRef.current?.destroy(), []);

  // highlighted path / playback step
  useEffect(() => {
    if (!cy || cy.destroyed()) return;
    cy.batch(() => {
      cy.elements().removeClass('on-path step');
      if (!highlight) {
        if (cy.$('.focus').empty()) cy.elements().removeClass('faded');
        return;
      }
      cy.elements().removeClass('faded nb focus hot');
      const on = cy.collection();
      for (const id of [...highlight.nodes, ...highlight.edges]) on.merge(cy.getElementById(id));
      on.addClass('on-path');
      cy.elements().not(on.union(on.ancestors())).addClass('faded');
      if (highlight.current) cy.getElementById(highlight.current).addClass('step');
      if (highlight.edge) cy.getElementById(highlight.edge).addClass('step');
    });
  }, [cy, highlight]);

  // a dot travels along the active edge
  useEffect(() => {
    const el = dotRef.current;
    if (!cy || !el || !travel || cy.destroyed()) return;
    const edge = cy.getElementById(travel.edge);
    if (edge.empty() || !edge.isEdge()) return;
    const tgt = edge.target();
    const ext = cy.extent();
    const p = tgt.position();
    if (p.x < ext.x1 || p.x > ext.x2 || p.y < ext.y1 || p.y > ext.y2) cy.center(tgt);
    if (reducedMotion() || cy.nodes().length > ANIMATE_MAX_NODES) return;
    const a = edge.source().renderedPosition();
    const b = tgt.renderedPosition();
    const anim = el.animate([{ transform: `translate(${a.x}px, ${a.y}px)`, opacity: 1 }, { transform: `translate(${b.x}px, ${b.y}px)`, opacity: 1, offset: 0.9 }, { transform: `translate(${b.x}px, ${b.y}px)`, opacity: 0 }], { duration: Math.max(200, travel.ms * 0.8), easing: 'ease-in-out' });
    return () => anim.cancel();
  }, [cy, travel]);

  // locate: centre on a node, focus it and pulse
  useEffect(() => {
    if (!cy || !pulse || cy.destroyed()) return;
    const el = cy.getElementById(pulse.id);
    if (el.empty()) return;
    const done = () => {
      if (cy.destroyed()) return;
      focus(cy, pulse.id);
      const p = el.renderedPosition();
      setRing({ x: p.x, y: p.y, key: pulse.key });
    };
    if (reducedMotion()) {
      cy.center(el);
      done();
    } else cy.animate({ center: { eles: el }, zoom: Math.max(cy.zoom(), 1) }, { duration: 320, easing: 'ease-out-cubic', complete: done });
  }, [cy, pulse]);

  const exportPng = async () => {
    setMenu(false);
    const c = cyRef.current;
    if (!c) return;
    const blob = (await c.png({ full: true, scale: 2, bg: cssVar('--bg'), output: 'blob-promise' })) as Blob;
    download(`${exportName}.png`, blob);
  };
  const exportSvg = async () => {
    setMenu(false);
    if (!toMermaid) return;
    const svg = await renderMermaidSvg(toMermaid());
    download(`${exportName}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
  };

  const zoomBy = (f: number) => {
    const c = cyRef.current;
    if (!c) return;
    c.zoom({ level: Math.min(c.maxZoom(), Math.max(c.minZoom(), c.zoom() * f)), renderedPosition: { x: c.width() / 2, y: c.height() / 2 } });
  };
  const showMini = minimap ?? elements.filter((e) => !e.data.source).length >= 12;
  return (
    <div className={`canvas relative h-full w-full overflow-hidden ${className}`}>
      <div ref={ref} data-testid={testId} className="h-full w-full" />
      <span ref={dotRef} className="travel-dot" style={{ opacity: 0 }} aria-hidden="true" data-testid="travel-dot" />
      {ring && <span key={ring.key} className="pulse-ring" style={{ left: ring.x, top: ring.y }} aria-hidden="true" data-testid="locate-pulse" onAnimationEnd={() => setRing(null)} />}
      <div className="overlay right-3.5 top-3.5 flex flex-col gap-0.5 p-[3px]" role="group" aria-label="Zoom">
        <button className="grid h-[30px] w-[30px] place-items-center rounded-[var(--r-sm)] text-[var(--fg2)] hover:bg-[var(--bg3)] hover:text-[var(--fg)]" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in" data-testid="graph-zoom-in"><Plus aria-hidden="true" size={15} /></button>
        <button className="grid h-[30px] w-[30px] place-items-center rounded-[var(--r-sm)] text-[var(--fg2)] hover:bg-[var(--bg3)] hover:text-[var(--fg)]" onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out" data-testid="graph-zoom-out"><Minus aria-hidden="true" size={15} /></button>
        <button className="grid h-[30px] w-[30px] place-items-center rounded-[var(--r-sm)] text-[var(--fg2)] hover:bg-[var(--bg3)] hover:text-[var(--fg)]" onClick={() => cyRef.current?.fit(undefined, 28)} aria-label="Fit to screen" title="Fit to screen" data-testid="graph-fit"><Maximize2 aria-hidden="true" size={14} /></button>
        {exportName && (
          <button className="grid h-[30px] w-[30px] place-items-center rounded-[var(--r-sm)] text-[var(--fg2)] hover:bg-[var(--bg3)] hover:text-[var(--fg)]" onClick={() => setMenu(!menu)} aria-label="Export this view" title="Export this view" aria-expanded={menu} data-testid="graph-export"><Download aria-hidden="true" size={14} /></button>
        )}
      </div>
      {menu && (
        <div className="overlay right-[58px] top-3.5 flex flex-col p-1 text-[12.5px] fade-in" role="menu" data-testid="graph-export-menu">
          <button role="menuitem" className="rounded-[var(--r-sm)] px-3 py-1.5 text-left hover:bg-[var(--bg3)]" onClick={() => void exportPng()} data-testid="export-png">PNG image (as shown)</button>
          {toMermaid && <button role="menuitem" className="rounded-[var(--r-sm)] px-3 py-1.5 text-left hover:bg-[var(--bg3)]" onClick={() => void exportSvg()} data-testid="export-svg">SVG diagram (via Mermaid)</button>}
        </div>
      )}
      <div className="overlay bottom-3.5 left-3.5 grid max-w-[calc(100%-200px)] grid-cols-[auto_auto] gap-x-4 gap-y-1 px-3.5 py-2.5 text-[11.5px] muted max-[640px]:hidden" data-testid="graph-legend">
        {!hideRoles && families.map((f) => <span key={f} className="whitespace-nowrap"><i aria-hidden="true" className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] align-[-1px]" style={{ background: `var(--r-${f})` }} />{FAMILY_LABEL[f]}</span>)}
        {legend?.map((l) => <span key={l.label} className="whitespace-nowrap"><i aria-hidden="true" className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] border-[1.5px] align-[-1px]" style={{ borderColor: l.color, borderStyle: l.dashed ? 'dashed' : 'solid', background: l.fill ? l.color : undefined }} />{l.label}</span>)}
        <span className="whitespace-nowrap"><span aria-hidden="true" className="mr-1.5 inline-block w-[18px] border-t-[1.6px] border-[var(--fg2)] align-[3px]" />Resolved</span>
        <span className="whitespace-nowrap"><span aria-hidden="true" className="mr-1.5 inline-block w-[18px] border-t-[1.6px] border-dashed border-[var(--fg2)] align-[3px]" />Heuristic</span>
        <span className="whitespace-nowrap"><span aria-hidden="true" className="mr-1.5 inline-block w-[18px] border-t-[1.6px] border-dotted border-[var(--fg2)] align-[3px]" />Unresolved</span>
        <span className="whitespace-nowrap"><span aria-hidden="true" className="mr-1.5 inline-block w-[18px] border-t-[1.6px] border-[var(--accent)] align-[3px]" />In focus</span>
      </div>
      {cy && showMini && <Minimap cy={cy} />}
    </div>
  );
}
