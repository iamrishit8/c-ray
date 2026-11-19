// Language and role breakdown (Orientation): two 100% stacked bars with a legend table under each.
import { useMemo } from 'react';
import { CODE_LANGS } from '../../core/l0/languages';
import { langName } from '../../core/orientation';
import type { Analysis } from '../../core/types';
import { fmtNum } from '../../core/util';
import { Card, FAMILY_LABEL, langColors, ROLE_FAMILY, SERIES_OTHER, type RoleFamily } from '../kit';

interface Part { key: string; label: string; value: number; sub: string; color: string }

function Stacked({ parts, total, label, testId }: { parts: Part[]; total: number; label: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--bg4)]" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}`}>
        {parts.map((p, i) => (
          <span
            key={p.key}
            title={`${p.label}: ${p.sub}`}
            className="h-full origin-left [animation:grow-x_var(--dur-3)_var(--ease-out)_both]"
            style={{ width: `${(p.value / total) * 100}%`, background: p.color, animationDelay: `${i * 40}ms`, borderRight: i < parts.length - 1 ? '2px solid var(--bg2)' : undefined }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-y-1">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2 text-[13px]" data-key={p.key}>
            <i aria-hidden="true" className="inline-block h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <span className="shrink-0">{p.label}</span>
            <span className="tnum min-w-0 flex-1 truncate text-right text-[12px] faint">{p.sub} · {Math.round((p.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Breakdown({ a }: { a: Analysis }) {
  const langs = useMemo<{ parts: Part[]; total: number }>(() => {
    const code = a.l0.languages.filter((l) => CODE_LANGS.has(l.lang)).sort((x, y) => y.loc - x.loc);
    const color = langColors(code);
    const top = code.slice(0, 6);
    const rest = code.slice(6);
    const parts: Part[] = top.map((l) => ({ key: l.lang, label: langName(l.lang), value: l.loc, sub: `${fmtNum(l.loc)} lines · ${l.files} files`, color: color(l.lang) }));
    if (rest.length) {
      const loc = rest.reduce((s, l) => s + l.loc, 0);
      parts.push({ key: 'other', label: `${rest.length} more`, value: loc, sub: `${fmtNum(loc)} lines`, color: SERIES_OTHER });
    }
    return { parts: parts.filter((p) => p.value > 0), total: Math.max(1, code.reduce((s, l) => s + l.loc, 0)) };
  }, [a.l0.languages]);
  const roles = useMemo<{ parts: Part[]; total: number }>(() => {
    const by = new Map<RoleFamily, { files: number; loc: number }>();
    for (const f of a.files) {
      const fam = ROLE_FAMILY[f.role];
      const cur = by.get(fam) ?? { files: 0, loc: 0 };
      cur.files++;
      cur.loc += f.loc;
      by.set(fam, cur);
    }
    const parts = [...by].sort((x, y) => y[1].files - x[1].files).map(([fam, v]) => ({ key: fam, label: FAMILY_LABEL[fam], value: v.files, sub: `${fmtNum(v.files)} files · ${fmtNum(v.loc)} lines`, color: `var(--r-${fam})` }));
    return { parts, total: Math.max(1, a.files.length) };
  }, [a.files]);
  return (
    <Card title="What it is made of" testId="breakdown">
      <div className="space-y-5">
        <div>
          <div className="label mb-2">Languages, by lines of code</div>
          {langs.parts.length === 0 ? <div className="muted">No recognised source code.</div> : <Stacked parts={langs.parts} total={langs.total} label="Languages" testId="lang-breakdown" />}
          {a.l0.languages.some((l) => !CODE_LANGS.has(l.lang)) && (
            <div className="pt-2 text-xs faint">Not counted as code: {a.l0.languages.filter((l) => !CODE_LANGS.has(l.lang)).map((l) => `${l.lang} (${l.files})`).join(', ')}</div>
          )}
        </div>
        <div>
          <div className="label mb-2">Roles, by number of files <span className="normal-case tracking-normal">(inferred, heuristic)</span></div>
          <Stacked parts={roles.parts} total={roles.total} label="Roles" testId="role-breakdown" />
        </div>
      </div>
    </Card>
  );
}
