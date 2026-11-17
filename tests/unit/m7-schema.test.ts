import { describe, expect, it } from 'vitest';
import { erToMermaid } from '../../src/core/schema';
import type { Analysis } from '../../src/core/types';
import { analyzeFixture, analyzeMem, FIXTURE_NAMES, groundTruth } from '../helpers';

const ent = (a: Analysis, name: string) => a.schema.entities.find((e) => e.name === name);
const rel = (a: Analysis, from: string, to: string) => a.schema.relations.find((r) => r.from === from && r.to === to);

describe('schema reconstruction on fixtures', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: entities, fields, relations and entity access`, async () => {
      const gt = groundTruth(name);
      const { analysis: a } = await analyzeFixture(name);
      for (const g of gt.entities) {
        const e = ent(a, g.name);
        expect(e, `entity ${g.name} in [${a.schema.entities.map((x) => x.name).join(', ')}]`).toBeTruthy();
        const fields = e!.fields.map((f) => f.name);
        for (const f of g.fields) expect(fields, `${g.name}.${f}`).toContain(f);
        const file = a.files.find((f) => f.path === e!.file)!;
        expect(file, e!.file).toBeTruthy();
        expect(e!.line).toBeLessThanOrEqual(file.loc);
        for (const f of e!.fields) expect(f.line).toBeLessThanOrEqual(file.loc + 1);
      }
      expect(a.schema.entities.length).toBe(gt.entities.length);
      for (const r of gt.relations) expect(rel(a, r.from, r.to), `relation ${r.from} -> ${r.to} in ${JSON.stringify(a.schema.relations.map((x) => `${x.from}->${x.to}`))}`).toBeTruthy();
      for (const x of gt.entityAccess ?? []) {
        expect(a.schema.access.some((s) => s.entity === x.entity && s.file === x.file && s.op === x.op), `${x.op} of ${x.entity} in ${x.file}: ${JSON.stringify(a.schema.access.filter((s) => s.file === x.file))}`).toBe(true);
      }
      const mer = erToMermaid(a.schema);
      expect(mer.startsWith('erDiagram')).toBe(true);
      for (const g of gt.entities) expect(mer).toContain(g.name);
    });
  }

  it('captures keys, uniqueness, indexes and relation kinds', async () => {
    const { analysis: p } = await analyzeFixture('nestjs-prisma');
    expect(ent(p, 'User')!.fields.find((f) => f.name === 'id')!.pk).toBe(true);
    expect(ent(p, 'User')!.fields.find((f) => f.name === 'email')!.unique).toBe(true);
    expect(ent(p, 'User')!.fields.find((f) => f.name === 'name')!.nullable).toBe(true);
    expect(ent(p, 'Post')!.indexes[0].fields).toEqual(['authorId', 'published']);
    expect(rel(p, 'Post', 'User')!.kind).toBe('n-1');
    expect(ent(p, 'Post')!.source).toBe('prisma');
    const { analysis: m } = await analyzeFixture('express-mongoose');
    expect(ent(m, 'User')!.fields.find((f) => f.name === 'email')!.unique).toBe(true);
    expect(ent(m, 'Order')!.fields.find((f) => f.name === 'user')!.ref).toBe('User');
    expect(ent(m, 'Order')!.indexes[0].fields).toEqual(['user', 'createdAt']);
    const { analysis: s } = await analyzeFixture('spring-boot');
    expect(ent(s, 'Product')!.table).toBe('products');
    expect(ent(s, 'Product')!.fields.find((f) => f.name === 'sku')!.unique).toBe(true);
    expect(ent(s, 'Product')!.fields.find((f) => f.name === 'id')!.pk).toBe(true);
    const { analysis: d } = await analyzeFixture('django-app');
    expect(ent(d, 'Product')!.indexes[0].fields).toEqual(['category', 'active']);
    expect(ent(d, 'Category')!.fields.find((f) => f.name === 'slug')!.unique).toBe(true);
    const { analysis: t } = await analyzeFixture('monorepo');
    expect(ent(t, 'Customer')!.table).toBe('customers');
    expect(ent(t, 'Invoice')!.indexes[0].fields).toEqual(['status', 'customer']);
    const { analysis: l } = await analyzeFixture('legacy-php');
    expect(ent(l, 'orders')!.indexes[0].fields).toEqual(['user_id', 'created_at']);
    expect(ent(l, 'users')!.fields.find((f) => f.name === 'email')!.unique).toBe(true);
    expect(ent(l, 'orders')!.fields.find((f) => f.name === 'user_id')!.ref).toBe('users');
  });

  it('Sequelize, SQLAlchemy, ActiveRecord, Knex/Laravel/Alembic migrations, EF Core and GORM', async () => {
    const { analysis: a } = await analyzeMem({
      'package.json': '{"dependencies":{"sequelize":"6","knex":"3"}}',
      'js/models/account.js': "const { DataTypes, Model } = require('sequelize');\nclass Account extends Model {}\nAccount.init({\n  email: { type: DataTypes.STRING, allowNull: false, unique: true },\n  plan: DataTypes.STRING,\n}, { sequelize, modelName: 'Account' });\nconst Seat = sequelize.define('Seat', {\n  label: DataTypes.STRING,\n});\nSeat.belongsTo(Account);\nAccount.hasMany(Seat);\nmodule.exports = { Account, Seat };\n",
      'js/migrations/001_tickets.js': "exports.up = (knex) => knex.schema.createTable('tickets', (t) => {\n  t.increments('id');\n  t.string('title').notNullable();\n  t.integer('account_id').references('id').inTable('accounts');\n  t.unique(['title']);\n});\n",
      'py/models.py': "from sqlalchemy import Column, Integer, String, ForeignKey\nfrom sqlalchemy.orm import relationship, declarative_base\nBase = declarative_base()\n\nclass Author(Base):\n    __tablename__ = 'authors'\n    id = Column(Integer, primary_key=True)\n    name = Column(String(80), nullable=False, unique=True)\n    books = relationship('Book', back_populates='author')\n\nclass Book(Base):\n    __tablename__ = 'books'\n    id = Column(Integer, primary_key=True)\n    title = Column(String)\n    author_id = Column(Integer, ForeignKey('authors.id'))\n",
      'py/alembic/versions/1_init.py': "import sqlalchemy as sa\nfrom alembic import op\n\ndef upgrade():\n    op.create_table('reviews',\n        sa.Column('id', sa.Integer, primary_key=True),\n        sa.Column('book_id', sa.Integer, sa.ForeignKey('books.id')),\n        sa.Column('stars', sa.Integer, nullable=False),\n    )\n",
      'rb/db/schema.rb': "ActiveRecord::Schema.define(version: 1) do\n  create_table \"teams\", force: :cascade do |t|\n    t.string \"name\", null: false\n    t.index [\"name\"], name: \"idx\", unique: true\n  end\n  create_table \"players\", force: :cascade do |t|\n    t.string \"nick\"\n    t.bigint \"team_id\"\n  end\n  add_foreign_key \"players\", \"teams\"\nend\n",
      'rb/app/models/player.rb': 'class Player < ApplicationRecord\n  belongs_to :team\nend\n',
      'rb/app/models/team.rb': 'class Team < ApplicationRecord\n  has_many :players\nend\n',
      'php/database/migrations/2024_create_articles.php': "<?php\nSchema::create('articles', function (Blueprint $table) {\n    $table->id();\n    $table->string('slug')->unique();\n    $table->foreignId('writer_id')->constrained('writers');\n    $table->timestamps();\n});\n",
      'cs/Data/ShopContext.cs': 'using Microsoft.EntityFrameworkCore;\npublic class ShopContext : DbContext {\n  public DbSet<Basket> Baskets { get; set; }\n  public DbSet<BasketLine> BasketLines { get; set; }\n}\n',
      'cs/Models/Basket.cs': 'public class Basket {\n  public int Id { get; set; }\n  public string Owner { get; set; }\n  public ICollection<BasketLine> Lines { get; set; }\n}\n',
      'cs/Models/BasketLine.cs': 'public class BasketLine {\n  [Key]\n  public int Id { get; set; }\n  public int Quantity { get; set; }\n  public Basket Basket { get; set; }\n}\n',
      'go/models.go': 'package models\n\nimport "gorm.io/gorm"\n\ntype Warehouse struct {\n\tgorm.Model\n\tCode string `gorm:"uniqueIndex"`\n\tBins []Bin\n}\n\ntype Bin struct {\n\tID uint `gorm:"primaryKey"`\n\tWarehouseID uint\n\tLabel string\n}\n',
    });
    const names = a.schema.entities.map((e) => `${e.source}:${e.name}`).sort();
    for (const n of ['sequelize:Account', 'sequelize:Seat', 'migration:tickets', 'sqlalchemy:Author', 'sqlalchemy:Book', 'migration:reviews', 'activerecord:Team', 'activerecord:Player', 'migration:articles', 'efcore:Basket', 'efcore:BasketLine', 'gorm:Warehouse', 'gorm:Bin']) expect(names, n).toContain(n);
    expect(ent(a, 'Account')!.fields.find((f) => f.name === 'email')!.unique).toBe(true);
    expect(rel(a, 'Seat', 'Account')!.kind).toBe('n-1');
    expect(ent(a, 'tickets')!.fields.map((f) => f.name)).toEqual(['id', 'title', 'account_id']);
    expect(ent(a, 'Book')!.fields.find((f) => f.name === 'author_id')!.ref).toBe('Author');
    expect(rel(a, 'Book', 'Author')).toBeTruthy();
    expect(ent(a, 'Author')!.table).toBe('authors');
    expect(rel(a, 'reviews', 'Book')).toBeTruthy();
    expect(ent(a, 'Team')!.fields.map((f) => f.name)).toContain('name');
    expect(ent(a, 'Team')!.indexes[0]).toMatchObject({ fields: ['name'], unique: true });
    expect(rel(a, 'Player', 'Team')).toBeTruthy();
    expect(ent(a, 'articles')!.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['id', 'slug', 'writer_id', 'created_at']));
    expect(rel(a, 'BasketLine', 'Basket')).toBeTruthy();
    expect(ent(a, 'BasketLine')!.fields.find((f) => f.name === 'Id')!.pk).toBe(true);
    expect(rel(a, 'Bin', 'Warehouse')).toBeTruthy();
    expect(ent(a, 'Warehouse')!.fields.find((f) => f.name === 'Code')!.unique).toBe(true);
  });

  it('SQL DDL: constraints, ALTER TABLE, quoted names; never crashes on junk', async () => {
    const { analysis: a } = await analyzeMem({
      'db/001.sql': 'CREATE TABLE IF NOT EXISTS "public"."accounts" (\n  id BIGSERIAL,\n  email TEXT NOT NULL,\n  balance NUMERIC(10,2) DEFAULT 0,\n  PRIMARY KEY (id),\n  CONSTRAINT uq UNIQUE (email)\n);\n',
      'db/002.sql': 'CREATE TABLE transfers (\n  id SERIAL PRIMARY KEY,\n  from_id BIGINT REFERENCES accounts(id),\n  to_id BIGINT,\n  CONSTRAINT fk_to FOREIGN KEY (to_id) REFERENCES accounts (id)\n);\nALTER TABLE transfers ADD COLUMN memo VARCHAR(200);\nCREATE UNIQUE INDEX idx_pair ON transfers (from_id, to_id);\n',
      'db/junk.sql': 'CREATE TABLE (((\nSELECT * FROM;;; CREATE TABLE x',
      'a.py': 'x = 1\n',
    });
    const acc = ent(a, 'accounts')!;
    expect(acc.fields.map((f) => f.name)).toEqual(['id', 'email', 'balance']);
    expect(acc.fields[0].pk).toBe(true);
    expect(acc.fields[1].unique).toBe(true);
    expect(acc.fields[1].nullable).toBe(false);
    const tr = ent(a, 'transfers')!;
    expect(tr.fields.map((f) => f.name)).toEqual(['id', 'from_id', 'to_id', 'memo']);
    expect(tr.indexes).toEqual([expect.objectContaining({ fields: ['from_id', 'to_id'], unique: true })]);
    expect(a.schema.relations.filter((r) => r.from === 'transfers' && r.to === 'accounts')).toHaveLength(2);
  });
});
