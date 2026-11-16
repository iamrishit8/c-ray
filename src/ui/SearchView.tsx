import { useEffect, useMemo, useState } from 'react';
import { modelOf } from '../core/model';
import type { Occurrence, SearchResult } from '../core/search';
import type { Analysis } from '../core/types';
import { useStore } from '../store/store';
import { worker } from '../workers/client';
import { Badge, Card, ConfBadge, Empty, FileLink, Page } from './kit';

/** Find-references: exact (L2) and heuristic (L1) edges first, then plain text matches labelled unresolved. */
export function References({ a, sym }: { a: Analysis; sym: number }) {
  const m = modelOf(a);
  const s = a.symbols[sym];
  const [text, setText] = useState<Occurrence[] | null>(null);
  const refs = m.refsTo.get(sym) ?? [];
  useEffect(() => {
    let live = true;
    setText(null);
    worker.call('occurrences', { name: s.name }).then((r) => live && setText(r.items)).catch(() => live && setText([]));
    return () => { live = false; };
  }, [sym, s.name]);
  const known = new Set(refs.map((r) => `${m.path(r.file)}:${r.line}`));
  known.add(`${m.path(s.file)}:${s.line}`);
  const extra = (text ?? []).filter((o) => !known.has(`${o.file}:${o.line}`));
  return (
    <div className="space-y-2" data-testid="references">
      <div className="text-[13px]">
        References to <b className="mono">{m.symLabel(sym)}</b> — defined at <FileLink file={m.path(s.file)} line={s.line} />
      </div>
      {refs.length === 0 ? <div className="muted text-[13px]">No resolved or heuristic references.</div> : (
        <table className="tbl">
          <thead><tr><th>Location</th><th>In</th><th>Kind</th><th>Confidence</th></tr></thead>
          <tbody>
            {refs.slice(0, 300).map((r, i) => (
              <tr key={i}><td><FileLink file={m.path(r.file)} line={r.line} /></td><td className="mono">{r.from >= 0 ? m.symLabel(r.from) : '(module level)'}</td><td>{r.kind}</td><td><ConfBadge c={r.conf} /></td></tr>
            ))}
          </tbody>
        </table>
      )}
      {text === null ? <div className="faint text-xs">Scanning text…</div> : extra.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13px] muted">{extra.length} additional text match(es) of “{s.name}” that could not be tied to this definition</summary>
          <table className="tbl mt-1">
            <tbody>{extra.slice(0, 200).map((o, i) => <tr key={i}><td><FileLink file={o.file} line={o.line} /></td><td className="mono muted">{o.text}</td><td><ConfBadge c="unresolved" /></td></tr>)}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export function SearchView() {
  const a = useStore((s) => s.analysis)!;
  const openSource = useStore((s) => s.openSource);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'symbol' | 'text'>('all');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [refSym, setRefSym] = useState<number | null>(null);
  const m = useMemo(() => modelOf(a), [a]);

  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      worker.call('search', { query: q, kind }).then((r) => { if (live) { setRes(r); setBusy(false); } }).catch(() => live && setBusy(false));
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [q, kind]);

  return (
    <Page title="Search" intro="Full-text and symbol search over the analysed files. Click a symbol to jump to its definition; “References” lists where it is used (exact for TypeScript/JavaScript, heuristic elsewhere).">
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus data-testid="search-input" className="input w-full max-w-xl" placeholder="Search symbols, text or file paths…" value={q} onChange={(e) => { setQ(e.target.value); setRefSym(null); }} />
        {(['all', 'symbol', 'text'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1 text-[13px]"><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />{k === 'all' ? 'Everything' : k === 'symbol' ? 'Symbols' : 'Text'}</label>
        ))}
        {busy && <span className="faint text-xs">searching…</span>}
      </div>
      {refSym !== null && <Card title="Find references" right={<button className="btn" onClick={() => setRefSym(null)}>Close</button>}><References a={a} sym={refSym} /></Card>}
      {!res ? <Empty>Type to search {a.symbols.length.toLocaleString()} definitions and {a.files.length.toLocaleString()} files.</Empty> : (
        <>
          {kind !== 'text' && (
            <Card title={`Symbols (${res.symbols.length})`}>
              {res.symbols.length === 0 ? <div className="muted">No matching definitions.</div> : (
                <table className="tbl" data-testid="symbol-results">
                  <tbody>
                    {res.symbols.map((h) => {
                      const s = a.symbols[h.sym];
                      return (
                        <tr key={h.sym}>
                          <td><button className="link mono font-semibold" onClick={() => openSource(m.path(s.file), s.line, s.endLine)}>{m.symLabel(h.sym)}</button></td>
                          <td><Badge>{s.kind}</Badge></td>
                          <td><FileLink file={m.path(s.file)} line={s.line} /></td>
                          <td className="text-right"><button className="btn" data-testid="find-refs" onClick={() => setRefSym(h.sym)}>References ({m.refsTo.get(h.sym)?.length ?? 0})</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          )}
          {kind !== 'symbol' && (
            <Card title={`Files and text (${res.files.length})`}>
              {res.files.length === 0 ? <div className="muted">No matching text.</div> : (
                <div className="space-y-2" data-testid="text-results">
                  {res.files.map((f) => (
                    <div key={f.path}>
                      <FileLink file={f.path} />
                      {f.lines.map((l) => (
                        <div key={l.line} className="flex gap-2 pl-4 text-xs"><FileLink file={f.path} line={l.line} label={String(l.line)} className="w-10 shrink-0 text-right" /><span className="mono truncate muted">{l.text}</span></div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {res.unindexed > 0 && <p className="mt-2 text-xs text-[var(--warn)]">{res.unindexed} file(s) were too large for the full-text index budget; they are searchable by path and symbol only.</p>}
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
