import { describe, expect, it } from 'vitest';
import { nodeEnv } from '../../src/core/node-env';
import { parseL1 } from '../../src/core/l1/treesitter';
import { detectLanguage } from '../../src/core/l0/languages';
import { DEFAULT_OPTIONS, type FileParse } from '../../src/core/types';

nodeEnv(); // configures grammar paths

async function parse(path: string, text: string): Promise<FileParse> {
  const r = await parseL1({ path, text, lang: detectLanguage(path), hash: '', size: text.length }, DEFAULT_OPTIONS);
  expect(r, path).not.toBeNull();
  expect(r!.error, path).toBeUndefined();
  return r!;
}
const names = (p: FileParse, kind?: string) => p.defs.filter((d) => !kind || d.kind === kind).map((d) => (d.parent ? `${d.parent}.${d.name}` : d.name));
const calls = (p: FileParse) => p.calls.map((c) => (c.recv ? `${c.recv}.${c.name}` : c.name));
const def = (p: FileParse, name: string) => p.defs.find((d) => d.name === name)!;

describe('L1 extraction per language', () => {
  it('TypeScript', async () => {
    const p = await parse('a.ts', `import { x, y as z } from './m';
import type { T } from './t';
import * as ns from 'pkg';
export class Svc {
  constructor(private dep: Dep) {}
  async run(a: number, b: number): Promise<number> {
    if (a > 0 && b > 0) { for (const i of [1]) { if (i) return x(i); } }
    else if (a < 0) { return a ? this.dep.load(a) : 3; }
    return new Thing().go();
  }
}
export const helper = (v: string) => v.trim();
export interface Shape { area(): number }
export type Id = string;
export enum Color { Red }
const lazy = () => import('./lazy');
`);
    expect(names(p)).toEqual(expect.arrayContaining(['Svc', 'Svc.constructor', 'Svc.run', 'helper', 'Shape', 'Id', 'Color', 'lazy']));
    expect(def(p, 'run').complexity).toBe(7);
    expect(def(p, 'run').nesting).toBe(3);
    expect(def(p, 'run').params).toBe(2);
    expect(def(p, 'Svc').exported).toBe(true);
    expect(p.imports.map((i) => [i.spec, i.kind])).toEqual([['./m', 'static'], ['./t', 'static'], ['pkg', 'static'], ['./lazy', 'dynamic']]);
    expect(p.imports[0].names).toEqual([['x', 'x'], ['y', 'z']]);
    expect(p.imports[1].typeOnly).toBe(true);
    expect(calls(p)).toEqual(expect.arrayContaining(['x', 'this.dep.load', 'Thing', 'v.trim']));
  });

  it('JavaScript (CommonJS) and JSX', async () => {
    const p = await parse('a.jsx', `const svc = require('./svc');
const { a, b: c } = require('./ab');
exports.list = async (req, res) => { res.json(await svc.all()); };
function Card(props) { return <Badge text={a(props)} />; }
module.exports.other = function (x) { return c(x); };
const handlers = { get: (r) => r, put() {} };
`);
    expect(names(p, 'function')).toEqual(expect.arrayContaining(['list', 'Card', 'other', 'get']));
    expect(p.imports.map((i) => i.spec)).toEqual(['./svc', './ab']);
    expect(p.imports[0].names).toEqual([['*', 'svc']]);
    expect(p.imports[1].names).toEqual([['a', 'a'], ['b', 'c']]);
    expect(calls(p)).toEqual(expect.arrayContaining(['svc.all', 'res.json', 'Badge', 'a', 'c']));
    expect(names(p)).not.toContain('svc');
  });

  it('Python', async () => {
    const p = await parse('pkg/a.py', `import os.path
import numpy as np
from .models import User, Order as O
from pkg.sub import *

class Repo(Base):
    def find(self, id):
        if id and id > 0:
            for r in self.rows:
                if r.id == id:
                    return r
        elif id == 0:
            return None
        return [x for x in self.rows if x]

def main():
    repo = Repo()
    return repo.find(1) or helper()
`);
    expect(names(p)).toEqual(['Repo', 'Repo.find', 'main']);
    expect(def(p, 'find').kind).toBe('method');
    expect(def(p, 'find').complexity).toBe(8); // 1 + if + and + for + if + elif + comprehension for + comprehension if
    expect(def(p, 'find').nesting).toBe(3);
    expect(p.imports.map((i) => i.spec)).toEqual(['os.path', 'numpy', '.models', 'pkg.sub']);
    expect(p.imports[2].names).toEqual([['User', 'User'], ['Order', 'O']]);
    expect(p.imports[3].names).toEqual([['*', '*']]);
    expect(calls(p)).toEqual(expect.arrayContaining(['Repo', 'repo.find', 'helper']));
  });

  it('Java', async () => {
    const p = await parse('A.java', `package com.acme.shop;
import com.acme.shop.model.Order;
import java.util.*;
public class OrderService {
    private final OrderRepository repo;
    public OrderService(OrderRepository repo) { this.repo = repo; }
    public Order place(String email, int qty) {
        if (qty <= 0 || email == null) { throw new IllegalArgumentException("bad"); }
        for (int i = 0; i < qty; i++) { audit(i); }
        try { return repo.save(new Order()); } catch (Exception e) { return null; }
    }
    private void audit(int i) {}
}
interface Marker {}
enum Kind { A, B }
`);
    expect(names(p)).toEqual(['OrderService', 'OrderService.OrderService', 'OrderService.place', 'OrderService.audit', 'Marker', 'Kind']);
    expect(p.pkg).toBe('com.acme.shop');
    expect(p.imports.map((i) => i.spec)).toEqual(['com.acme.shop.model.Order', 'java.util.*']);
    expect(def(p, 'place').complexity).toBe(5);
    expect(def(p, 'place').exported).toBe(true);
    expect(def(p, 'audit').exported).toBeUndefined();
    expect(calls(p)).toEqual(expect.arrayContaining(['audit', 'repo.save', 'Order', 'IllegalArgumentException']));
    expect(p.typeRefs).toEqual(expect.arrayContaining(['OrderRepository', 'Order', 'String']));
  });

  it('Go', async () => {
    const p = await parse('a.go', `package handlers

import (
	"fmt"
	db "example.com/app/internal/store"
)

type Server struct{ store *db.Store }
type Handler interface{ Serve() }

func (s *Server) Get(id int) (string, error) {
	if id < 0 {
		return "", fmt.Errorf("bad")
	}
	switch id {
	case 1:
		return s.store.Find(id), nil
	}
	return helper(id), nil
}

func helper(id int) string { return "" }
`);
    expect(names(p)).toEqual(['Server', 'Handler', 'Server.Get', 'helper']);
    expect(def(p, 'Server').kind).toBe('struct');
    expect(def(p, 'Handler').kind).toBe('interface');
    expect(def(p, 'Get').exported).toBe(true);
    expect(def(p, 'Get').complexity).toBe(3);
    expect(p.pkg).toBe('handlers');
    expect(p.imports.map((i) => [i.spec, i.names![0][1]])).toEqual([['fmt', 'fmt'], ['example.com/app/internal/store', 'db']]);
    expect(calls(p)).toEqual(expect.arrayContaining(['fmt.Errorf', 's.store.Find', 'helper']));
  });

  it('C and C++', async () => {
    const c = await parse('a.c', `#include <stdio.h>
#include "util.h"
struct point { int x; int y; };
typedef struct point point_t;
static int add(int a, int b) { return a + b; }
int main(int argc, char **argv) {
    if (argc > 1 && argv[1]) { printf("%d", add(1, 2)); }
    while (argc--) { util_log(argc); }
    return 0;
}
`);
    expect(names(c)).toEqual(expect.arrayContaining(['point', 'point_t', 'add', 'main']));
    expect(c.imports.map((i) => i.spec)).toEqual(['<stdio.h>', 'util.h']);
    expect(def(c, 'main').complexity).toBe(4);
    expect(def(c, 'add').exported).toBeUndefined();
    expect(calls(c)).toEqual(expect.arrayContaining(['printf', 'add', 'util_log']));
    const cpp = await parse('a.cpp', `#include "shape.hpp"
namespace geo {
class Circle : public Shape {
 public:
  double area() const { return 3.14 * r * r; }
  void grow(double by);
 private:
  double r;
};
void Circle::grow(double by) { if (by > 0) { r += by; } log::info("grew"); }
}
`);
    expect(names(cpp)).toEqual(expect.arrayContaining(['geo', 'Circle', 'Circle.area', 'Circle.grow']));
    expect(calls(cpp)).toContain('log.info');
  });

  it('C#', async () => {
    const p = await parse('A.cs', `using System;
using Acme.Shop.Data;
namespace Acme.Shop.Services {
  public class OrderService : IOrderService {
    private readonly OrderRepository _repo;
    public OrderService(OrderRepository repo) { _repo = repo; }
    public async Task<Order> Place(string email, int qty) {
      if (qty <= 0 || email == null) throw new ArgumentException("bad");
      foreach (var i in Enumerable.Range(0, qty)) { Audit(i); }
      return await _repo.SaveAsync(new Order());
    }
    private void Audit(int i) {}
  }
  public interface IOrderService {}
}
`);
    expect(names(p)).toEqual(['OrderService', 'OrderService.OrderService', 'OrderService.Place', 'OrderService.Audit', 'IOrderService']);
    expect(p.pkg).toBe('Acme.Shop.Services');
    expect(p.imports.map((i) => i.spec)).toEqual(['System', 'Acme.Shop.Data']);
    expect(def(p, 'Place').complexity).toBe(4);
    expect(calls(p)).toEqual(expect.arrayContaining(['Audit', '_repo.SaveAsync', 'Order', 'Enumerable.Range']));
    expect(p.typeRefs).toEqual(expect.arrayContaining(['OrderRepository']));
  });

  it('PHP', async () => {
    const p = await parse('a.php', `<?php
namespace App\\Http\\Controllers;
use App\\Models\\User;
use App\\Services\\Mailer as Mail;
require_once __DIR__ . '/../lib/helpers.php';
include 'partials/header.php';
include $dynamic;
class UserController extends Controller {
    public function show($id) {
        $user = User::find($id);
        if (!$user || $user->banned) { return abort(404); }
        foreach ($user->posts as $p) { $this->track($p); }
        return (new Mail())->send($user);
    }
    private function track($p) {}
}
function helper($x) { return $x ? strtoupper($x) : ''; }
`);
    expect(names(p)).toEqual(['UserController', 'UserController.show', 'UserController.track', 'helper']);
    expect(p.pkg).toBe('App\\Http\\Controllers');
    expect(p.imports.map((i) => [i.spec, i.kind])).toEqual([['App\\Models\\User', 'static'], ['App\\Services\\Mailer', 'static'], ['./../lib/helpers.php', 'include'], ['partials/header.php', 'include']]);
    expect(p.imports[1].names).toEqual([['Mailer', 'Mail']]);
    expect(def(p, 'show').complexity).toBe(4);
    expect(calls(p)).toEqual(expect.arrayContaining(['User.find', 'abort', '$this.track', 'Mail', 'strtoupper']));
  });

  it('Ruby', async () => {
    const p = await parse('a.rb', `require 'json'
require_relative 'lib/helper'
module Billing
  class Invoice < ApplicationRecord
    def total(lines)
      return 0 if lines.empty?
      lines.each do |l|
        if l.qty > 0 && l.price
          add(l)
        end
      end
      Formatter.new.render(self)
    end

    def self.build(attrs)
      new(attrs)
    end
  end
end
`);
    expect(names(p)).toEqual(['Billing', 'Invoice', 'Invoice.total', 'Invoice.build']);
    expect(p.imports.map((i) => i.spec)).toEqual(['json', './lib/helper']);
    expect(def(p, 'total').complexity).toBe(4);
    expect(calls(p)).toEqual(expect.arrayContaining(['add', 'Formatter', 'lines.each']));
    expect(p.typeRefs).toEqual(expect.arrayContaining(['ApplicationRecord', 'Formatter']));
  });

  it('Rust', async () => {
    const p = await parse('src/a.rs', `use crate::store::{Store, Item};
use std::collections::HashMap;
mod util;
pub struct Cart { items: Vec<Item> }
pub trait Priced { fn price(&self) -> u32; }
impl Cart {
    pub fn total(&self, store: &Store) -> u32 {
        let mut sum = 0;
        for i in &self.items {
            if i.qty > 0 && i.active { sum += store.price_of(i); }
        }
        match sum { 0 => util::zero(), _ => sum }
    }
}
fn main() { let c = Cart::new(); let t = c.total(&Store::default()); println!("{}", t); }
`);
    expect(names(p)).toEqual(['util', 'Cart', 'Priced', 'Cart.total', 'main']);
    expect(def(p, 'total').kind).toBe('method');
    expect(def(p, 'total').exported).toBe(true);
    expect(def(p, 'total').complexity).toBe(6);
    expect(p.imports.map((i) => i.spec)).toEqual(['crate::store::Store', 'crate::store::Item', 'std::collections::HashMap', 'mod util']);
    expect(calls(p)).toEqual(expect.arrayContaining(['store.price_of', 'util.zero', 'Cart', 'c.total']));
  });

  it('Kotlin', async () => {
    const p = await parse('A.kt', `package com.acme.app
import com.acme.app.data.UserRepository
import kotlinx.coroutines.*
class UserService(private val repo: UserRepository) {
    fun find(id: Long): User? {
        if (id <= 0 || id > 999) return null
        val user = repo.findById(id) ?: return null
        when (user.role) { "admin" -> audit(user) else -> {} }
        return user
    }
    private fun audit(u: User) {}
}
interface Marker
fun main() { val s = UserService(UserRepository()); s.find(1) }
`);
    expect(names(p)).toEqual(['UserService', 'UserService.find', 'UserService.audit', 'Marker', 'main']);
    expect(def(p, 'Marker').kind).toBe('interface');
    expect(p.pkg).toBe('com.acme.app');
    expect(p.imports.map((i) => i.spec)).toEqual(['com.acme.app.data.UserRepository', 'kotlinx.coroutines.*']);
    expect(def(p, 'find').complexity).toBe(6);
    expect(calls(p)).toEqual(expect.arrayContaining(['repo.findById', 'audit', 'UserService', 's.find']));
  });

  it('SQL (statement-level)', async () => {
    const p = await parse('schema.sql', `CREATE TABLE users (id INT PRIMARY KEY);\nCREATE OR REPLACE VIEW active_users AS SELECT * FROM users;\nCREATE INDEX i ON users(id);\n`);
    expect(p.defs.map((d) => [d.name, d.kind])).toEqual([['users', 'table'], ['active_users', 'view']]);
  });

  it('degrades on unknown languages, syntax errors and timeouts', async () => {
    expect(await parseL1({ path: 'a.xyz', text: 'whatever', lang: 'other', hash: '', size: 8 }, DEFAULT_OPTIONS)).toBeNull();
    const broken = await parse('broken.ts', 'export function ok() { return 1; }\nfunction ( {{{ <<<\nexport function alsoOk() {}\n');
    expect(names(broken)).toContain('ok');
    const huge = 'function f() {' + ' if (a) { b(); }'.repeat(200_000) + '}';
    const r = await parseL1({ path: 'huge.js', text: huge, lang: 'javascript', hash: '', size: huge.length }, { ...DEFAULT_OPTIONS, parseTimeoutMs: 1 });
    expect(r?.timedOut).toBe(true);
    expect(r?.error).toMatch(/limit/);
  });
});
