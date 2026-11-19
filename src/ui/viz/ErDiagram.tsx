// Interactive ER diagram (Data view): entity cards with their first fields, relation lines labelled with
// cardinality, click a card to focus it and its relations. Mermaid stays for exports and print.
// Layout: src/core/viz/er.ts.
import { useMemo } from 'react';
import type { SchemaResult } from '../../core/types';
import { erLayout } from '../../core/viz/er';
import { reducedMotion } from '../motion';
import { fit } from './common';

const KIND: Record<string, string> = { '1-1': '1 : 1', '1-n': '1 : n', 'n-1': 'n : 1', 'n-n': 'n : n' };

export function ErDiagram({ schema, selected, onSelect }: { schema: SchemaResult; selected: string | null; onSelect: (name: string | null) => void }) {
  const er = useMemo(() => erLayout(schema), [schema]);
  const ent = useMemo(() => new Map(schema.entities.map((e) => [e.name, e])), [schema]);
  const related = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const l of er.lines) if (l.from === selected || l.to === selected) { s.add(l.from); s.add(l.to); }
    return s;
  }, [er, selected]);
  const animate = !reducedMotion() && er.boxes.length <= 40;
  const PAD = 16;
  return (
    <div className="overflow-auto rounded-[var(--r-md)] bg-[var(--bg)] canvas" style={{ maxHeight: 620 }}>
      <svg
        width={er.width + PAD * 2}
        height={er.height + PAD * 2}
        role="img"
        aria-label={`ER diagram: ${er.boxes.length} entities, ${er.lines.length} relations`}
        data-testid="er-interactive"
        className={related ? 'viz-dim' : ''}
        onClick={() => onSelect(null)}
      >
        <g transform={`translate(${PAD}, ${PAD})`}>
          {er.lines.map((l, i) => {
            const hot = !!related && (l.from === selected || l.to === selected);
            return (
              <g key={i} className={`viz-cell ${hot ? 'is-hot' : ''}`} data-testid="er-line" data-from={l.from} data-to={l.to}>
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={hot ? 'var(--accent)' : 'var(--fg3)'} strokeWidth={hot ? 2 : 1.3} strokeDasharray={l.conf === 'heuristic' ? '5 4' : l.conf === 'unresolved' ? '1.5 4' : undefined} />
                <g transform={`translate(${(l.x1 + l.x2) / 2}, ${(l.y1 + l.y2) / 2})`}>
                  <rect x={-20} y={-9} width={40} height={18} rx={9} fill="var(--bg2)" stroke={hot ? 'var(--accent)' : 'var(--line2)'} />
                  <text textAnchor="middle" y={4} fontSize={10} fill="var(--fg2)">{KIND[l.kind] ?? l.kind}</text>
                </g>
              </g>
            );
          })}
          {er.boxes.map((b, i) => {
            const e = ent.get(b.name)!;
            const on = selected === b.name;
            return (
              <g
                key={b.name}
                transform={`translate(${b.x}, ${b.y})`}
                className={`viz-cell cursor-pointer ${related?.has(b.name) ? 'is-hot' : ''}`}
                data-testid="er-entity"
                data-entity={b.name}
                role="button"
                tabIndex={0}
                aria-label={`${b.name}: ${e.fields.length} fields`}
                aria-pressed={on}
                onClick={(ev) => { ev.stopPropagation(); onSelect(on ? null : b.name); }}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(on ? null : b.name); } }}
              >
                <g className={animate ? 'fade-in' : ''} style={animate ? { animationDelay: `${i * 30}ms` } : undefined}>
                  <rect width={b.w} height={b.h} rx={10} fill="var(--bg2)" stroke={on ? 'var(--accent)' : 'var(--line2)'} strokeWidth={on ? 2 : 1} strokeDasharray={e.conf === 'heuristic' ? '5 3' : undefined} />
                  <path d={`M0 10 a10 10 0 0 1 10 -10 h${b.w - 20} a10 10 0 0 1 10 10 v20 h-${b.w} z`} fill="var(--bg3)" />
                  <text x={12} y={20} fontSize={12} fontWeight={600} fill="var(--fg)">{fit(b.name, b.w - 70)}</text>
                  <text x={b.w - 10} y={20} fontSize={9.5} textAnchor="end" fill="var(--fg3)">{e.source}</text>
                  {e.fields.slice(0, b.shown).map((f, k) => (
                    <g key={f.name} transform={`translate(12, ${30 + 15 + k * 19})`}>
                      <text fontSize={11} fill={f.pk ? 'var(--accent-text)' : 'var(--fg)'} fontWeight={f.pk ? 600 : 400}>{fit(f.name, 100)}</text>
                      <text x={b.w - 24} fontSize={10.5} textAnchor="end" fill={f.ref ? 'var(--warn)' : 'var(--fg3)'}>{fit(f.ref ? `→ ${f.ref}` : f.type, 80)}</text>
                    </g>
                  ))}
                  {b.more > 0 && <text x={12} y={30 + 15 + b.shown * 19} fontSize={10.5} fill="var(--fg3)">+ {b.more} more fields</text>}
                  {e.fields.length === 0 && <text x={12} y={45} fontSize={10.5} fill="var(--fg3)">no columns found</text>}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      {er.omitted > 0 && <p className="px-3 pb-2 text-xs faint">Showing {er.boxes.length} of {er.boxes.length + er.omitted} entities.</p>}
    </div>
  );
}
