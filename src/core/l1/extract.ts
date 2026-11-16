// L1: language-generic extraction from tree-sitter syntax trees.
// One walker, one small spec per language. Everything found here is "heuristic".
import type Parser from 'web-tree-sitter';
import type { FileParse, RawCall, RawDef, RawImport, SymbolKind } from '../types';

type Node = Parser.SyntaxNode;

interface DefHit {
  name: string;
  kind: SymbolKind;
  parent?: string;
  /** Node whose extent is the definition (defaults to the matched node). */
  span?: Node;
  exported?: boolean;
  params?: number;
}

interface Spec {
  /** node type -> definition extractor (return null to ignore). */
  defs: Record<string, (n: Node) => DefHit | null>;
  /** node types that open a class-like scope: returns the scope name. */
  scopes?: Record<string, (n: Node) => string | null>;
  calls: Record<string, (n: Node) => { name: string; recv?: string; isNew?: boolean } | null>;
  imports: Record<string, (n: Node, out: RawImport[]) => void>;
  branch: Set<string>;
  /** binary node type whose `operator` child may be a short-circuit operator. */
  binary?: string;
  boolOps?: Set<string>;
  nest: Set<string>;
  pkg?: Record<string, (n: Node) => string | null>;
  typeRefs?: Set<string>;
}

