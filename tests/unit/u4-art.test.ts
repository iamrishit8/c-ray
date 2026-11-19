// U4: every empty-state illustration renders, is decorative (hidden from screen readers) and uses only token colours.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Art, type ArtKind } from '../../src/ui/illustrations';
import { HeroGraph } from '../../src/ui/HeroGraph';

const KINDS: ArtKind[] = ['history', 'data', 'entries', 'findings'];

describe('illustrations', () => {
  it.each(KINDS)('%s renders as a decorative SVG with token colours only', (kind) => {
    const html = renderToStaticMarkup(createElement(Art, { kind }));
    expect(html).toContain(`data-art="${kind}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(html).toMatch(/var\(--/);
  });

  it('the hero graph draws 9 nodes and 11 edges, edge styles follow the confidence encoding, no hard-coded colours', () => {
    const html = renderToStaticMarkup(createElement(HeroGraph));
    expect((html.match(/<circle[^>]*class="assemble"/g) ?? []).length).toBe(9);
    expect((html.match(/<line /g) ?? []).length).toBe(11);
    expect((html.match(/stroke-dasharray="6 4"/g) ?? []).length).toBe(3); // heuristic
    expect((html.match(/stroke-dasharray="1.5 5"/g) ?? []).length).toBe(1); // unresolved
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
});
