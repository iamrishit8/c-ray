// Database intelligence: reconstruct entities, fields, relations and indexes
// from ORM models, migrations and SQL, then map which code reads/writes them.
// Extraction is syntactic (heuristic); explicit declarations (Prisma schema,
// SQL DDL) are marked "resolved".
import type { Stage, StageContext } from './pipeline';
import type { Entity, EntityAccess, Field, FileUnit, Relation, SchemaResult } from './types';
import { basename, LineIndex } from './util';

interface Out {
  entities: Entity[];
  relations: Relation[];
}
type Li = (index: number) => number;

// ---------------------------------------------------------------- text helpers
export function matchClose(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  let quote = '';
  for (let i = open; i < text.length && i < open + 60_000; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function splitTop(text: string, sep = ','): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push({ text: text.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (text.slice(start).trim()) out.push({ text: text.slice(start), offset: start });
  return out;
}

/** Top-level `key: value` pairs of an object literal whose "{" is at `open`. */
function props(text: string, open: number): { key: string; value: string; index: number }[] {
  const close = matchClose(text, open);
  if (close < 0) return [];
  const out: { key: string; value: string; index: number }[] = [];
  for (const part of splitTop(text.slice(open + 1, close))) {
    const m = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:(["'])([^"']+)\1|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]*)$/.exec(part.text);
    if (m) out.push({ key: m[2] ?? m[3], value: m[4].trim(), index: open + 1 + part.offset + part.text.indexOf(m[2] ?? m[3]) });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const camel = (s: string) => s.split(/[_\s-]+/).map(cap).join('');
function singular(s: string): string {
  return s.endsWith('ies') ? s.slice(0, -3) + 'y' : /(ses|xes|ches|shes)$/.test(s) ? s.slice(0, -2) : s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s;
}
function plural(s: string): string {
  return s.endsWith('y') && !/[aeiou]y$/.test(s) ? s.slice(0, -1) + 'ies' : /(s|x|ch|sh)$/.test(s) ? s + 'es' : s + 's';
}
const strs = (s: string) => [...s.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);

// ---------------------------------------------------------------- Prisma
function prisma(u: FileUnit, li: Li, out: Out) {
  const models = [...u.text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const names = new Set(models.map((m) => m[1]));
  for (const m of models) {
    const e: Entity = { name: m[1], file: u.path, line: li(m.index!), source: 'prisma', fields: [], indexes: [], conf: 'resolved' };
    const bodyStart = m.index! + m[0].indexOf('{') + 1;
    let off = bodyStart;
    for (const raw of m[2].split('\n')) {
      const line = raw.trim();
      const ln = li(off + raw.search(/\S|$/));
      off += raw.length + 1;
      if (!line || line.startsWith('//')) continue;
      if (line.startsWith('@@')) {
        const idx = /^@@(index|unique|id)\s*\(\s*\[([^\]]*)\]/.exec(line);
        if (idx) e.indexes.push({ fields: idx[2].split(',').map((s) => s.trim().replace(/\(.*$/, '')).filter(Boolean), unique: idx[1] !== 'index' || undefined, line: ln });
        const map = /^@@map\s*\(\s*"([^"]+)"/.exec(line);
        if (map) e.table = map[1];
        continue;
      }
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!f) continue;
      const [, name, type, list, opt, mods] = f;
      if (names.has(type)) {
        const rel = /@relation\s*\(([^)]*)\)/.exec(mods);
        const fk = rel ? /fields:\s*\[([^\]]*)\]/.exec(rel[1])?.[1].split(',')[0].trim() : undefined;
        if (fk) out.relations.push({ from: e.name, to: type, kind: 'n-1', via: fk, file: u.path, line: ln, conf: 'resolved' });
        continue; // relation object fields are not columns
      }
      e.fields.push({ name, type: type + (list ?? ''), line: ln, pk: /@id\b/.test(mods) || undefined, unique: /@unique\b/.test(mods) || undefined, nullable: !!opt || undefined });
    }
    out.entities.push(e);
  }
  // mark FK columns and 1-1 relations
  for (const r of out.relations) {
    const e = out.entities.find((x) => x.name === r.from && x.file === u.path);
    const f = e?.fields.find((x) => x.name === r.via);
    if (f) {
      f.ref = r.to;
      if (f.unique) r.kind = '1-1';
    }
  }
}

// ---------------------------------------------------------------- Mongoose
function mongoose(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  for (const m of t.matchAll(/(?:(?:const|let|var)\s+(\w+)\s*=\s*)?new\s+(?:mongoose\.)?Schema\s*(?:<[^>]*>)?\s*\(/g)) {
    const open = t.indexOf('{', m.index! + m[0].length - 1);
    if (open < 0 || open > m.index! + m[0].length + 5) continue;
    const v = m[1];
    const modelName = (v && new RegExp(`model\\s*(?:<[^>]*>)?\\(\\s*['"](\\w+)['"]\\s*,\\s*${v}\\b`).exec(t)?.[1]) ?? (v ? cap(v.replace(/Schema$/i, '')) : cap(basename(u.path).replace(/\..*$/, '')));
    if (!modelName) continue;
    const e: Entity = { name: modelName, file: u.path, line: li(m.index!), source: 'mongoose', fields: [], indexes: [], conf: 'heuristic' };
    for (const p of props(t, open)) {
      const f: Field = { name: p.key, type: 'Mixed', line: li(p.index) };
      let val = p.value;
      if (val.startsWith('[')) {
        f.type = 'Array';
        val = val.slice(1).trim();
      }
      if (val.startsWith('{')) {
        const inner = props(val, 0);
        const ty = inner.find((x) => x.key === 'type');
        if (ty) {
          f.type = (f.type === 'Array' ? 'Array<' : '') + (ty.value.replace(/^\[|\]$/g, '').split(/[.\s,]/).filter(Boolean).pop() ?? 'Mixed') + (f.type === 'Array' ? '>' : '');
          const ref = inner.find((x) => x.key === 'ref');
          if (ref) f.ref = strs(ref.value)[0];
          if (/^true/.test(inner.find((x) => x.key === 'unique')?.value ?? '')) f.unique = true;
          if (!/^true|^\[\s*true/.test(inner.find((x) => x.key === 'required')?.value ?? '')) f.nullable = true;
        } else if (f.type !== 'Array') f.type = 'Object';
      } else {
        const base = val.split(/[,\s\]]/)[0].split('.').pop() || 'Mixed';
        f.type = f.type === 'Array' ? `Array<${base}>` : base;
        f.nullable = true;
      }
      e.fields.push(f);
      if (f.ref) out.relations.push({ from: e.name, to: f.ref, kind: 'n-1', via: f.name, file: u.path, line: f.line, conf: 'heuristic' });
    }
    if (v) {
      for (const ix of t.matchAll(new RegExp(`\\b${v}\\.index\\s*\\(`, 'g'))) {
        const o = t.indexOf('{', ix.index!);
        const close = matchClose(t, ix.index! + ix[0].length - 1);
        if (o < 0 || close < 0 || o > close) continue;
        e.indexes.push({ fields: props(t, o).map((p) => p.key), unique: /unique\s*:\s*true/.test(t.slice(o, close)) || undefined, line: li(ix.index!) });
      }
    }
    out.entities.push(e);
  }
}

// ---------------------------------------------------------------- TypeORM
const TYPEORM_COL = /^(Column|PrimaryGeneratedColumn|PrimaryColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|ObjectIdColumn)$/;
function typeorm(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  for (const m of t.matchAll(/@Entity\s*\(([^)]*)\)/g)) {
    const cls = /class\s+(\w+)/.exec(t.slice(m.index!, m.index! + 600));
    if (!cls) continue;
    const clsIdx = m.index! + cls.index;
    const open = t.indexOf('{', clsIdx);
    const close = matchClose(t, open);
    if (open < 0 || close < 0) continue;
    const e: Entity = { name: cls[1], table: strs(m[1])[0], file: u.path, line: li(clsIdx), source: 'typeorm', fields: [], indexes: [], conf: 'heuristic' };
    for (const ix of t.slice(m.index!, clsIdx).matchAll(/@(Index|Unique)\s*\(\s*(?:['"][^'"]*['"]\s*,\s*)?\[([^\]]*)\]/g)) {
      e.indexes.push({ fields: strs(ix[2]), unique: ix[1] === 'Unique' || /unique\s*:\s*true/.test(t.slice(m.index! + ix.index!, m.index! + ix.index! + 200).split('\n')[0]) || undefined, line: li(m.index! + ix.index!) });
    }
    let decos: { name: string; args: string }[] = [];
    let off = open + 1;
    let depth = 0;
    for (const raw of t.slice(open + 1, close).split('\n')) {
      const line = raw.trim();
      const idx = off + raw.search(/\S|$/);
      off += raw.length + 1;
      const startDepth = depth;
      for (const c of raw) depth += c === '{' || c === '(' ? 1 : c === '}' || c === ')' ? -1 : 0;
      if (startDepth > 0) continue; // inside a method body or multi-line decorator
      const d = /^@(\w+)\s*(?:\(([\s\S]*))?/.exec(line);
      if (d) {
        decos.push({ name: d[1], args: d[2] ?? '' });
        const rest = line.slice(d[0].length);
        void rest;
        continue;
      }
      const p = /^(?:(?:public|private|protected|readonly|declare)\s+)*(\w+)[!?]?\s*:\s*([^;=]+)/.exec(line);
      if (p && decos.length) {
        const col = decos.find((x) => TYPEORM_COL.test(x.name));
        const relD = decos.find((x) => /^(ManyToOne|OneToMany|OneToOne|ManyToMany)$/.test(x.name));
        const ln = li(idx);
        if (col) {
          e.fields.push({
            name: p[1], type: strs(col.args)[0] ?? p[2].trim(), line: ln,
            pk: /^Primary|^ObjectId/.test(col.name) || undefined, unique: /unique\s*:\s*true/.test(col.args) || undefined, nullable: /nullable\s*:\s*true/.test(col.args) || undefined,
          });
        } else if (relD) {
          const target = /(?:=>|type\s*=>)\s*(\w+)/.exec(relD.args)?.[1] ?? strs(relD.args)[0] ?? p[2].replace(/\[\]|\s/g, '');
          if (relD.name === 'ManyToOne' || (relD.name === 'OneToOne' && decos.some((x) => x.name === 'JoinColumn'))) {
            e.fields.push({ name: p[1], type: target, line: ln, ref: target });
            out.relations.push({ from: e.name, to: target, kind: relD.name === 'ManyToOne' ? 'n-1' : '1-1', via: p[1], file: u.path, line: ln, conf: 'heuristic' });
          } else if (relD.name === 'ManyToMany' && decos.some((x) => x.name === 'JoinTable')) {
            out.relations.push({ from: e.name, to: target, kind: 'n-n', via: p[1], file: u.path, line: ln, conf: 'heuristic' });
          }
        }
        if (decos.some((x) => x.name === 'Index')) e.indexes.push({ fields: [p[1]], line: ln });
      }
      if (!line.startsWith('@') && line) decos = [];
    }
    out.entities.push(e);
  }
}

// ---------------------------------------------------------------- Sequelize
function sequelize(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  const add = (name: string, open: number, at: number) => {
    const e: Entity = { name, file: u.path, line: li(at), source: 'sequelize', fields: [], indexes: [], conf: 'heuristic' };
    for (const p of props(t, open)) {
      const inner = p.value.startsWith('{') ? props(p.value, 0) : [];
      const get = (k: string) => inner.find((x) => x.key === k)?.value ?? '';
      const type = (inner.length ? get('type') : p.value).replace(/^(DataTypes|Sequelize|sequelize)\./, '').split(/[,\s]/)[0] || 'unknown';
      const ref = strs(get('references'))[0];
      e.fields.push({ name: p.key, type, line: li(p.index), pk: /^true/.test(get('primaryKey')) || undefined, unique: /^true/.test(get('unique')) || undefined, nullable: /^false/.test(get('allowNull')) ? false : undefined, ref });
      if (ref) out.relations.push({ from: name, to: ref, kind: 'n-1', via: p.key, file: u.path, line: li(p.index), conf: 'heuristic' });
    }
    out.entities.push(e);
  };
  for (const m of t.matchAll(/\b(\w+)\.init\s*\(\s*\{/g)) add(m[1], m.index! + m[0].length - 1, m.index!);
  for (const m of t.matchAll(/\.define\s*\(\s*['"](\w+)['"]\s*,\s*\{/g)) add(m[1], m.index! + m[0].length - 1, m.index!);
  for (const m of t.matchAll(/\b(\w+)\.(belongsTo|hasMany|hasOne|belongsToMany)\s*\(\s*(?:models\.|db\.)?(\w+)/g)) {
    const [a, kind, b] = [m[1].replace(/^(models|db)$/, ''), m[2], m[3]];
    if (!a) continue;
    const ln = li(m.index!);
    if (kind === 'belongsTo') out.relations.push({ from: a, to: b, kind: 'n-1', file: u.path, line: ln, conf: 'heuristic' });
    else if (kind === 'hasMany') out.relations.push({ from: b, to: a, kind: 'n-1', file: u.path, line: ln, conf: 'heuristic' });
    else if (kind === 'hasOne') out.relations.push({ from: b, to: a, kind: '1-1', file: u.path, line: ln, conf: 'heuristic' });
    else out.relations.push({ from: a, to: b, kind: 'n-n', file: u.path, line: ln, conf: 'heuristic' });
  }
}

// ---------------------------------------------------------------- Python: Django + SQLAlchemy
function pyClasses(text: string): { name: string; bases: string; index: number; body: string; bodyIndex: number }[] {
  const out: { name: string; bases: string; index: number; body: string; bodyIndex: number }[] = [];
  const re = /^class\s+(\w+)\s*\(([^)]*)\)\s*:[^\n]*\n/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const end = /^(?=\S)/m.exec(rest);
    out.push({ name: m[1], bases: m[2], index: m.index, body: end ? rest.slice(0, end.index) : rest, bodyIndex: start });
  }
  return out;
}

function django(u: FileUnit, li: Li, out: Out) {
  if (/(^|\/)migrations\//.test(u.path)) return;
  for (const c of pyClasses(u.text)) {
    if (!/models\.\w+\s*\(/.test(c.body) || !/\bmodels\.Model\b|Model\b|Mixin\b|Abstract/.test(c.bases)) continue;
    if (/^\s+abstract\s*=\s*True/m.test(c.body)) continue;
    const e: Entity = { name: c.name, file: u.path, line: li(c.index), source: 'django', fields: [], indexes: [], conf: 'heuristic' };
    for (const m of c.body.matchAll(/^ {4}(\w+)\s*=\s*models\.(\w+)\s*\(([^\n]*)/gm)) {
      const [, name, type, args] = m;
      const ln = li(c.bodyIndex + m.index!);
      const f: Field = { name, type, line: ln, pk: /primary_key\s*=\s*True/.test(args) || undefined, unique: /\bunique\s*=\s*True/.test(args) || type === 'OneToOneField' || undefined, nullable: /\bnull\s*=\s*True/.test(args) || undefined };
      if (/^(ForeignKey|OneToOneField|ManyToManyField)$/.test(type)) {
        let target = (/^\s*(?:to\s*=\s*)?(["']?)([\w.]+)\1/.exec(args)?.[2] ?? '').split('.').pop() ?? '';
        if (target === 'self') target = c.name;
        if (target === 'AUTH_USER_MODEL') target = 'User';
        if (target) {
          f.ref = target;
          out.relations.push({ from: c.name, to: target, kind: type === 'ForeignKey' ? 'n-1' : type === 'OneToOneField' ? '1-1' : 'n-n', via: name, file: u.path, line: ln, conf: 'heuristic' });
        }
      }
      e.fields.push(f);
    }
    if (!e.fields.some((f) => f.pk)) e.fields.unshift({ name: 'id', type: 'AutoField (implicit)', line: e.line, pk: true });
    const meta = /^ {4}class Meta\s*:[^\n]*\n((?: {8}[^\n]*\n|\s*\n)*)/m.exec(c.body);
    if (meta) {
      const base = c.bodyIndex + meta.index;
      e.table = /db_table\s*=\s*["']([^"']+)["']/.exec(meta[1])?.[1];
      for (const ix of meta[1].matchAll(/models\.Index\s*\(\s*fields\s*=\s*\[([^\]]*)\]/g)) e.indexes.push({ fields: strs(ix[1]), line: li(base + ix.index!) });
      for (const ix of meta[1].matchAll(/models\.UniqueConstraint\s*\(\s*fields\s*=\s*\[([^\]]*)\]/g)) e.indexes.push({ fields: strs(ix[1]), unique: true, line: li(base + ix.index!) });
      const ut = /unique_together\s*=\s*[\[(]\s*[\[(]?([^\])]*)/.exec(meta[1]);
      if (ut) e.indexes.push({ fields: strs(ut[1]), unique: true, line: li(base + ut.index) });
    }
    out.entities.push(e);
  }
}

function sqlalchemy(u: FileUnit, li: Li, out: Out) {
  for (const c of pyClasses(u.text)) {
    if (!/\b(Column|mapped_column)\s*\(/.test(c.body)) continue;
    const e: Entity = { name: c.name, table: /__tablename__\s*=\s*["']([^"']+)["']/.exec(c.body)?.[1], file: u.path, line: li(c.index), source: 'sqlalchemy', fields: [], indexes: [], conf: 'heuristic' };
    for (const m of c.body.matchAll(/^ {4}(\w+)\s*(?::\s*Mapped\[([^\n=]*)\])?\s*=\s*(?:db\.|sa\.)?(?:Column|mapped_column)\s*\(([^\n]*)/gm)) {
      const args = m[3];
      const fk = /ForeignKey\s*\(\s*["']([\w.]+)["']/.exec(args)?.[1];
      const type = (/^\s*(?:db\.|sa\.)?(\w+)/.exec(args)?.[1] ?? m[2] ?? 'unknown').replace(/^ForeignKey$/, 'Integer');
      const ln = li(c.bodyIndex + m.index!);
      e.fields.push({ name: m[1], type, line: ln, pk: /primary_key\s*=\s*True/.test(args) || undefined, unique: /\bunique\s*=\s*True/.test(args) || undefined, nullable: /nullable\s*=\s*False/.test(args) ? false : undefined, ref: fk?.split('.')[0] });
      if (fk) out.relations.push({ from: c.name, to: fk.split('.')[0], kind: 'n-1', via: m[1], file: u.path, line: ln, conf: 'heuristic' });
    }
    if (e.fields.length) out.entities.push(e);
  }
}

function djangoMigration(u: FileUnit, li: Li, out: Out) {
  for (const m of u.text.matchAll(/migrations\.CreateModel\s*\(\s*name\s*=\s*["'](\w+)["']/g)) {
    const open = u.text.indexOf('[', m.index!);
    const close = matchClose(u.text, open);
    if (open < 0 || close < 0) continue;
    const e: Entity = { name: m[1], file: u.path, line: li(m.index!), source: 'migration', fields: [], indexes: [], conf: 'heuristic' };
    for (const f of u.text.slice(open, close).matchAll(/\(\s*["'](\w+)["']\s*,\s*models\.(\w+)\s*\(([^\n]*)/g)) {
      e.fields.push({ name: f[1], type: f[2], line: li(open + f.index!), pk: /primary_key\s*=\s*True/.test(f[3]) || undefined, unique: /\bunique\s*=\s*True/.test(f[3]) || undefined });
    }
    out.entities.push(e);
  }
}

function alembic(u: FileUnit, li: Li, out: Out) {
  for (const m of u.text.matchAll(/op\.create_table\s*\(\s*["'](\w+)["']/g)) {
    const open = u.text.indexOf('(', m.index!);
    const close = matchClose(u.text, open);
    if (close < 0) continue;
    const e: Entity = { name: m[1], table: m[1], file: u.path, line: li(m.index!), source: 'migration', fields: [], indexes: [], conf: 'heuristic' };
    for (const c of u.text.slice(open, close).matchAll(/(?:sa\.)?Column\s*\(\s*["'](\w+)["']\s*,\s*(?:sa\.)?(\w+)([^\n]*)/g)) {
      const fk = /ForeignKey\s*\(\s*["']([\w.]+)["']/.exec(c[3])?.[1];
      const ln = li(open + c.index!);
      e.fields.push({ name: c[1], type: c[2], line: ln, pk: /primary_key\s*=\s*True/.test(c[3]) || undefined, nullable: /nullable\s*=\s*False/.test(c[3]) ? false : undefined, unique: /\bunique\s*=\s*True/.test(c[3]) || undefined, ref: fk?.split('.')[0] });
      if (fk) out.relations.push({ from: m[1], to: fk.split('.')[0], kind: 'n-1', via: c[1], file: u.path, line: ln, conf: 'heuristic' });
    }
    out.entities.push(e);
  }
}

// ---------------------------------------------------------------- JPA
function jpa(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  const ent = /@Entity\b/.exec(t);
  if (!ent) return;
  const cls = /\b(?:class|record)\s+(\w+)/.exec(t.slice(ent.index));
  if (!cls) return;
  const clsIdx = ent.index + cls.index;
  const open = t.indexOf('{', clsIdx);
  const close = matchClose(t, open);
  if (open < 0 || close < 0) return;
  const head = t.slice(Math.max(0, ent.index - 400), clsIdx);
  const e: Entity = { name: cls[1], table: /@Table\s*\([^)]*\bname\s*=\s*"([^"]+)"/.exec(head)?.[1], file: u.path, line: li(clsIdx), source: 'jpa', fields: [], indexes: [], conf: 'heuristic' };
  for (const ix of head.matchAll(/@Index\s*\([^)]*columnList\s*=\s*"([^"]+)"([^)]*)\)/g)) e.indexes.push({ fields: ix[1].split(',').map((s) => s.trim()), unique: /unique\s*=\s*true/.test(ix[2]) || undefined, line: li(clsIdx) });
  const kotlin = u.lang === 'kotlin';
  let annos = '';
  let off = open + 1;
  let depth = 0;
  for (const raw of t.slice(open + 1, close).split('\n')) {
    const line = raw.trim();
    const idx = off + raw.search(/\S|$/);
    off += raw.length + 1;
    const startDepth = depth;
    for (const c of raw) depth += c === '{' ? 1 : c === '}' ? -1 : 0;
    if (startDepth > 0 || !line) continue;
    if (line.startsWith('@')) {
      annos += ' ' + line;
      if (!/;\s*$/.test(line) && !(kotlin && /\b(val|var)\b/.test(line))) continue;
    }
    const f = kotlin
      ? /\b(?:val|var)\s+(\w+)\s*:\s*([\w<>?, .]+)/.exec(line)
      : /^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|protected|public)\s+)?(?:final\s+)?([\w<>\[\], .?]+?)\s+(\w+)\s*(?:=[^;]*)?;/.exec(line);
    if (f && !/\bstatic\b/.test(line) && !line.includes('(') === !/\)\s*;?$/.test(line.replace(/@\w+\([^)]*\)/g, ''))) {
      const name = kotlin ? f[1] : f[2];
      const type = (kotlin ? f[2] : f[1]).trim();
      const ln = li(idx);
      const all = annos + ' ' + line;
      if (!/@Transient\b/.test(all)) {
        const generic = /<\s*(\w+)\s*>/.exec(type)?.[1];
        if (/@ManyToOne\b/.test(all) || (/@OneToOne\b/.test(all) && !/mappedBy/.test(all))) {
          const target = type.replace(/\?$/, '');
          e.fields.push({ name, type: target, line: ln, ref: target });
          out.relations.push({ from: e.name, to: target, kind: /@ManyToOne\b/.test(all) ? 'n-1' : '1-1', via: name, file: u.path, line: ln, conf: 'heuristic' });
        } else if (/@ManyToMany\b/.test(all)) {
          if (generic && !/mappedBy/.test(all)) out.relations.push({ from: e.name, to: generic, kind: 'n-n', via: name, file: u.path, line: ln, conf: 'heuristic' });
        } else if (/@OneToMany\b/.test(all) || (/@OneToOne\b/.test(all) && /mappedBy/.test(all))) {
          /* inverse side: the owning side declares the relation */
        } else {
          e.fields.push({ name, type, line: ln, pk: /@(Id|EmbeddedId)\b/.test(all) || undefined, unique: /unique\s*=\s*true/.test(all) || undefined, nullable: /nullable\s*=\s*false/.test(all) ? false : undefined });
        }
      }
    }
    annos = '';
  }
  out.entities.push(e);
}

// ---------------------------------------------------------------- SQL DDL
const stripIdent = (s: string) => s.replace(/[`"\[\]]/g, '').split('.').pop()!.trim();
function sqlDdl(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  const tables = new Map<string, Entity>();
  const find = (name: string) => tables.get(name.toLowerCase()) ?? out.entities.find((e) => e.source === 'sql' && e.name.toLowerCase() === name.toLowerCase());
  const column = (e: Entity, def: string, at: number) => {
    const m = /^\s*([`"\[]?[\w$]+[`"\]]?)\s+([A-Za-z][\w]*(?:\s*\([^)]*\))?(?:\s+(?:unsigned|varying|precision|with(?:out)?\s+time\s+zone))*)?(.*)$/is.exec(def);
    if (!m) return;
    const name = stripIdent(m[1]);
    const rest = m[3] ?? '';
    const ref = /\bREFERENCES\s+([`"\[]?[\w.$]+[`"\]]?)/i.exec(rest)?.[1];
    const f: Field = { name, type: (m[2] ?? '').replace(/\s+/g, ' ').trim().toUpperCase() || 'UNKNOWN', line: li(at + (def.length - def.trimStart().length)), pk: /\bPRIMARY\s+KEY\b/i.test(rest) || /^(BIG)?SERIAL$/i.test(m[2] ?? '') && /\bPRIMARY\b/i.test(rest) || undefined, unique: /\bUNIQUE\b/i.test(rest) || undefined, nullable: /\bNOT\s+NULL\b/i.test(rest) ? false : undefined };
    if (ref) {
      f.ref = stripIdent(ref);
      out.relations.push({ from: e.name, to: f.ref, kind: 'n-1', via: name, file: u.path, line: f.line, conf: 'resolved' });
    }
    e.fields.push(f);
  };
  const constraint = (e: Entity, def: string, at: number) => {
    const cols = (s: string | undefined) => (s ?? '').split(',').map(stripIdent).filter(Boolean);
    const pk = /\bPRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(def);
    if (pk) for (const c of cols(pk[1])) { const f = e.fields.find((x) => x.name === c); if (f) f.pk = true; }
    const uq = /\bUNIQUE\s*(?:KEY|INDEX)?\s*(?:[`"\w]+\s*)?\(([^)]*)\)/i.exec(def);
    if (uq && !pk) {
      const cs = cols(uq[1]);
      if (cs.length === 1) { const f = e.fields.find((x) => x.name === cs[0]); if (f) f.unique = true; }
      else e.indexes.push({ fields: cs, unique: true, line: li(at) });
    }
    const fk = /\bFOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([`"\[]?[\w.$]+[`"\]]?)/i.exec(def);
    if (fk) {
      const c = cols(fk[1])[0];
      const target = stripIdent(fk[2]);
      const f = e.fields.find((x) => x.name === c);
      if (f) f.ref = target;
      out.relations.push({ from: e.name, to: target, kind: 'n-1', via: c, file: u.path, line: li(at), conf: 'resolved' });
    }
    const key = /^\s*(?:KEY|INDEX)\s+[`"\w]*\s*\(([^)]*)\)/i.exec(def);
    if (key) e.indexes.push({ fields: cols(key[1]), line: li(at) });
  };
  for (const m of t.matchAll(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:[`"\[]?[\w$]+[`"\]]?\.)?[`"\[]?[\w$]+[`"\]]?)\s*\(/gi)) {
    const open = m.index! + m[0].length - 1;
    const close = matchClose(t, open);
    if (close < 0) continue;
    const name = stripIdent(m[1]);
    const e: Entity = { name, table: name, file: u.path, line: li(m.index!), source: 'sql', fields: [], indexes: [], conf: 'resolved' };
    const parts = splitTop(t.slice(open + 1, close));
    for (const p of parts) if (!/^\s*(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CONSTRAINT|KEY|INDEX|CHECK|FULLTEXT)\b/i.test(p.text)) column(e, p.text, open + 1 + p.offset);
    for (const p of parts) if (/^\s*(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CONSTRAINT|KEY|INDEX)\b/i.test(p.text)) constraint(e, p.text, open + 1 + p.offset + (p.text.length - p.text.trimStart().length));
    if (e.fields.length === 0) continue;
    tables.set(name.toLowerCase(), e);
    out.entities.push(e);
  }
  for (const m of t.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?((?:[`"\[]?[\w$]+[`"\]]?\.)?[`"\[]?[\w$]+[`"\]]?)\s+ADD\s+([^;]*)/gi)) {
    const e = find(stripIdent(m[1]));
    if (!e) continue;
    const at = m.index! + m[0].indexOf(m[2]);
    if (/^\s*(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN)\b/i.test(m[2])) constraint(e, m[2], at);
    else column(e, m[2].replace(/^\s*COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, ''), at);
  }
  for (const m of t.matchAll(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"\w]+\s+ON\s+((?:[`"\[]?[\w$]+[`"\]]?\.)?[`"\[]?[\w$]+[`"\]]?)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/gi)) {
    const e = find(stripIdent(m[2]));
    if (e) e.indexes.push({ fields: m[3].split(',').map((s) => stripIdent(s.trim().split(/\s+/)[0])), unique: !!m[1] || undefined, line: li(m.index!) });
  }
}

// ---------------------------------------------------------------- Ruby: schema.rb, migrations, models
function rubySchema(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  const tables = new Map<string, Entity>();
  const get = (name: string) => tables.get(name) ?? out.entities.find((e) => e.table === name && e.source === 'activerecord');
  for (const m of t.matchAll(/^\s*create_table\s+[:"']([\w]+)["']?[^\n]*\bdo\s*\|(\w+)\|\s*\n([\s\S]*?)^\s*end\b/gm)) {
    const e: Entity = { name: m[1], table: m[1], file: u.path, line: li(m.index!), source: 'activerecord', fields: [], indexes: [], conf: 'heuristic' };
    if (!/id:\s*false/.test(m[0].split('\n')[0])) e.fields.push({ name: 'id', type: 'bigint (implicit)', line: e.line, pk: true });
    const bodyAt = m.index! + m[0].indexOf(m[3]);
    for (const c of m[3].matchAll(new RegExp(`^\\s*${m[2]}\\.(\\w+)\\s+(.*)$`, 'gm'))) {
      const ln = li(bodyAt + c.index!);
      const [, type, args] = c;
      if (type === 'index') e.indexes.push({ fields: strs(args.split(/\]/)[0]).concat([...args.split(/\]/)[0].matchAll(/:(\w+)/g)].map((x) => x[1])), unique: /unique:\s*true/.test(args) || undefined, line: ln });
      else if (type === 'timestamps') e.fields.push({ name: 'created_at', type: 'datetime', line: ln }, { name: 'updated_at', type: 'datetime', line: ln });
      else {
        const name = /^[:"'](\w+)/.exec(args)?.[1];
        if (!name) continue;
        const isRef = type === 'references' || type === 'belongs_to';
        e.fields.push({ name: isRef ? `${name}_id` : name, type: isRef ? 'bigint' : type, line: ln, nullable: /null:\s*false/.test(args) ? false : undefined, unique: /unique:\s*true/.test(args) || undefined, ref: isRef ? plural(name) : undefined });
        if (isRef) out.relations.push({ from: e.name, to: plural(name), kind: 'n-1', via: `${name}_id`, file: u.path, line: ln, conf: 'heuristic' });
      }
    }
    tables.set(m[1], e);
    out.entities.push(e);
  }
  for (const m of t.matchAll(/^\s*add_foreign_key\s+[:"'](\w+)["']?\s*,\s*[:"'](\w+)/gm)) {
    if (!out.relations.some((r) => r.from === m[1] && r.to === m[2])) out.relations.push({ from: m[1], to: m[2], kind: 'n-1', file: u.path, line: li(m.index!), conf: 'heuristic' });
    const e = get(m[1]);
    const f = e?.fields.find((x) => x.name === `${singular(m[2])}_id`);
    if (f) f.ref = m[2];
  }
  for (const m of t.matchAll(/^\s*add_column\s+[:"'](\w+)["']?\s*,\s*[:"'](\w+)["']?\s*,\s*:(\w+)/gm)) get(m[1])?.fields.push({ name: m[2], type: m[3], line: li(m.index!) });
  for (const m of t.matchAll(/^\s*add_reference\s+[:"'](\w+)["']?\s*,\s*[:"'](\w+)/gm)) {
    get(m[1])?.fields.push({ name: `${m[2]}_id`, type: 'bigint', line: li(m.index!), ref: plural(m[2]) });
    out.relations.push({ from: m[1], to: plural(m[2]), kind: 'n-1', via: `${m[2]}_id`, file: u.path, line: li(m.index!), conf: 'heuristic' });
  }
  for (const m of t.matchAll(/^\s*add_index\s+[:"'](\w+)["']?\s*,\s*(\[[^\]]*\]|[:"']\w+["']?)(.*)$/gm)) {
    get(m[1])?.indexes.push({ fields: strs(m[2]).concat([...m[2].matchAll(/:(\w+)/g)].map((x) => x[1])), unique: /unique:\s*true/.test(m[3]) || undefined, line: li(m.index!) });
  }
}

function rubyModel(u: FileUnit, li: Li, out: Out, models: Map<string, { file: string; line: number }>) {
  const m = /^\s*class\s+(\w+)\s*<\s*(ApplicationRecord|ActiveRecord::Base)\b/m.exec(u.text);
  if (!m) return;
  models.set(m[1], { file: u.path, line: li(m.index) });
  for (const r of u.text.matchAll(/^\s*(belongs_to|has_and_belongs_to_many)\s+:(\w+)(.*)$/gm)) {
    const target = /class_name:\s*["'](\w+)["']/.exec(r[3])?.[1] ?? camel(singular(r[2]));
    out.relations.push({ from: m[1], to: target, kind: r[1] === 'belongs_to' ? 'n-1' : 'n-n', via: r[1] === 'belongs_to' ? `${r[2]}_id` : undefined, file: u.path, line: li(r.index!), conf: 'heuristic' });
  }
}

// ---------------------------------------------------------------- JS / PHP migrations, Eloquent
function knex(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  for (const m of t.matchAll(/\.createTable(?:IfNotExists)?\s*\(\s*['"`](\w+)['"`]\s*,/g)) {
    const open = t.indexOf('{', m.index! + m[0].length);
    const close = matchClose(t, open);
    const v = /(?:\(\s*(\w+)\s*\)|(\w+))\s*=>|function\s*\(\s*(\w+)/.exec(t.slice(m.index! + m[0].length, open + 1));
    const tv = v?.[1] ?? v?.[2] ?? v?.[3];
    if (open < 0 || close < 0 || !tv) continue;
    const e: Entity = { name: m[1], table: m[1], file: u.path, line: li(m.index!), source: 'migration', fields: [], indexes: [], conf: 'heuristic' };
    for (const c of t.slice(open, close).matchAll(new RegExp(`\\b${tv}\\.(\\w+)\\s*\\(([^)]*)\\)([^;\\n]*)`, 'g'))) {
      const ln = li(open + c.index!);
      const [, type, args, chain] = c;
      const name = strs(args)[0];
      if (type === 'timestamps') e.fields.push({ name: 'created_at', type: 'timestamp', line: ln }, { name: 'updated_at', type: 'timestamp', line: ln });
      else if (type === 'unique' || type === 'index' || type === 'primary') {
        if (type === 'primary') for (const n of strs(args)) { const f = e.fields.find((x) => x.name === n); if (f) f.pk = true; }
        else e.indexes.push({ fields: strs(args), unique: type === 'unique' || undefined, line: ln });
      } else if (type === 'foreign') {
        const target = /\.inTable\s*\(\s*['"`](\w+)/.exec(chain)?.[1] ?? /\.references\s*\(\s*['"`](\w+)\./.exec(chain)?.[1];
        if (target && name) out.relations.push({ from: e.name, to: target, kind: 'n-1', via: name, file: u.path, line: ln, conf: 'heuristic' });
      } else if (name) {
        const target = /\.inTable\s*\(\s*['"`](\w+)/.exec(chain)?.[1] ?? /\.references\s*\(\s*['"`](\w+)\./.exec(chain)?.[1];
        e.fields.push({ name, type, line: ln, pk: type === 'increments' || type === 'bigIncrements' || /\.primary\s*\(/.test(chain) || undefined, unique: /\.unique\s*\(/.test(chain) || undefined, nullable: /\.notNullable\s*\(/.test(chain) ? false : undefined, ref: target });
        if (target) out.relations.push({ from: e.name, to: target, kind: 'n-1', via: name, file: u.path, line: ln, conf: 'heuristic' });
      }
    }
    out.entities.push(e);
  }
}

function laravelMigration(u: FileUnit, li: Li, out: Out) {
  const t = u.text;
  for (const m of t.matchAll(/Schema::create\s*\(\s*['"](\w+)['"]/g)) {
    const open = t.indexOf('{', m.index!);
    const close = matchClose(t, open);
    if (open < 0 || close < 0) continue;
    const e: Entity = { name: m[1], table: m[1], file: u.path, line: li(m.index!), source: 'migration', fields: [], indexes: [], conf: 'heuristic' };
    for (const c of t.slice(open, close).matchAll(/\$table->(\w+)\s*\(([^)]*)\)([^;]*);/g)) {
      const ln = li(open + c.index!);
      const [, type, args, chain] = c;
      const name = strs(args)[0];
      if (type === 'id') e.fields.push({ name: name ?? 'id', type: 'bigIncrements', line: ln, pk: true });
      else if (type === 'timestamps' || type === 'timestampsTz') e.fields.push({ name: 'created_at', type: 'timestamp', line: ln }, { name: 'updated_at', type: 'timestamp', line: ln });
      else if (type === 'softDeletes') e.fields.push({ name: 'deleted_at', type: 'timestamp', line: ln, nullable: true });
      else if (type === 'rememberToken') e.fields.push({ name: 'remember_token', type: 'string', line: ln, nullable: true });
      else if (type === 'unique' || type === 'index') e.indexes.push({ fields: strs(args), unique: type === 'unique' || undefined, line: ln });
      else if (type === 'primary') for (const n of strs(args)) { const f = e.fields.find((x) => x.name === n); if (f) f.pk = true; }
      else if (type === 'foreign') {
        const target = /->on\s*\(\s*['"](\w+)/.exec(chain)?.[1];
        if (target && name) out.relations.push({ from: e.name, to: target, kind: 'n-1', via: name, file: u.path, line: ln, conf: 'heuristic' });
      } else if (name) {
        const constrained = /->constrained\s*\(\s*(?:['"](\w+)['"])?/.exec(chain);
        const target = constrained ? constrained[1] ?? plural(name.replace(/_id$/, '')) : undefined;
        e.fields.push({ name, type, line: ln, pk: /increments/i.test(type) || /->primary\s*\(/.test(chain) || undefined, unique: /->unique\s*\(/.test(chain) || undefined, nullable: /->nullable\s*\(/.test(chain) || undefined, ref: target });
        if (target) out.relations.push({ from: e.name, to: target, kind: 'n-1', via: name, file: u.path, line: ln, conf: 'heuristic' });
      }
    }
    out.entities.push(e);
  }
}

function eloquent(u: FileUnit, li: Li, out: Out) {
  const m = /class\s+(\w+)\s+extends\s+(?:Model|Authenticatable|Pivot)\b/.exec(u.text);
  if (!m) return;
  const e: Entity = { name: m[1], table: /\$table\s*=\s*['"](\w+)['"]/.exec(u.text)?.[1] ?? plural(snake(m[1])), file: u.path, line: li(m.index), source: 'eloquent', fields: [], indexes: [], conf: 'heuristic' };
  const fill = /\$fillable\s*=\s*\[([^\]]*)\]/.exec(u.text);
  if (fill) for (const f of strs(fill[1])) e.fields.push({ name: f, type: 'fillable', line: li(fill.index) });
  for (const r of u.text.matchAll(/\$this->(belongsTo|belongsToMany|hasOne)\s*\(\s*\\?(?:[\w\\]*\\)?(\w+)::class/g)) {
    out.relations.push({ from: m[1], to: r[2], kind: r[1] === 'belongsTo' ? 'n-1' : r[1] === 'hasOne' ? '1-1' : 'n-n', file: u.path, line: li(r.index!), conf: 'heuristic' });
  }
  out.entities.push(e);
}

// ---------------------------------------------------------------- EF Core, GORM
function efcore(units: FileUnit[], lis: Map<string, Li>, out: Out) {
  const cs = units.filter((u) => u.lang === 'csharp');
  const sets = new Map<string, string>();
  for (const u of cs) for (const m of u.text.matchAll(/\bDbSet<\s*(\w+)\s*>\s+(\w+)/g)) sets.set(m[1], m[2]);
  if (sets.size === 0) return;
  for (const u of cs) {
    const li = lis.get(u.path)!;
    for (const m of u.text.matchAll(/\b(?:class|record)\s+(\w+)\b[^{;]*\{/g)) {
      if (!sets.has(m[1])) continue;
      const open = m.index! + m[0].length - 1;
      const close = matchClose(u.text, open);
      if (close < 0) continue;
      const head = u.text.slice(Math.max(0, m.index! - 200), m.index!);
      const e: Entity = { name: m[1], table: /\[Table\s*\(\s*"([^"]+)"/.exec(head)?.[1] ?? sets.get(m[1]), file: u.path, line: li(m.index!), source: 'efcore', fields: [], indexes: [], conf: 'heuristic' };
      const body = u.text.slice(open, close);
      for (const p of body.matchAll(/((?:\[[^\]]*\]\s*)*)public\s+(?:virtual\s+|required\s+)?([\w<>?\[\], .]+?)\s+(\w+)\s*\{\s*get;/g)) {
        const [, attrs, rawType, name] = p;
        const type = rawType.trim();
        const ln = li(open + p.index! + p[0].indexOf('public'));
        if (/\[NotMapped\]/.test(attrs)) continue;
        const coll = /^(?:ICollection|List|IList|IEnumerable|HashSet)<\s*(\w+)\s*>/.exec(type);
        if (coll && sets.has(coll[1])) continue; // inverse navigation
        const nav = type.replace(/\?$/, '');
        if (sets.has(nav)) {
          e.fields.push({ name, type: nav, line: ln, ref: nav });
          out.relations.push({ from: e.name, to: nav, kind: 'n-1', via: name, file: u.path, line: ln, conf: 'heuristic' });
        } else e.fields.push({ name, type, line: ln, pk: /\[Key\]/.test(attrs) || name === 'Id' || name === `${m[1]}Id` || undefined, nullable: type.endsWith('?') || undefined });
      }
      out.entities.push(e);
    }
  }
}

function gorm(u: FileUnit, li: Li, out: Out, known: Set<string>) {
  if (!/gorm\.io\/gorm|jinzhu\/gorm/.test(u.text)) return;
  const structs = [...u.text.matchAll(/^type\s+(\w+)\s+struct\s*\{([\s\S]*?)^\}/gm)];
  for (const s of structs) known.add(s[1]);
  for (const s of structs) {
    if (!/gorm\.Model|`[^`]*gorm:|\bID\s+u?int/.test(s[2])) continue;
    const e: Entity = { name: s[1], file: u.path, line: li(s.index!), source: 'gorm', fields: [], indexes: [], conf: 'heuristic' };
    const bodyAt = s.index! + s[0].indexOf(s[2]);
    let off = bodyAt;
    for (const raw of s[2].split('\n')) {
      const line = raw.trim();
      const ln = li(off);
      off += raw.length + 1;
      if (!line || line.startsWith('//')) continue;
      if (/^gorm\.Model\b/.test(line)) {
        e.fields.push({ name: 'ID', type: 'uint', line: ln, pk: true }, { name: 'CreatedAt', type: 'time.Time', line: ln }, { name: 'UpdatedAt', type: 'time.Time', line: ln }, { name: 'DeletedAt', type: 'gorm.DeletedAt', line: ln, nullable: true });
        continue;
      }
      const f = /^(\w+)\s+([\w.*\[\]]+)\s*(`[^`]*`)?/.exec(line);
      if (!f) continue;
      const [, name, type, tag = ''] = f;
      const base = type.replace(/^[\[\]*]+/, '').split('.').pop()!;
      if (known.has(base) && base !== s[1] + 'x') {
        continue; // association field (has-many slice or belongs-to struct), not a column
      }
      const fk = /^(\w+)ID$/.exec(name);
      const field: Field = { name, type, line: ln, pk: /primaryKey|primary_key/.test(tag) || name === 'ID' || undefined, unique: /unique/.test(tag) || undefined, nullable: type.startsWith('*') || undefined };
      if (fk && known.has(fk[1])) {
        field.ref = fk[1];
        out.relations.push({ from: s[1], to: fk[1], kind: 'n-1', via: name, file: u.path, line: ln, conf: 'heuristic' });
      }
      e.fields.push(field);
    }
    out.entities.push(e);
  }
}

// ---------------------------------------------------------------- orchestration
const ORM_SOURCES = new Set(['prisma', 'mongoose', 'typeorm', 'sequelize', 'sqlalchemy', 'django', 'jpa', 'eloquent', 'efcore', 'gorm']);

export function reconstructSchema(units: FileUnit[]): { entities: Entity[]; relations: Relation[] } {
  const out: Out = { entities: [], relations: [] };
  const lis = new Map<string, Li>();
  const liOf = (u: FileUnit): Li => {
    let f = lis.get(u.path);
    if (!f) {
      const idx = new LineIndex(u.text);
      f = (i: number) => idx.lineAt(i);
      lis.set(u.path, f);
    }
    return f;
  };
  const rubyModels = new Map<string, { file: string; line: number }>();
  const goStructs = new Set<string>();
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* one malformed file must not break schema reconstruction */
    }
  };
  const sorted = [...units].sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const u of sorted) for (const m of u.lang === 'go' && /gorm/.test(u.text) ? u.text.matchAll(/^type\s+(\w+)\s+struct\b/gm) : []) goStructs.add(m[1]);
  for (const u of sorted) {
    const li = liOf(u);
    const t = u.text;
    if (u.lang === 'prisma') safe(() => prisma(u, li, out));
    else if (u.lang === 'sql') safe(() => sqlDdl(u, li, out));
    else if (u.lang === 'javascript' || u.lang === 'typescript') {
      if (/\bSchema\s*(?:<[^>]*>)?\s*\(/.test(t) && /mongoose/i.test(t)) safe(() => mongoose(u, li, out));
      if (t.includes('@Entity')) safe(() => typeorm(u, li, out));
      if (/\.init\s*\(\s*\{|\.define\s*\(\s*['"]/.test(t) && /sequelize|DataTypes/i.test(t)) safe(() => sequelize(u, li, out));
      if (/\.createTable/.test(t)) safe(() => knex(u, li, out));
    } else if (u.lang === 'python') {
      if (/models\.\w+\s*\(/.test(t) && /^class\s/m.test(t)) safe(() => django(u, li, out));
      if (/\b(Column|mapped_column)\s*\(/.test(t) && /^class\s/m.test(t)) safe(() => sqlalchemy(u, li, out));
      if (/op\.create_table/.test(t)) safe(() => alembic(u, li, out));
    } else if (u.lang === 'java' || u.lang === 'kotlin') {
      if (t.includes('@Entity')) safe(() => jpa(u, li, out));
    } else if (u.lang === 'ruby') {
      if (/create_table\b/.test(t)) safe(() => rubySchema(u, li, out));
      safe(() => rubyModel(u, li, out, rubyModels));
    } else if (u.lang === 'php') {
      if (/Schema::create/.test(t)) safe(() => laravelMigration(u, li, out));
      if (/extends\s+(Model|Authenticatable|Pivot)\b/.test(t)) safe(() => eloquent(u, li, out));
    } else if (u.lang === 'go') safe(() => gorm(u, li, out, goStructs));
  }
  for (const u of sorted) if (u.lang === 'python' && /migrations\.CreateModel/.test(u.text)) safe(() => djangoMigration(u, liOf(u), out));
  for (const u of sorted) liOf(u);
  safe(() => efcore(sorted, lis, out));

  // Rails: name table entities after their model classes
  const rename = new Map<string, string>();
  for (const e of out.entities) {
    if (e.source !== 'activerecord') continue;
    const cls = camel(singular(e.name));
    const model = rubyModels.get(cls);
    if (model) {
      rename.set(e.name, cls);
      e.name = cls;
    }
  }
  for (const [cls, loc] of rubyModels) {
    if (!out.entities.some((e) => e.name === cls)) out.entities.push({ name: cls, table: plural(snake(cls)), file: loc.file, line: loc.line, source: 'activerecord', fields: [], indexes: [], conf: 'heuristic' });
  }

  // prefer ORM models over migrations / raw tables describing the same table
  const tableKeys = (e: Entity) => [e.table, plural(snake(e.name)), snake(e.name), e.name].filter(Boolean).map((s) => s!.toLowerCase());
  const orm = out.entities.filter((e) => ORM_SOURCES.has(e.source) || (e.source === 'activerecord' && rubyModels.has(e.name)));
  const merged = new Set<Entity>();
  for (const e of out.entities) {
    if (orm.includes(e)) continue;
    const owner = orm.find((o) => o.name.toLowerCase() === e.name.toLowerCase() || tableKeys(o).includes((e.table ?? e.name).toLowerCase()) || (o.source === 'django' && (e.table ?? e.name).toLowerCase().endsWith('_' + o.name.toLowerCase())));
    if (!owner) continue;
    for (const f of e.fields) if (!owner.fields.some((x) => x.name === f.name) && owner.source === 'eloquent') owner.fields.push(f);
    for (const ix of e.indexes) if (owner.source === 'eloquent') owner.indexes.push(ix);
    rename.set(e.name, owner.name);
    merged.add(e);
  }
  // duplicates of the same name from the same kind of source (e.g. two migrations): keep the richest
  const byName = new Map<string, Entity>();
  for (const e of out.entities) {
    if (merged.has(e)) continue;
    const cur = byName.get(e.name);
    if (!cur || (ORM_SOURCES.has(e.source) && !ORM_SOURCES.has(cur.source)) || (ORM_SOURCES.has(e.source) === ORM_SOURCES.has(cur.source) && e.fields.length > cur.fields.length)) byName.set(e.name, e);
  }
  const entities = [...byName.values()];

  // resolve relation endpoints (table names / plural forms → entity names)
  const lookup = new Map<string, string>();
  for (const e of entities) for (const k of [e.name, ...tableKeys(e)]) if (!lookup.has(k.toLowerCase())) lookup.set(k.toLowerCase(), e.name);
  const resolve = (n: string) => rename.get(n) ?? lookup.get(n.toLowerCase()) ?? lookup.get(singular(n.toLowerCase())) ?? n;
  const seen = new Set<string>();
  const relations: Relation[] = [];
  for (const r of out.relations) {
    const from = resolve(r.from);
    const to = resolve(r.to);
    if (!byName.has(from) || !byName.has(to)) continue;
    const key = `${from}>${to}>${r.via ?? ''}`;
    const loose = `${from}>${to}>`;
    if (seen.has(key) || (!r.via && [...seen].some((k) => k.startsWith(loose)))) continue;
    seen.add(key);
    relations.push({ ...r, from, to });
  }
  for (const e of entities) for (const f of e.fields) if (f.ref) f.ref = resolve(f.ref);
  entities.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { entities, relations };
}

/** Map database-access facts to reconstructed entities. */
export function mapAccess(ctx: StageContext, entities: Entity[]): EntityAccess[] {
  const lookup = new Map<string, string>();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const e of entities) {
    for (const k of [e.name, e.table, plural(snake(e.name)), snake(e.name)]) if (k && !lookup.has(norm(k))) lookup.set(norm(k), e.name);
  }
  const find = (target: string): string | undefined => {
    const n = norm(target);
    const hit = lookup.get(n) ?? lookup.get(norm(singular(target.toLowerCase())));
    if (hit) return hit;
    // Django-style "<app>_<model>" table names
    const us = target.indexOf('_');
    if (us > 0) return lookup.get(norm(target.slice(us + 1))) ?? lookup.get(norm(singular(target.slice(us + 1).toLowerCase())));
    return undefined;
  };
  const out: EntityAccess[] = [];
  const seen = new Set<string>();
  for (const f of ctx.a.facts) {
    if (f.kind !== 'db' || !f.target || !f.op) continue;
    const entity = find(f.target);
    if (!entity) continue;
    const key = `${entity}|${f.file}|${f.line}|${f.op}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ entity, file: f.file, line: f.line, op: f.op, detail: f.detail, conf: f.conf });
  }
  return out;
}

export function erToMermaid(schema: SchemaResult, maxEntities = 60): string {
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = ['erDiagram'];
  const shown = schema.entities.slice(0, maxEntities);
  const names = new Set(shown.map((e) => e.name));
  for (const e of shown) {
    lines.push(`  ${id(e.name)} {`);
    for (const f of e.fields.slice(0, 40)) {
      const type = id(f.type.replace(/\s*\(.*$/, '').replace(/[<>\[\]]/g, '_')).replace(/_+$/, '') || 'unknown';
      const keys = [f.pk ? 'PK' : '', f.ref ? 'FK' : '', f.unique && !f.pk ? 'UK' : ''].filter(Boolean).join(',');
      lines.push(`    ${type} ${id(f.name)}${keys ? ' ' + keys : ''}`);
    }
    lines.push('  }');
  }
  const arrow = { 'n-1': '}o--||', '1-1': '||--||', 'n-n': '}o--o{', '1-n': '||--o{' } as const;
  for (const r of schema.relations) {
    if (!names.has(r.from) || !names.has(r.to)) continue;
    lines.push(`  ${id(r.from)} ${arrow[r.kind]} ${id(r.to)} : "${(r.via ?? 'relates to').replace(/"/g, '')}"`);
  }
  return lines.join('\n');
}

export const schemaStage: Stage = {
  name: 'Reconstructing the data model',
  phase: 'deep',
  run(ctx) {
    const { entities, relations } = reconstructSchema(ctx.units);
    ctx.a.schema = { entities, relations, access: mapAccess(ctx, entities) };
    const m = new Map(ctx.a.files.map((f) => [f.path, f]));
    for (const e of entities) {
      const f = m.get(e.file);
      if (f && (f.role === 'unknown' || f.role === 'util') && ORM_SOURCES.has(e.source)) {
        f.role = 'model';
        f.roleConf = 'heuristic';
        f.roleSource = 'schema';
      }
    }
  },
};
