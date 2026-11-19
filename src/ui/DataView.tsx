import { useMemo, useState } from 'react';
import { modelOf } from '../core/model';
import { erToMermaid } from '../core/schema';
import { groupBy } from '../core/util';
import { useStore } from '../store/store';
import { Badge, Card, Chip, ConfBadge, Empty, FileLink, Page, Pending, RoleBadge, listKeys } from './kit';
import { ErDiagram } from './viz/ErDiagram';
import { Mermaid } from './Mermaid';

export function DataView() {
  const a = useStore((s) => s.analysis)!;
  const m = useMemo(() => modelOf(a), [a, a.symbols.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const { entities, relations, access } = a.schema;
  const [sel, setSel] = useState<string | null>(null);
  const [mermaid, setMermaid] = useState(false);
  const er = useMemo(() => erToMermaid(a.schema), [a.schema]);
  const byEntity = useMemo(() => groupBy(access, (x) => x.entity), [access]);
  const unmapped = a.facts.filter((f) => f.kind === 'db' && !access.some((x) => x.file === f.file && x.line === f.line));
  if (a.stage !== 'done' && entities.length === 0) return <Page title="Data"><Pending what="Schema reconstruction" /></Page>;
  const where = (file: string, line: number) => {
    const fi = m.fileIdx.get(file);
    const si = fi === undefined ? -1 : m.symbolAt(fi, line);
    return si >= 0 ? m.symLabel(si) : '(module level)';
  };
  const current = entities.find((e) => e.name === sel) ?? null;
  return (
    <Page title="Data model" intro="Entities, fields, relations and indexes reconstructed from ORM models, migrations and SQL, and which code reads or writes each entity. Reconstruction is syntactic: check the linked source before relying on a detail.">
      {entities.length === 0 ? (
        <Empty title="No data model found">No schema definitions were found (Prisma, Mongoose, TypeORM, Sequelize, SQLAlchemy, Django, JPA, ActiveRecord, Eloquent, EF Core, GORM, migrations or SQL DDL).</Empty>
      ) : (
        <>
          <Card
            testId="er-card"
            title={`Entity-relationship diagram (${entities.length} entities, ${relations.length} relations)`}
            right={
              <div className="flex gap-1" role="group" aria-label="Diagram style">
                <Chip on={!mermaid} onClick={() => setMermaid(false)} testId="er-interactive-toggle">interactive</Chip>
                <Chip on={mermaid} onClick={() => setMermaid(true)} testId="er-mermaid-toggle" title="The same diagram as it appears in exports and print">as exported</Chip>
              </div>
            }
          >
            {mermaid ? <Mermaid code={er} testId="er-diagram" /> : (
              <>
                <p className="mb-3 text-[13px] muted">Click an entity to focus it and its relations; its fields and the code that uses it appear below. Dashed lines and cards are heuristic.</p>
                <ErDiagram schema={a.schema} selected={current?.name ?? null} onSelect={setSel} />
              </>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <Card title="Entities">
              <ul className="space-y-0.5 text-[13px]" data-testid="entity-list" onKeyDown={listKeys(entities.map((e) => e.name), current?.name ?? null, setSel)} aria-label="Entities (use arrow keys)">
                {entities.map((e) => {
                  const acc = byEntity.get(e.name) ?? [];
                  return (
                    <li key={e.name}>
                      <button data-key={e.name} aria-current={current?.name === e.name ? 'true' : undefined} className={`flex w-full items-center justify-between gap-2 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left ${current?.name === e.name ? 'is-selected' : 'hover:bg-[var(--bg3)]'}`} onClick={() => setSel(e.name)}>
                        <span className="mono font-medium">{e.name}</span>
                        <span className={`tnum whitespace-nowrap text-[11px] font-normal ${current?.name === e.name ? '' : 'faint'}`}>{e.fields.length} fields · {acc.filter((x) => x.op === 'read').length}R/{acc.filter((x) => x.op === 'write').length}W</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
            {!current ? <Empty>Select an entity to see its fields and the code that reads and writes it.</Empty> : (
              <div className="space-y-4" data-testid="entity-detail">
                <Card title={<span className="flex items-center gap-2"><span className="mono">{current.name}</span><Badge>{current.source}</Badge><ConfBadge c={current.conf} />{current.table && <span className="text-xs faint">table {current.table}</span>}</span>} right={<FileLink file={current.file} line={current.line} />}>
                  <table className="tbl">
                    <thead><tr><th>Field</th><th>Type</th><th>Constraints</th><th>Source</th></tr></thead>
                    <tbody>
                      {current.fields.map((f) => (
                        <tr key={f.name}>
                          <td className="mono font-medium">{f.name}</td><td className="mono muted">{f.type}</td>
                          <td className="space-x-1">{f.pk && <Badge tone="accent">PK</Badge>}{f.unique && <Badge>unique</Badge>}{f.nullable === false && <Badge>not null</Badge>}{f.nullable === true && <Badge>nullable</Badge>}{f.ref && <Badge tone="warn">→ {f.ref}</Badge>}</td>
                          <td><FileLink file={current.file} line={f.line} label={`:${f.line}`} /></td>
                        </tr>
                      ))}
                      {current.fields.length === 0 && <tr><td colSpan={4} className="muted">No column definitions were found for this model (they may live in a migration that was not provided).</td></tr>}
                    </tbody>
                  </table>
                  {current.indexes.length > 0 && (
                    <div className="mt-4 text-[13px]"><span className="label mr-2">Indexes</span> {current.indexes.map((ix, i) => <span key={i} className="mr-3"><FileLink file={current.file} line={ix.line} label={`(${ix.fields.join(', ')})`} />{ix.unique && <> <Badge>unique</Badge></>}</span>)}</div>
                  )}
                  {relations.some((r) => r.from === current.name || r.to === current.name) && (
                    <div className="mt-4 text-[13px]"><span className="label">Relations</span>
                      <ul className="mt-1 space-y-0.5">
                        {relations.filter((r) => r.from === current.name || r.to === current.name).map((r, i) => (
                          <li key={i}><span className="mono">{r.from}</span> <Badge>{r.kind}</Badge> <span className="mono">{r.to}</span>{r.via && <span className="faint"> via {r.via}</span>} — <FileLink file={r.file} line={r.line} /> <ConfBadge c={r.conf} /></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
                <Card title={`Code that touches ${current.name}`}>
                  {(byEntity.get(current.name) ?? []).length === 0 ? <div className="muted">No read or write of this entity was recognised in the analysed code.</div> : (
                    <table className="tbl" data-testid="entity-access">
                      <thead><tr><th>Op</th><th>Location</th><th>In</th><th>How</th><th>Role</th></tr></thead>
                      <tbody>
                        {(byEntity.get(current.name) ?? []).map((x, i) => (
                          <tr key={i}>
                            <td><Badge tone={x.op === 'write' ? 'warn' : 'ok'}>{x.op}</Badge></td>
                            <td><FileLink file={x.file} line={x.line} /></td>
                            <td className="mono">{where(x.file, x.line)}</td>
                            <td className="muted">{x.detail}</td>
                            <td>{m.file(x.file) && <RoleBadge role={m.file(x.file)!.role}>{m.file(x.file)!.role}</RoleBadge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </div>
            )}
          </div>
        </>
      )}
      {unmapped.length > 0 && (
        <Card title={`Other database access points (${unmapped.length})`} right={<span className="text-xs faint">not tied to a reconstructed entity</span>}>
          <table className="tbl">
            <tbody>{unmapped.slice(0, 100).map((f, i) => <tr key={i}><td><Badge tone={f.op === 'write' ? 'warn' : 'ok'}>{f.op ?? 'query'}</Badge></td><td><FileLink file={f.file} line={f.line} /></td><td className="muted">{f.detail}</td><td><ConfBadge c={f.conf} /></td></tr>)}</tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
