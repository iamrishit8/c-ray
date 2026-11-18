// Markdown → HTML for report previews. DOM-free so tests run it in Node.
// Analysed code is untrusted: raw HTML is shown as text, and links/images keep only safe URL schemes.
import { marked, type Tokens } from 'marked';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** True for relative URLs, anchors and http(s)/mailto. Everything else (javascript:, data:, vbscript:,
 *  obfuscated with entities, control characters or mixed case) is rejected. */
export function isSafeHref(href: string): boolean {
  const decoded = href
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&colon;?/gi, ':')
    .replace(/&tab;?|&newline;?/gi, '');
  // browsers ignore ASCII whitespace/control characters inside a scheme ("java\tscript:")
  // eslint-disable-next-line no-control-regex
  const clean = decoded.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(clean);
  return !scheme || ['http', 'https', 'mailto'].includes(scheme[1]);
}

marked.use({
  walkTokens(token) {
    // GFM autolinks and bare URLs arrive as link tokens too; flag unsafe ones for the renderer
    if ((token.type === 'link' || token.type === 'image') && !isSafeHref((token as Tokens.Link).href)) (token as Tokens.Link).href = '';
  },
  renderer: {
    html: (token) => esc(typeof token === 'string' ? token : token.text),
    link(token) {
      return token.href ? false : this.parser.parseInline(token.tokens);
    },
    image(token) {
      return token.href ? false : esc(token.text);
    },
  },
});

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false, gfm: true }) as string;
}
