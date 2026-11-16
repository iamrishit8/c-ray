// Thin React wrapper around Cytoscape (lazy-loaded) shared by the system map,
// flow graphs, ER diagrams and call graphs.
import { useEffect, useRef } from 'react';
import type { Core, ElementDefinition, LayoutOptions } from 'cytoscape';
import { useStore } from '../store/store';

export interface GraphProps {
  elements: ElementDefinition[];
  layout?: 'fcose' | 'elk' | 'breadthfirst' | 'grid';
  onSelect?: (id: string | null) => void;
  onOpen?: (id: string) => void;
  onZoom?: (cy: Core) => void;
  className?: string;
  testId?: string;
}

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

function palette(dark: boolean) {
  return dark
    ? { fg: '#e6e9ef', sub: '#aab2c0', line: '#3a4352', node: '#1f2530', dir: '#22304a', accent: '#60a5fa', edge: '#7b8494', weak: '#566072', box: '#161a22' }
    : { fg: '#171a21', sub: '#4b5363', line: '#c5ccd8', node: '#ffffff', dir: '#e3ecfb', accent: '#2563eb', edge: '#6b7485', weak: '#a3abb9', box: '#f6f7f9' };
}

export function Graph({ elements, layout = 'fcose', onSelect, onOpen, onZoom, className = '', testId }: GraphProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const theme = useStore((s) => s.theme);
  const handlers = useRef({ onSelect, onOpen, onZoom });
  handlers.current = { onSelect, onOpen, onZoom };

  useEffect(() => {
    let dead = false;
    void (async () => {
      const cytoscape = await load();
      if (layout === 'elk') await loadElk(cytoscape);
      if (dead || !ref.current) return;
      const c = palette(theme === 'dark');
      const prev = cyRef.current;
      const oldPos = new Map<string, { x: number; y: number }>();
      prev?.nodes().forEach((n) => void oldPos.set(n.id(), { ...n.position() }));
      const hadView = prev ? { zoom: prev.zoom(), pan: { ...prev.pan() } } : null;
      prev?.destroy();
      const cy = cytoscape({
        container: ref.current,
        elements,
        minZoom: 0.05,
        maxZoom: 4,
        wheelSensitivity: 0.3,
        style: [
          { selector: 'node', style: { label: 'data(label)', 'font-size': 11, color: c.fg, 'text-valign': 'center', 'text-halign': 'center', 'background-color': c.node, 'border-width': 1, 'border-color': c.line, shape: 'round-rectangle', width: 'label', height: 24, padding: '6px', 'text-wrap': 'ellipsis', 'text-max-width': '180px' } as never },
          { selector: 'node[kind="dir"]', style: { 'background-color': c.dir, 'border-color': c.accent, 'font-weight': 600, height: 30 } as never },
          { selector: 'node[sub]', style: { label: (n: { data: (k: string) => string }) => `${n.data('label')}\n${n.data('sub')}`, 'text-wrap': 'wrap', height: 38 } as never },
          { selector: ':parent', style: { 'background-color': c.box, 'border-color': c.line, 'border-style': 'dashed', 'text-valign': 'top', 'text-halign': 'center', 'font-weight': 600, color: c.sub, padding: '14px' } as never },
          { selector: 'node[tone="accent"]', style: { 'border-color': c.accent, 'border-width': 2 } },
          { selector: 'node[tone="warn"]', style: { 'border-color': '#d97706', 'border-width': 2 } },
          { selector: 'node[tone="bad"]', style: { 'border-color': '#dc2626', 'border-width': 2 } },
          { selector: 'edge', style: { width: 'mapData(count, 1, 20, 1, 4)', 'line-color': c.edge, 'target-arrow-color': c.edge, 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.8, label: 'data(label)', 'font-size': 9, color: c.sub, 'text-background-color': c.box, 'text-background-opacity': 0.8 } as never },
          { selector: 'edge[conf="heuristic"]', style: { 'line-style': 'dashed', 'line-color': c.weak, 'target-arrow-color': c.weak } },
          { selector: 'edge[conf="unresolved"]', style: { 'line-style': 'dotted', 'line-color': c.weak, 'target-arrow-color': c.weak, opacity: 0.7 } },
          { selector: 'edge[tone="bad"]', style: { 'line-color': '#dc2626', 'target-arrow-color': '#dc2626', width: 2 } },
          { selector: ':selected', style: { 'border-color': c.accent, 'border-width': 3, 'line-color': c.accent, 'target-arrow-color': c.accent } },
        ],
      });
      cyRef.current = cy;
      const keep = oldPos.size > 0 && cy.nodes().toArray().some((n) => oldPos.has(n.id()));
      if (keep) cy.nodes().forEach((n) => { const p = oldPos.get(n.id()); if (p && !n.isParent()) n.position(p); });
      const n = cy.nodes().length;
      const opts: Record<string, unknown> =
        layout === 'elk' ? { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': 24, 'elk.layered.spacing.nodeNodeBetweenLayers': 60 }, fit: !hadView }
        : layout === 'breadthfirst' ? { name: 'breadthfirst', directed: true, spacingFactor: 1.1, fit: true, padding: 20 }
        : layout === 'grid' ? { name: 'grid', fit: true, padding: 20 }
        : { name: 'fcose', quality: n > 250 ? 'draft' : 'default', randomize: !keep, animate: false, fit: !keep, padding: 24, nodeRepulsion: 9000, idealEdgeLength: 90, nodeSeparation: 60, packComponents: true, numIter: n > 250 ? 800 : 2500 };
      try {
        cy.layout(opts as unknown as LayoutOptions).run();
      } catch {
        cy.layout({ name: 'grid' }).run();
      }
      if (keep && hadView) cy.viewport(hadView);
      cy.on('tap', 'node, edge', (e) => handlers.current.onSelect?.(e.target.id()));
      cy.on('tap', (e) => { if (e.target === cy) handlers.current.onSelect?.(null); });
      cy.on('dbltap', 'node', (e) => handlers.current.onOpen?.(e.target.id()));
      let timer: ReturnType<typeof setTimeout> | undefined;
      cy.on('zoom', () => {
        clearTimeout(timer);
        timer = setTimeout(() => handlers.current.onZoom?.(cy), 180);
      });
      (window as unknown as { __cy?: Core }).__cy = cy;
    })();
    return () => {
      dead = true;
    };
  }, [elements, layout, theme]);

  useEffect(() => () => cyRef.current?.destroy(), []);

  return <div ref={ref} data-testid={testId} className={`h-full w-full ${className}`} />;
}
