import { describe, expect, it } from 'vitest';
import { modelOf } from '../../src/core/model';
import { nodeEnv } from '../../src/core/node-env';
import type { Analysis } from '../../src/core/types';
import { analyzeFixture, analyzeMem, groundTruth } from '../helpers';
import { internalEdges } from './m2-l2.test';

function gtEdges(gt: any): string[] {
  const p = gt.importPrefix ?? '';
  return gt.imports.map(([f, t]: [string, string]) => `${p}${f} -> ${p}${t}`);
}
function hasCall(a: Analysis, fromFile: string, fromName: string, toFile: string, toName: string): boolean {
  const m = modelOf(a);
  return a.refs.some((r) => r.from >= 0 && m.path(a.symbols[r.from].file) === fromFile && a.symbols[r.from].name === fromName && m.path(a.symbols[r.to].file) === toFile && a.symbols[r.to].name === toName);
}

describe('L1 graph (heuristic) on non-TS fixtures', () => {
  for (const name of ['django-app', 'spring-boot', 'legacy-php'] as const) {
    it(`${name}: finds every ground-truth import edge, labelled heuristic`, async () => {
      const gt = groundTruth(name);
      const { analysis: a } = await analyzeFixture(name);
      const found = internalEdges(a);
      for (const e of gtEdges(gt)) expect(found, e).toContain(e);
      for (const e of a.imports) expect(e.conf).not.toBe('resolved');
      for (const r of a.refs) expect(r.conf).toBe('heuristic');
      expect(a.coverage.l1Files).toBeGreaterThan(0);
      expect(a.coverage.l2Files).toBe(0);
    });
  }

  it('django: resolves module-alias calls', async () => {
    const { analysis: a } = await analyzeFixture('django-app');
    expect(hasCall(a, 'catalog/views.py', 'product_detail', 'catalog/services.py', 'get_product')).toBe(true);
    expect(hasCall(a, 'catalog/services.py', 'popularity', 'orders/services.py', 'count_orders_for_product')).toBe(true);
    expect(hasCall(a, 'orders/services.py', 'place_order', 'catalog/services.py', 'reserve_stock')).toBe(true);
    expect(hasCall(a, 'orders/services.py', 'place_order', 'orders/services.py', 'request_shipping_label')).toBe(true);
  });

  it('spring: resolves calls through injected fields by naming convention', async () => {
    const { analysis: a } = await analyzeFixture('spring-boot');
    const J = 'src/main/java/com/acme/shop/';
    expect(hasCall(a, J + 'controller/OrderController.java', 'place', J + 'service/OrderService.java', 'placeOrder')).toBe(true);
    expect(hasCall(a, J + 'service/OrderService.java', 'placeOrder', J + 'client/InventoryClient.java', 'isAvailable')).toBe(true);
    expect(hasCall(a, J + 'service/OrderService.java', 'placeOrder', J + 'service/ProductService.java', 'reserve')).toBe(true);
    expect(hasCall(a, J + 'service/OrderService.java', 'placeOrder', J + 'messaging/OrderEventPublisher.java', 'orderPlaced')).toBe(true);
    expect(hasCall(a, J + 'service/ProductService.java', 'reserve', J + 'service/ProductService.java', 'getBySku')).toBe(true);
  });

  it('php: resolves global function calls and records the dynamic include as unresolved', async () => {
    const gt = groundTruth('legacy-php');
    const { analysis: a, units } = await analyzeFixture('legacy-php');
    expect(hasCall(a, 'lib/Report.php', 'render', 'includes/functions.php', 'format_money')).toBe(true);
    expect(hasCall(a, 'includes/functions.php', 'get_user', 'includes/db.php', 'db_query')).toBe(true);
    expect(hasCall(a, 'includes/functions.php', 'monthly_report', 'lib/Report.php', 'render')).toBe(true);
    for (const u of gt.unresolved) {
      const text = units.find((x) => x.path === u.file)!.text.split('\n');
      expect(a.unresolved.some((x) => x.file === u.file && text[x.line - 1].includes(u.contains)), u.contains).toBe(true);
    }
  });

  it('resolves imports for Go, Rust, C, C#, Ruby and Kotlin mini-projects', async () => {
    const { analysis: a } = await analyzeMem({
      'go.mod': 'module example.com/app\n\ngo 1.22\n',
      'cmd/main.go': 'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/internal/store"\n)\n\nfunc main() { fmt.Println(store.Find(1)) }\n',
      'internal/store/store.go': 'package store\n\nfunc Find(id int) string { return helper(id) }\n',
      'internal/store/util.go': 'package store\n\nfunc helper(id int) string { return "" }\n',
      'rs/src/main.rs': 'mod cart;\nuse crate::cart::Cart;\nfn main() { let c = Cart::new(); c.total(); }\n',
      'rs/src/cart.rs': 'use crate::pricing::rules::discount;\npub struct Cart;\nimpl Cart { pub fn new() -> Cart { Cart }\n pub fn total(&self) -> u32 { discount(1) } }\n',
      'rs/src/pricing/mod.rs': 'pub mod rules;\n',
      'rs/src/pricing/rules.rs': 'pub fn discount(x: u32) -> u32 { x }\n',
      'c/main.c': '#include <stdio.h>\n#include "util/log.h"\nint main(void) { log_msg("x"); return 0; }\n',
      'c/util/log.h': 'void log_msg(const char *m);\n',
      'c/util/log.c': '#include "log.h"\nvoid log_msg(const char *m) { }\n',
      'cs/Program.cs': 'using Acme.Services;\nnamespace Acme { class Program { static void Main() { var s = new OrderService(); s.Place(); } } }\n',
      'cs/Services/OrderService.cs': 'using Acme.Data;\nnamespace Acme.Services { public class OrderService { private OrderRepo repo; public void Place() { repo.Save(); } } }\n',
      'cs/Data/OrderRepo.cs': 'namespace Acme.Data { public class OrderRepo { public void Save() {} } }\n',
      'rb/app/controllers/users_controller.rb': 'class UsersController < ApplicationController\n  def show\n    UserFinder.new.call(1)\n  end\nend\n',
      'rb/app/services/user_finder.rb': "require_relative '../models/user'\nclass UserFinder\n  def call(id)\n    User.find(id)\n  end\nend\n",
      'rb/app/models/user.rb': 'class User < ApplicationRecord\nend\n',
      'kt/src/App.kt': 'package com.acme\nimport com.acme.data.Repo\nfun main() { Repo().load() }\n',
      'kt/src/data/Repo.kt': 'package com.acme.data\nclass Repo { fun load() {} }\n',
    }, 'poly', {});
    const found = internalEdges(a);
    for (const e of [
      'cmd/main.go -> internal/store/store.go',
      'rs/src/main.rs -> rs/src/cart.rs', 'rs/src/cart.rs -> rs/src/pricing/rules.rs', 'rs/src/pricing/mod.rs -> rs/src/pricing/rules.rs',
      'c/main.c -> c/util/log.h', 'c/util/log.c -> c/util/log.h',
      'cs/Program.cs -> cs/Services/OrderService.cs', 'cs/Services/OrderService.cs -> cs/Data/OrderRepo.cs',
      'rb/app/controllers/users_controller.rb -> rb/app/services/user_finder.rb', 'rb/app/services/user_finder.rb -> rb/app/models/user.rb',
      'kt/src/App.kt -> kt/src/data/Repo.kt',
    ]) expect(found, e).toContain(e);
    expect(hasCall(a, 'cmd/main.go', 'main', 'internal/store/store.go', 'Find')).toBe(true);
    expect(hasCall(a, 'internal/store/store.go', 'Find', 'internal/store/util.go', 'helper')).toBe(true);
    expect(hasCall(a, 'rs/src/cart.rs', 'total', 'rs/src/pricing/rules.rs', 'discount')).toBe(true);
    expect(hasCall(a, 'cs/Services/OrderService.cs', 'Place', 'cs/Data/OrderRepo.cs', 'Save')).toBe(true);
    expect(hasCall(a, 'kt/src/App.kt', 'main', 'kt/src/data/Repo.kt', 'load')).toBe(true);
    const pkgs = new Set(a.imports.filter((e) => e.pkg).map((e) => e.pkg));
    expect(pkgs).toContain('go:fmt');
    expect(pkgs).toContain('c:stdio.h');
  });
});

describe('L1 alone on TypeScript/JavaScript fixtures (L2 disabled)', () => {
  for (const name of ['express-mongoose', 'nestjs-prisma', 'monorepo'] as const) {
    it(`${name}: L1 recovers the ground-truth import graph`, async () => {
      const gt = groundTruth(name);
      const { analysis: a } = await analyzeFixture(name, {}, nodeEnv({ l2: false }));
      const found = internalEdges(a);
      for (const e of gtEdges(gt)) expect(found, e).toContain(e);
      expect(a.coverage.l2Files).toBe(0);
      expect(a.imports.every((e) => e.conf !== 'resolved')).toBe(true);
    });
  }
});