const txt = (n: Node | null | undefined, max = 80): string => (n ? (n.text.length > max ? n.text.slice(0, max) : n.text) : '');
const field = (n: Node, name: string): Node | null => n.childForFieldName(name);
const unq = (s: string): string => s.replace(/^[rbfu]*("""|'''|["'`])/i, '').replace(/("""|'''|["'`])$/, '');
const named = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.namedChildCount; i++) if (n.namedChild(i)!.type === type) return n.namedChild(i);
  return null;
};
const nameDef = (kind: SymbolKind) => (n: Node): DefHit | null => {
  const name = txt(field(n, 'name'));
  return name ? { name, kind, params: field(n, 'parameters')?.namedChildCount } : null;
};
const row = (n: Node) => n.startPosition.row + 1;
const BOOL = new Set(['&&', '||', '??', 'and', 'or']);

// ---------------- JavaScript / TypeScript ----------------
function jsFnValue(n: Node | null): Node | null {
  return n && (n.type === 'arrow_function' || n.type === 'function_expression' || n.type === 'function' || n.type === 'generator_function') ? n : null;
}
function jsExported(n: Node): boolean {
  const p = n.parent;
  return !!p && (p.type === 'export_statement' || p.parent?.type === 'export_statement');
}
function jsRequireNames(call: Node): [string, string][] | undefined {
  const decl = call.parent;
  if (decl?.type !== 'variable_declarator') return undefined;
  const name = field(decl, 'name');
  if (!name) return undefined;
  if (name.type === 'identifier') return [['*', name.text]];
  if (name.type === 'object_pattern') {
    const out: [string, string][] = [];
    for (let i = 0; i < name.namedChildCount; i++) {
      const c = name.namedChild(i)!;
      if (c.type === 'shorthand_property_identifier_pattern') out.push([c.text, c.text]);
      else if (c.type === 'pair_pattern') out.push([txt(field(c, 'key')), txt(field(c, 'value'))]);
    }
    return out;
  }
  return undefined;
}
const JS: Spec = {
  defs: {
    function_declaration: (n) => ({ ...nameDef('function')(n)!, exported: jsExported(n) }),
    generator_function_declaration: (n) => ({ ...nameDef('function')(n)!, exported: jsExported(n) }),
    method_definition: nameDef('method'),
    class_declaration: (n) => ({ ...nameDef('class')(n)!, exported: jsExported(n) }),
    abstract_class_declaration: (n) => ({ ...nameDef('class')(n)!, exported: jsExported(n) }),
    interface_declaration: (n) => ({ ...nameDef('interface')(n)!, exported: jsExported(n) }),
    type_alias_declaration: (n) => ({ ...nameDef('type')(n)!, exported: jsExported(n) }),
    enum_declaration: (n) => ({ ...nameDef('enum')(n)!, exported: jsExported(n) }),
    variable_declarator: (n) => {
      const name = field(n, 'name');
      if (name?.type !== 'identifier') return null;
      const value = field(n, 'value');
      const stmt = n.parent;
      const top = !!stmt && (stmt.parent?.type === 'program' || stmt.parent?.type === 'export_statement');
      const fn = jsFnValue(value);
      if (fn) return { name: name.text, kind: 'function', span: top ? stmt! : n, exported: !!stmt && jsExported(stmt), params: field(fn, 'parameters')?.namedChildCount ?? (field(fn, 'parameter') ? 1 : 0) };
      if (top && !(value?.type === 'call_expression' && txt(field(value, 'function')) === 'require')) return { name: name.text, kind: 'variable', span: stmt!, exported: jsExported(stmt!) };
      return null;
    },
    pair: (n) => {
      const fn = jsFnValue(field(n, 'value'));
      const key = field(n, 'key');
      return fn && key && (key.type === 'property_identifier' || key.type === 'string') ? { name: unq(key.text), kind: 'function', params: field(fn, 'parameters')?.namedChildCount } : null;
    },
    public_field_definition: (n) => {
      const fn = jsFnValue(field(n, 'value'));
      return fn ? { name: txt(field(n, 'name')), kind: 'method', params: field(fn, 'parameters')?.namedChildCount } : null;
    },
    field_definition: (n) => {
      const fn = jsFnValue(field(n, 'value'));
      return fn ? { name: txt(field(n, 'property')), kind: 'method', params: field(fn, 'parameters')?.namedChildCount } : null;
    },
    assignment_expression: (n) => {
      const left = field(n, 'left');
      const fn = jsFnValue(field(n, 'right'));
      if (!fn || left?.type !== 'member_expression') return null;
      const obj = txt(field(left, 'object'));
      if (obj !== 'exports' && obj !== 'module.exports' && !obj.endsWith('.prototype')) return null;
      return { name: txt(field(left, 'property')), kind: 'function', exported: !obj.endsWith('.prototype'), parent: obj.endsWith('.prototype') ? obj.replace(/\.prototype$/, '') : undefined, params: field(fn, 'parameters')?.namedChildCount };
    },
  },
  scopes: {
    class_declaration: (n) => txt(field(n, 'name')),
    abstract_class_declaration: (n) => txt(field(n, 'name')),
    class: (n) => txt(field(n, 'name')) || null,
  },
  calls: {
    call_expression: (n) => {
      const f = field(n, 'function');
      if (!f) return null;
      if (f.type === 'identifier') return f.text === 'require' ? null : { name: f.text };
      if (f.type === 'member_expression') return { name: txt(field(f, 'property')), recv: txt(field(f, 'object'), 60) };
      return null;
    },
    new_expression: (n) => {
      const c = field(n, 'constructor');
      if (!c) return null;
      if (c.type === 'identifier') return { name: c.text, isNew: true };
      if (c.type === 'member_expression') return { name: txt(field(c, 'property')), recv: txt(field(c, 'object'), 60), isNew: true };
      return null;
    },
    jsx_opening_element: (n) => {
      const name = txt(field(n, 'name'));
      return /^[A-Z]/.test(name) ? { name: name.split('.').pop()!, recv: name.includes('.') ? name.split('.')[0] : undefined } : null;
    },
    jsx_self_closing_element: (n) => {
      const name = txt(field(n, 'name'));
      return /^[A-Z]/.test(name) ? { name: name.split('.').pop()!, recv: name.includes('.') ? name.split('.')[0] : undefined } : null;
    },
  },
  imports: {
    import_statement: (n, out) => {
      const src = field(n, 'source');
      if (!src) return;
      const names: [string, string][] = [];
      const clause = named(n, 'import_clause');
      if (clause) {
        for (let i = 0; i < clause.namedChildCount; i++) {
          const c = clause.namedChild(i)!;
          if (c.type === 'identifier') names.push(['default', c.text]);
          else if (c.type === 'namespace_import') names.push(['*', txt(c.namedChild(0))]);
          else if (c.type === 'named_imports') {
            for (let k = 0; k < c.namedChildCount; k++) {
              const s = c.namedChild(k)!;
              if (s.type === 'import_specifier') names.push([txt(field(s, 'name')), txt(field(s, 'alias') ?? field(s, 'name'))]);
            }
          }
        }
      }
      out.push({ spec: unq(src.text), line: row(n), kind: 'static', names, typeOnly: /^import\s+type\b/.test(n.text.slice(0, 14)) || undefined });
    },
    export_statement: (n, out) => {
      const src = field(n, 'source');
      if (src) out.push({ spec: unq(src.text), line: row(n), kind: 'reexport', names: [['*', '*']] });
    },
    call_expression: (n, out) => {
      const f = field(n, 'function');
      const args = field(n, 'arguments');
      const a0 = args?.namedChild(0);
      if (!f || !a0 || a0.type !== 'string') return;
      if (f.type === 'identifier' && f.text === 'require' && args!.namedChildCount === 1) out.push({ spec: unq(a0.text), line: row(n), kind: 'require', names: jsRequireNames(n) });
      else if (f.type === 'import') out.push({ spec: unq(a0.text), line: row(n), kind: 'dynamic' });
    },
  },
  branch: new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'catch_clause', 'ternary_expression', 'switch_case']),
  binary: 'binary_expression',
  nest: new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'try_statement']),
};

// ---------------- Python ----------------
const PY: Spec = {
  defs: {
    function_definition: (n) => ({ ...nameDef('function')(n)!, exported: !txt(field(n, 'name')).startsWith('_') }),
    class_definition: (n) => ({ ...nameDef('class')(n)!, exported: true }),
  },
  scopes: { class_definition: (n) => txt(field(n, 'name')) },
  calls: {
    call: (n) => {
      const f = field(n, 'function');
      if (f?.type === 'identifier') return { name: f.text };
      if (f?.type === 'attribute') return { name: txt(field(f, 'attribute')), recv: txt(field(f, 'object'), 60) };
      return null;
    },
  },
  imports: {
    import_statement: (n, out) => {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)!;
        if (c.type === 'dotted_name') out.push({ spec: c.text, line: row(n), kind: 'static', names: [['*', c.text.split('.')[0]]] });
        else if (c.type === 'aliased_import') out.push({ spec: txt(field(c, 'name')), line: row(n), kind: 'static', names: [['*', txt(field(c, 'alias'))]] });
      }
    },
    import_from_statement: (n, out) => {
      const mod = field(n, 'module_name');
      if (!mod) return;
      const names: [string, string][] = [];
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)!;
        if (c.id === mod.id) continue;
        if (c.type === 'dotted_name') names.push([c.text, c.text]);
        else if (c.type === 'aliased_import') names.push([txt(field(c, 'name')), txt(field(c, 'alias'))]);
        else if (c.type === 'wildcard_import') names.push(['*', '*']);
      }
      out.push({ spec: mod.text, line: row(n), kind: 'static', names });
    },
  },
  branch: new Set(['if_statement', 'elif_clause', 'for_statement', 'while_statement', 'except_clause', 'conditional_expression', 'boolean_operator', 'for_in_clause', 'if_clause', 'case_clause']),
  nest: new Set(['if_statement', 'for_statement', 'while_statement', 'try_statement', 'match_statement']),
};

// ---------------- Java ----------------
const javaPublic = (n: Node) => /\bpublic\b/.test(txt(named(n, 'modifiers'), 200));
const JAVA: Spec = {
  defs: {
    method_declaration: (n) => ({ ...nameDef('method')(n)!, exported: javaPublic(n) }),
    constructor_declaration: (n) => ({ ...nameDef('method')(n)!, exported: javaPublic(n) }),
    class_declaration: (n) => ({ ...nameDef('class')(n)!, exported: javaPublic(n) }),
    interface_declaration: (n) => ({ ...nameDef('interface')(n)!, exported: javaPublic(n) }),
    enum_declaration: (n) => ({ ...nameDef('enum')(n)!, exported: javaPublic(n) }),
    record_declaration: (n) => ({ ...nameDef('class')(n)!, exported: javaPublic(n) }),
    annotation_type_declaration: nameDef('interface'),
  },
  scopes: {
    class_declaration: (n) => txt(field(n, 'name')), interface_declaration: (n) => txt(field(n, 'name')),
    enum_declaration: (n) => txt(field(n, 'name')), record_declaration: (n) => txt(field(n, 'name')),
  },
  calls: {
    method_invocation: (n) => ({ name: txt(field(n, 'name')), recv: txt(field(n, 'object'), 60) || undefined }),
    object_creation_expression: (n) => ({ name: txt(field(n, 'type')).replace(/<.*$/, ''), isNew: true }),
  },
  imports: {
    import_declaration: (n, out) => {
      const id = named(n, 'scoped_identifier') ?? named(n, 'identifier');
      if (id) out.push({ spec: id.text + (named(n, 'asterisk') ? '.*' : ''), line: row(n), kind: 'static', names: [[id.text.split('.').pop()!, id.text.split('.').pop()!]] });
    },
  },
  pkg: { package_declaration: (n) => txt(named(n, 'scoped_identifier') ?? named(n, 'identifier'), 200) },
  typeRefs: new Set(['type_identifier']),
  branch: new Set(['if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement', 'catch_clause', 'ternary_expression', 'switch_label']),
  binary: 'binary_expression',
  nest: new Set(['if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement', 'switch_expression', 'switch_statement', 'try_statement', 'try_with_resources_statement']),
};

// ---------------- Go ----------------
const goExported = (name: string) => /^[A-Z]/.test(name);
const GO: Spec = {
  defs: {
    function_declaration: (n) => {
      const d = nameDef('function')(n);
      return d ? { ...d, exported: goExported(d.name) } : null;
    },
    method_declaration: (n) => {
      const d = nameDef('method')(n);
      if (!d) return null;
      const recv = txt(field(n, 'receiver'), 120).replace(/[()*]/g, ' ').trim().split(/\s+/).pop();
      return { ...d, parent: recv, exported: goExported(d.name) };
    },
    type_spec: (n) => {
      const name = txt(field(n, 'name'));
      const t = field(n, 'type')?.type;
      return name ? { name, kind: t === 'struct_type' ? 'struct' : t === 'interface_type' ? 'interface' : 'type', exported: goExported(name) } : null;
    },
  },
  calls: {
    call_expression: (n) => {
      const f = field(n, 'function');
      if (f?.type === 'identifier') return { name: f.text };
      if (f?.type === 'selector_expression') return { name: txt(field(f, 'field')), recv: txt(field(f, 'operand'), 60) };
      return null;
    },
  },
  imports: {
    import_spec: (n, out) => {
      const path = field(n, 'path');
      if (!path) return;
      const spec = unq(path.text);
      const alias = txt(field(n, 'name')) || spec.split('/').pop()!;
      out.push({ spec, line: row(n), kind: 'static', names: [['*', alias]] });
    },
  },
  pkg: { package_clause: (n) => txt(named(n, 'package_identifier')) },
  branch: new Set(['if_statement', 'for_statement', 'expression_case', 'type_case', 'communication_case']),
  binary: 'binary_expression',
  nest: new Set(['if_statement', 'for_statement', 'expression_switch_statement', 'type_switch_statement', 'select_statement']),
};

// ---------------- C / C++ ----------------
function cDeclName(n: Node | null): { name: string; parent?: string } | null {
  let cur = n;
  for (let i = 0; cur && i < 8; i++) {
    switch (cur.type) {
      case 'identifier': case 'field_identifier': case 'type_identifier': case 'destructor_name': case 'operator_name':
        return { name: cur.text };
      case 'qualified_identifier': {
        const name = field(cur, 'name');
        const scope = field(cur, 'scope');
        const inner = cDeclName(name);
        return inner ? { name: inner.name, parent: inner.parent ?? (scope ? scope.text : undefined) } : null;
      }
      default:
        cur = field(cur, 'declarator') ?? cur.namedChild(0);
    }
  }
  return null;
}
const cTagged = (kind: SymbolKind) => (n: Node): DefHit | null => {
  const name = txt(field(n, 'name'));
  return name && field(n, 'body') ? { name, kind } : null;
};
const C: Spec = {
  defs: {
    function_definition: (n) => {
      const decl = field(n, 'declarator');
      const d = cDeclName(decl);
      if (!d) return null;
      let fd: Node | null = decl;
      while (fd && fd.type !== 'function_declarator') fd = field(fd, 'declarator');
      return { name: d.name, parent: d.parent, kind: d.parent ? 'method' : 'function', params: fd ? field(fd, 'parameters')?.namedChildCount : 0, exported: !/\bstatic\b/.test(n.text.slice(0, 40)) };
    },
    struct_specifier: cTagged('struct'),
    union_specifier: cTagged('struct'),
    enum_specifier: cTagged('enum'),
    class_specifier: cTagged('class'),
    namespace_definition: (n) => (txt(field(n, 'name')) ? { name: txt(field(n, 'name')), kind: 'module' } : null),
    type_definition: (n) => {
      const d = cDeclName(field(n, 'declarator'));
      return d ? { name: d.name, kind: 'type' } : null;
    },
  },
  scopes: {
    class_specifier: (n) => txt(field(n, 'name')) || null,
    struct_specifier: (n) => (field(n, 'body') ? txt(field(n, 'name')) || null : null),
  },
  calls: {
    call_expression: (n) => {
      const f = field(n, 'function');
      if (f?.type === 'identifier') return { name: f.text };
      if (f?.type === 'field_expression') return { name: txt(field(f, 'field')), recv: txt(field(f, 'argument'), 60) };
      if (f?.type === 'qualified_identifier') return { name: txt(field(f, 'name')), recv: txt(field(f, 'scope'), 60) };
      return null;
    },
    new_expression: (n) => ({ name: txt(field(n, 'type')), isNew: true }),
  },
  imports: {
    preproc_include: (n, out) => {
      const p = field(n, 'path');
      if (!p) return;
      const sys = p.type === 'system_lib_string';
      out.push({ spec: sys ? p.text : unq(p.text), line: row(n), kind: 'include' });
    },
  },
  branch: new Set(['if_statement', 'for_statement', 'while_statement', 'do_statement', 'case_statement', 'conditional_expression', 'catch_clause', 'for_range_loop']),
  binary: 'binary_expression',
  nest: new Set(['if_statement', 'for_statement', 'for_range_loop', 'while_statement', 'do_statement', 'switch_statement', 'try_statement']),
};

// ---------------- C# ----------------
const csPublic = (n: Node) => /\b(public|internal)\b/.test(n.text.slice(0, 120));
const csDef = (kind: SymbolKind) => (n: Node): DefHit | null => {
  const d = nameDef(kind)(n);
  return d ? { ...d, exported: csPublic(n) } : null;
};
const CS: Spec = {
  defs: {
    method_declaration: csDef('method'), constructor_declaration: csDef('method'), local_function_statement: nameDef('function'),
    class_declaration: csDef('class'), interface_declaration: csDef('interface'), struct_declaration: csDef('struct'),
    enum_declaration: csDef('enum'), record_declaration: csDef('class'),
  },
  scopes: {
    class_declaration: (n) => txt(field(n, 'name')), interface_declaration: (n) => txt(field(n, 'name')),
    struct_declaration: (n) => txt(field(n, 'name')), record_declaration: (n) => txt(field(n, 'name')),
  },
  calls: {
    invocation_expression: (n) => {
      const f = field(n, 'function');
      if (f?.type === 'identifier') return { name: f.text };
      if (f?.type === 'generic_name') return { name: txt(f.namedChild(0)) };
      if (f?.type === 'member_access_expression') return { name: txt(field(f, 'name')).replace(/<.*$/, ''), recv: txt(field(f, 'expression'), 60) };
      return null;
    },
    object_creation_expression: (n) => ({ name: txt(field(n, 'type')).replace(/<.*$/, '').split('.').pop()!, isNew: true }),
  },
  imports: {
    using_directive: (n, out) => {
      const id = named(n, 'qualified_name') ?? named(n, 'identifier');
      if (id && !/^using\s+static\b/.test(n.text)) out.push({ spec: id.text, line: row(n), kind: 'static' });
    },
  },
  pkg: {
    namespace_declaration: (n) => txt(field(n, 'name'), 200),
    file_scoped_namespace_declaration: (n) => txt(field(n, 'name'), 200),
  },
  typeRefs: new Set(['identifier']),
  branch: new Set(['if_statement', 'for_statement', 'for_each_statement', 'foreach_statement', 'while_statement', 'do_statement', 'catch_clause', 'conditional_expression', 'case_switch_label', 'switch_expression_arm']),
  binary: 'binary_expression',
  nest: new Set(['if_statement', 'for_statement', 'for_each_statement', 'foreach_statement', 'while_statement', 'do_statement', 'switch_statement', 'try_statement']),
};

// ---------------- PHP ----------------
function phpIncludeSpec(arg: Node | null): string | null {
  if (!arg) return null;
  if (arg.type === 'parenthesized_expression') return phpIncludeSpec(arg.namedChild(0));
  if (arg.type === 'string' || arg.type === 'encapsed_string') return /\$/.test(arg.text) ? null : unq(arg.text);
  if (arg.type === 'binary_expression') {
    // __DIR__ . '/../lib/x.php'  ->  keep the trailing literal as a path relative to the file
    const right = field(arg, 'right');
    const left = field(arg, 'left');
    if (right && (right.type === 'string' || right.type === 'encapsed_string') && !/\$/.test(right.text) && left && /^(__DIR__|dirname\s*\(\s*__FILE__\s*\))$/.test(left.text.trim())) return '.' + unq(right.text);
  }
  return null;
}
const phpInclude = (n: Node, out: RawImport[]) => {
  const spec = phpIncludeSpec(n.namedChild(0));
  if (spec) out.push({ spec, line: row(n), kind: 'include' });
};
const PHP: Spec = {
  defs: {
    function_definition: nameDef('function'),
    method_declaration: (n) => ({ ...nameDef('method')(n)!, exported: !/\b(private|protected)\b/.test(n.text.slice(0, 60)) }),
    class_declaration: nameDef('class'), interface_declaration: nameDef('interface'), trait_declaration: nameDef('trait'), enum_declaration: nameDef('enum'),
  },
  scopes: {
    class_declaration: (n) => txt(field(n, 'name')), interface_declaration: (n) => txt(field(n, 'name')), trait_declaration: (n) => txt(field(n, 'name')),
  },
  calls: {
    function_call_expression: (n) => {
      const f = field(n, 'function');
      return f && (f.type === 'name' || f.type === 'qualified_name') ? { name: f.text.split('\\').pop()! } : null;
    },
    member_call_expression: (n) => ({ name: txt(field(n, 'name')), recv: txt(field(n, 'object'), 60) }),
    nullsafe_member_call_expression: (n) => ({ name: txt(field(n, 'name')), recv: txt(field(n, 'object'), 60) }),
    scoped_call_expression: (n) => ({ name: txt(field(n, 'name')), recv: txt(field(n, 'scope'), 60) }),
    object_creation_expression: (n) => {
      const c = named(n, 'name') ?? named(n, 'qualified_name');
      return c ? { name: c.text.split('\\').pop()!, isNew: true } : null;
    },
  },
  imports: {
    namespace_use_clause: (n, out) => {
      const q = named(n, 'qualified_name') ?? named(n, 'name');
      if (!q) return;
      const alias = named(n, 'namespace_aliasing_clause');
      const last = q.text.split('\\').pop()!;
      out.push({ spec: q.text.replace(/^\\/, ''), line: row(n), kind: 'static', names: [[last, alias ? txt(alias.namedChild(0)) : last]] });
    },
    include_expression: phpInclude, include_once_expression: phpInclude, require_expression: phpInclude, require_once_expression: phpInclude,
  },
  pkg: { namespace_definition: (n) => txt(field(n, 'name'), 200) },
  typeRefs: new Set(['name']),
  branch: new Set(['if_statement', 'else_if_clause', 'for_statement', 'foreach_statement', 'while_statement', 'do_statement', 'catch_clause', 'conditional_expression', 'case_statement', 'match_conditional_expression']),
  binary: 'binary_expression',
  nest: new Set(['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'do_statement', 'switch_statement', 'try_statement']),
};

// ---------------- Ruby ----------------
const RUBY: Spec = {
  defs: {
    method: nameDef('method'),
    singleton_method: nameDef('method'),
    class: (n) => (txt(field(n, 'name')) ? { name: txt(field(n, 'name')).split('::').pop()!, kind: 'class' } : null),
    module: (n) => (txt(field(n, 'name')) ? { name: txt(field(n, 'name')).split('::').pop()!, kind: 'module' } : null),
  },
  scopes: { class: (n) => txt(field(n, 'name')).split('::').pop() || null, module: (n) => txt(field(n, 'name')).split('::').pop() || null },
  calls: {
    call: (n) => {
      const m = txt(field(n, 'method'));
      if (!m || m === 'require' || m === 'require_relative') return null;
      const recv = field(n, 'receiver');
      return { name: m === 'new' && recv ? recv.text.split('::').pop()! : m, recv: m === 'new' ? undefined : txt(recv, 60) || undefined, isNew: m === 'new' || undefined };
    },
  },
  imports: {
    call: (n, out) => {
      const m = txt(field(n, 'method'));
      if (m !== 'require' && m !== 'require_relative' && m !== 'load') return;
      const a = field(n, 'arguments')?.namedChild(0);
      if (a?.type === 'string' && !a.text.includes('#{')) out.push({ spec: (m === 'require_relative' ? './' : '') + unq(a.text), line: row(n), kind: m === 'require_relative' ? 'include' : 'require' });
    },
  },
  typeRefs: new Set(['constant']),
  branch: new Set(['if', 'elsif', 'unless', 'while', 'until', 'for', 'when', 'rescue', 'conditional', 'if_modifier', 'unless_modifier', 'while_modifier', 'until_modifier']),
  binary: 'binary',
  nest: new Set(['if', 'unless', 'while', 'until', 'for', 'case', 'begin']),
};

// ---------------- Rust ----------------
function expandUse(s: string): string[] {
  const m = /^(.*)\{([^{}]*)\}(.*)$/.exec(s);
  if (!m) return [s.replace(/\s+as\s+\w+$/, '').trim()];
  return m[2].split(',').map((p) => p.trim()).filter(Boolean).flatMap((p) => expandUse(m[1] + (p === 'self' ? '' : p) + m[3])).map((p) => p.replace(/::$/, ''));
}
const rustPub = (n: Node) => !!named(n, 'visibility_modifier');
const rustDef = (kind: SymbolKind) => (n: Node): DefHit | null => {
  const d = nameDef(kind)(n);
  return d ? { ...d, exported: rustPub(n) } : null;
};
const RUST: Spec = {
  defs: {
    function_item: rustDef('function'), struct_item: rustDef('struct'), enum_item: rustDef('enum'), trait_item: rustDef('trait'),
    type_item: rustDef('type'), mod_item: rustDef('module'),
  },
  scopes: {
    impl_item: (n) => txt(field(n, 'type')).replace(/<.*$/, '') || null,
    trait_item: (n) => txt(field(n, 'name')),
  },
  calls: {
    call_expression: (n) => {
      let f = field(n, 'function');
      if (f?.type === 'generic_function') f = field(f, 'function');
      if (f?.type === 'identifier') return { name: f.text };
      if (f?.type === 'scoped_identifier') {
        const name = txt(field(f, 'name'));
        const path = txt(field(f, 'path'), 60);
        return name === 'new' && path ? { name: path.split('::').pop()!, isNew: true } : { name, recv: path || undefined };
      }
      if (f?.type === 'field_expression') return { name: txt(field(f, 'field')), recv: txt(field(f, 'value'), 60) };
      return null;
    },
  },
  imports: {
    use_declaration: (n, out) => {
      const arg = field(n, 'argument');
      if (!arg) return;
      for (const spec of expandUse(arg.text.replace(/\s+/g, ' '))) {
        const last = spec.split('::').pop()!;
        out.push({ spec, line: row(n), kind: 'static', names: [[last, last]] });
      }
    },
    mod_item: (n, out) => {
      if (!field(n, 'body')) out.push({ spec: 'mod ' + txt(field(n, 'name')), line: row(n), kind: 'include' });
    },
  },
  branch: new Set(['if_expression', 'for_expression', 'while_expression', 'loop_expression', 'match_arm']),
  binary: 'binary_expression',
  nest: new Set(['if_expression', 'for_expression', 'while_expression', 'loop_expression', 'match_expression']),
};

// ---------------- Kotlin ----------------
const KOTLIN: Spec = {
  defs: {
    function_declaration: (n) => {
      const id = named(n, 'simple_identifier');
      return id ? { name: id.text, kind: 'function', params: named(n, 'function_value_parameters')?.namedChildCount, exported: !/\bprivate\b/.test(n.text.slice(0, 60)) } : null;
    },
    class_declaration: (n) => {
      const id = named(n, 'type_identifier');
      if (!id) return null;
      const head = n.text.slice(0, 80);
      return { name: id.text, kind: /\binterface\b/.test(head.split(id.text)[0]) ? 'interface' : /\benum\s+class\b/.test(head) ? 'enum' : 'class', exported: !/\bprivate\b/.test(head) };
    },
    object_declaration: (n) => {
      const id = named(n, 'type_identifier');
      return id ? { name: id.text, kind: 'class' } : null;
    },
  },
  scopes: {
    class_declaration: (n) => txt(named(n, 'type_identifier')) || null,
    object_declaration: (n) => txt(named(n, 'type_identifier')) || null,
  },
  calls: {
    call_expression: (n) => {
      const f = n.namedChild(0);
      if (f?.type === 'simple_identifier') return /^[A-Z]/.test(f.text) ? { name: f.text, isNew: true } : { name: f.text };
      if (f?.type === 'navigation_expression') {
        const suffix = f.namedChild(f.namedChildCount - 1);
        const id = suffix ? named(suffix, 'simple_identifier') : null;
        return id ? { name: id.text, recv: txt(f.namedChild(0), 60) } : null;
      }
      return null;
    },
  },
  imports: {
    import_header: (n, out) => {
      const id = named(n, 'identifier');
      if (!id) return;
      const last = id.text.split('.').pop()!;
      out.push({ spec: id.text + (n.text.includes('.*') ? '.*' : ''), line: row(n), kind: 'static', names: [[last, last]] });
    },
  },
  pkg: { package_header: (n) => txt(named(n, 'identifier'), 200) },
  typeRefs: new Set(['type_identifier']),
  branch: new Set(['if_expression', 'for_statement', 'while_statement', 'do_while_statement', 'when_entry', 'catch_block', 'conjunction_expression', 'disjunction_expression', 'elvis_expression']),
  nest: new Set(['if_expression', 'for_statement', 'while_statement', 'do_while_statement', 'when_expression', 'try_expression']),
};

export const SPECS: Record<string, Spec> = {
  typescript: JS, tsx: JS, javascript: JS, python: PY, java: JAVA, go: GO, c: C, cpp: C, c_sharp: CS, php: PHP, ruby: RUBY, rust: RUST, kotlin: KOTLIN,
};

/** web-tree-sitter exposes currentNode as a method in some versions and a getter in others. */
function currentNode(cursor: Parser.TreeCursor): Node {
  const cn = (cursor as unknown as { currentNode: Node | (() => Node) }).currentNode;
  return typeof cn === 'function' ? (cn as () => Node).call(cursor) : cn;
}

const ELSE_PARENTS = new Set(['else_clause', 'else', 'if_statement', 'if_expression']);

/** Walk a syntax tree and extract definitions, imports, call sites, complexity and nesting. */
export function extract(root: Node, grammar: string, deadline = Infinity): FileParse {
  const spec = SPECS[grammar];
  const out: FileParse = { defs: [], imports: [], calls: [] };
  if (!spec) return out;
  const typeRefs = spec.typeRefs ? new Set<string>() : null;
  const cursor = root.walk();
  const scopeStack: string[] = [];
  const defStack: number[] = [];
  let depth = 0;
  let guard = 0;

  const visit = (fnDepthBase: number): void => {
    if (++guard > 3_000_000) throw new Error('syntax tree too large');
    if ((guard & 4095) === 0 && Date.now() > deadline) throw new Error('extraction exceeded the time limit');
    const type = cursor.nodeType;
    let node: Node | null = null;
    const get = () => (node ??= currentNode(cursor));
    let pushedDef = false;
    let pushedScope = false;
    let savedDepth = -1;
    let base = fnDepthBase;

    // anonymous tokens can share a type name with named nodes (e.g. Ruby's `if` keyword)
    const isNamed = cursor.nodeIsNamed;
    const defFn = isNamed ? spec.defs[type] : undefined;
    if (defFn) {
      const hit = defFn(get());
      if (hit && hit.name) {
        const span = hit.span ?? get();
        const isFn = hit.kind === 'function' || hit.kind === 'method';
        const inScope = scopeStack.length ? scopeStack[scopeStack.length - 1] : undefined;
        const kind: SymbolKind = isFn && inScope && hit.kind === 'function' && (grammar === 'python' || grammar === 'rust' || grammar === 'kotlin') ? 'method' : hit.kind;
        out.defs.push({
          name: hit.name, kind, line: span.startPosition.row + 1, endLine: span.endPosition.row + 1,
          parent: hit.parent ?? (isFn ? inScope : undefined),
          complexity: isFn ? 1 : 0, nesting: 0, params: hit.params ?? 0, exported: hit.exported || undefined,
        });
        if (isFn) {
          defStack.push(out.defs.length - 1);
          pushedDef = true;
          savedDepth = depth;
          depth = 0;
          base = 0;
        }
      }
    }
    const scopeFn = isNamed ? spec.scopes?.[type] : undefined;
    if (scopeFn) {
      const s = scopeFn(get());
      if (s) {
        scopeStack.push(s);
        pushedScope = true;
      }
    }
    const callFn = isNamed ? spec.calls[type] : undefined;
    if (callFn) {
      const c = callFn(get());
      if (c && c.name) {
        const call: RawCall = { name: c.name, line: cursor.startPosition.row + 1, def: defStack.length ? defStack[defStack.length - 1] : -1 };
        if (c.recv) call.recv = c.recv;
        if (c.isNew) call.isNew = true;
        out.calls.push(call);
      }
    }
    const impFn = isNamed ? spec.imports[type] : undefined;
    if (impFn) impFn(get(), out.imports);
    const pkgFn = spec.pkg?.[type];
    if (pkgFn && !out.pkg) out.pkg = pkgFn(get()) ?? undefined;
    if (typeRefs && spec.typeRefs!.has(type) && typeRefs.size < 400) {
      const t = cursor.nodeText;
      if (t.length < 60 && /^[A-Z][A-Za-z0-9_]*$/.test(t)) typeRefs.add(t);
    }

    let nested = false;
    if (defStack.length && isNamed) {
      const def = out.defs[defStack[defStack.length - 1]];
      if (spec.branch.has(type)) def.complexity++;
      else if (spec.binary === type) {
        const op = get().childForFieldName('operator');
        if (op && BOOL.has(op.type)) def.complexity++;
      }
      if (spec.nest.has(type)) {
        const p = get().parent;
        const elseIf = (type === 'if_statement' || type === 'if_expression') && p && ELSE_PARENTS.has(p.type) && (p.type.startsWith('else') || p.childForFieldName('alternative')?.id === get().id);
        if (!elseIf) {
          depth++;
          nested = true;
          if (depth > def.nesting) def.nesting = depth;
        }
      }
    }

    if (cursor.gotoFirstChild()) {
      do visit(base);
      while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
    if (nested) depth--;
    if (pushedDef) {
      defStack.pop();
      depth = savedDepth;
    }
    if (pushedScope) scopeStack.pop();
  };

  visit(0);
  cursor.delete();
  if (typeRefs?.size) out.typeRefs = [...typeRefs];
  return out;
}

/** Statement-level SQL extraction (no tree-sitter grammar is bundled for SQL). */
export function extractSql(text: string): FileParse {
  const defs: RawDef[] = [];
  const re = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+|UNIQUE\s+|MATERIALIZED\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.]+[`"\]]?)/gi;
  let m: RegExpExecArray | null;
  const lineAt = (i: number) => {
    let l = 1;
    for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) l++;
    return l;
  };
  while ((m = re.exec(text))) {
    const kindWord = m[1].toUpperCase();
    if (kindWord === 'INDEX' || kindWord === 'TRIGGER') continue;
    const kind: SymbolKind = kindWord === 'TABLE' ? 'table' : kindWord === 'VIEW' ? 'view' : 'procedure';
    let end = text.indexOf(';', m.index);
    if (kind === 'procedure') {
      const e2 = /\bEND\b[^;]*;|\$\$\s*(?:LANGUAGE\s+\w+)?\s*;/gi;
      e2.lastIndex = m.index;
      const em = e2.exec(text);
      if (em) end = em.index + em[0].length;
    }
    if (end < 0) end = text.length;
    const body = text.slice(m.index, end);
    defs.push({
      name: m[2].replace(/[`"\[\]]/g, '').split('.').pop()!, kind, line: lineAt(m.index), endLine: lineAt(end),
      complexity: kind === 'procedure' ? 1 + (body.match(/\b(IF|WHEN|WHILE|LOOP|FOR)\b/gi)?.length ?? 0) : 0, nesting: 0, params: 0, exported: true,
    });
  }
  return { defs, imports: [], calls: [] };
}
