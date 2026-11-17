// L2: exact module graph + type-aware reference graph for TypeScript/JavaScript,
// using the TypeScript compiler API over an in-memory file system.
import ts from 'typescript';
import type { Confidence, RawDef, SymbolKind } from '../types';
import { ModuleResolver, packageOf, type ResolverConfig, type ResolverPackage } from '../resolve-js';

export interface L2Input {
  /** TS/JS source files to analyse. */
  files: { path: string; text: string }[];
  /** Every analysed project path (so imports of JSON/CSS/etc. can be matched). */
  allPaths: string[];
  /** tsconfig.json / jsconfig.json files. */
  configs: ResolverConfig[];
  /** Workspace packages: name -> directory and optional entry file. */
  packages: ResolverPackage[];
  /** Default lib .d.ts files by file name (lib.es5.d.ts …). */
  libs: Record<string, string>;
  maxMs: number;
}

export interface GImport {
  spec: string;
  line: number;
  kind: 'static' | 'dynamic' | 'require' | 'reexport' | 'include' | 'typeref';
  to: string | null;
  pkg?: string;
  names?: string[];
  typeOnly?: boolean;
  conf: Confidence;
}

export interface GRef {
  line: number;
  /** Index into this file's defs (-1 = module level). */
  def: number;
  toFile: string;
  toName: string;
  toLine: number;
  kind: 'call' | 'new' | 'ref' | 'type' | 'extends';
  conf: Confidence;
}

export interface FileGraph {
  level: 1 | 2;
  defs: RawDef[];
  imports: GImport[];
  refs: GRef[];
  /** L2 only: exported definitions (index into defs) and whether anything outside the file references them. */
  exports?: { def: number; name: string; used: boolean; isPublic: boolean }[];
}

export interface L2Result {
  graphs: Record<string, FileGraph>;
  unresolved: { file: string; line: number; detail: string }[];
  /** Files that were in the program but not fully analysed (time budget). */
  partial: string[];
  ms: number;
}

const BRANCH_KINDS = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.CatchClause, ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.CaseClause,
]);
const NEST_KINDS = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.TryStatement,
]);

function isFnLike(n: ts.Node | undefined): n is ts.ArrowFunction | ts.FunctionExpression {
  return !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS;
  if (path.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

interface Collected {
  graph: FileGraph;
  /** declaration node -> def index */
  nodes: Map<ts.Node, number>;
}

/** Walks one source file collecting definitions (with complexity) and import statements. */
function collectFile(sf: ts.SourceFile, path: string, resolver: ModuleResolver, unresolved: L2Result['unresolved']): Collected {
  const defs: RawDef[] = [];
  const nodes = new Map<ts.Node, number>();
  const imports: GImport[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const endOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
  const isExported = (n: ts.Node): boolean => {
    const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
    return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  };

  const addDef = (node: ts.Node, name: string, kind: SymbolKind, span: ts.Node, parent?: string, exported?: boolean, params = 0, extra: ts.Node[] = []): number => {
    const idx = defs.length;
    // the definition starts at its name, not at decorators/JSDoc above it
    const nameNode = (node as { name?: ts.Node }).name;
    const startLine = nameNode && ts.canHaveDecorators(node) && ts.getDecorators(node)?.length ? lineOf(nameNode) : lineOf(span);
    defs.push({ name, kind, line: startLine, endLine: endOf(span), parent, complexity: kind === 'function' || kind === 'method' ? 1 : 0, nesting: 0, params, exported: exported || undefined });
    nodes.set(node, idx);
    for (const e of extra) nodes.set(e, idx);
    return idx;
  };

  const addImport = (spec: string, node: ts.Node, kind: GImport['kind'], names?: string[], typeOnly?: boolean) => {
    const to = resolver.resolve(spec, path);
    const relative = spec.startsWith('.') || spec.startsWith('/');
    const imp: GImport = { spec, line: lineOf(node), kind, to, names, typeOnly: typeOnly || undefined, conf: to ? 'resolved' : relative ? 'unresolved' : 'resolved' };
    if (!to && !relative) imp.pkg = packageOf(spec);
    if (!to && relative && !/\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?|ttf|ico|mp[34]|txt|html|graphql|gql|md)(\?.*)?$/.test(spec)) {
      unresolved.push({ file: path, line: imp.line, detail: `import "${spec}" does not resolve to an analysed file` });
    }
    imports.push(imp);
  };

  const visit = (node: ts.Node, fn: number, cls: string | undefined, depth: number) => {
    let cur = fn;
    let curCls = cls;
    let d = depth;

    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const names: string[] = [];
      const c = node.importClause;
      if (c?.name) names.push('default');
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) names.push('*');
        else for (const e of c.namedBindings.elements) names.push((e.propertyName ?? e.name).text);
      }
      addImport(node.moduleSpecifier.text, node, 'static', names, c?.isTypeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text) : ['*'];
      addImport(node.moduleSpecifier.text, node, 'reexport', names, node.isTypeOnly);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) {
      addImport(node.moduleReference.expression.text, node, 'require', ['*']);
    } else if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (arg && ts.isStringLiteralLike(arg)) addImport(arg.text, node, 'dynamic');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length === 1 && arg && ts.isStringLiteralLike(arg)) {
        addImport(arg.text, node, 'require');
      }
    }

    // ---- definitions ----
    if (ts.isFunctionDeclaration(node) && node.name) {
      cur = addDef(node, node.name.text, 'function', node, undefined, isExported(node), node.parameters.length);
      d = 0;
    } else if (ts.isClassDeclaration(node) && node.name) {
      addDef(node, node.name.text, 'class', node, undefined, isExported(node));
      curCls = node.name.text;
    } else if (ts.isInterfaceDeclaration(node)) {
      addDef(node, node.name.text, 'interface', node, undefined, isExported(node));
    } else if (ts.isTypeAliasDeclaration(node)) {
      addDef(node, node.name.text, 'type', node, undefined, isExported(node));
    } else if (ts.isEnumDeclaration(node)) {
      addDef(node, node.name.text, 'enum', node, undefined, isExported(node));
    } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) {
      const inClass = ts.isClassLike(node.parent);
      cur = addDef(node, node.name.text, inClass ? 'method' : 'function', node, inClass ? cls : objectName(node.parent), false, node.parameters.length);
      d = 0;
    } else if (ts.isConstructorDeclaration(node)) {
      cur = addDef(node, 'constructor', 'method', node, cls, false, node.parameters.length);
      d = 0;
    } else if (ts.isPropertyDeclaration(node) && isFnLike(node.initializer) && ts.isIdentifier(node.name)) {
      cur = addDef(node, node.name.text, 'method', node, cls, false, node.initializer.parameters.length);
      d = 0;
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const stmt = node.parent?.parent;
      const top = !!stmt && ts.isVariableStatement(stmt) && ts.isSourceFile(stmt.parent);
      const exported = top && isExported(stmt);
      if (isFnLike(node.initializer)) {
        cur = addDef(node, node.name.text, 'function', top ? stmt : node, undefined, exported, node.initializer.parameters.length);
        d = 0;
      } else if (top && fn === -1 && !(node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'require')) {
        addDef(node, node.name.text, 'variable', stmt, undefined, exported);
      }
    } else if (ts.isPropertyAssignment(node) && isFnLike(node.initializer) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      cur = addDef(node, node.name.text, 'function', node, objectName(node.parent), false, node.initializer.parameters.length);
      d = 0;
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && isFnLike(node.right)) {
      // exports.name = fn / module.exports.name = fn / Foo.prototype.name = fn
      const target = node.left.expression.getText(sf);
      if (/^(exports|module\.exports)$/.test(target) || /\.prototype$/.test(target)) {
        cur = addDef(node, node.left.name.text, 'function', node, /\.prototype$/.test(target) ? target.replace(/\.prototype$/, '') : undefined, !/\.prototype$/.test(target), node.right.parameters.length, [node.left]);
        d = 0;
      }
    }

    // ---- complexity ----
    if (cur >= 0) {
      const def = defs[cur];
      if (BRANCH_KINDS.has(node.kind)) def.complexity++;
      else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) def.complexity++;
      if (NEST_KINDS.has(node.kind)) {
        // "else if" chains do not add nesting
        const elseIf = ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
        if (!elseIf) d++;
        if (d > def.nesting) def.nesting = d;
      }
    }
    ts.forEachChild(node, (c) => visit(c, cur, curCls, d));
  };

  const objectName = (obj: ts.Node): string | undefined => {
    const p = obj?.parent;
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (p && ts.isBinaryExpression(p) && /^module\.exports$|^exports$/.test(p.left.getText(sf))) return undefined;
    return undefined;
  };

  visit(sf, -1, undefined, 0);
  return { graph: { level: 2, defs, imports, refs: [] }, nodes };
}

function enclosingDef(defs: RawDef[], line: number): number {
  let best = -1;
  let span = Infinity;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if ((d.kind === 'function' || d.kind === 'method') && d.line <= line && line <= d.endLine && d.endLine - d.line < span) {
      best = i;
      span = d.endLine - d.line;
    }
  }
  return best;
}

export function runL2(input: L2Input): L2Result {
  const t0 = Date.now();
  const unresolved: L2Result['unresolved'] = [];
  const pathSet = new Set(input.allPaths);
  for (const f of input.files) pathSet.add(f.path);
  const resolver = new ModuleResolver(pathSet, input.configs, input.packages);
  const texts = new Map(input.files.map((f) => ['/' + f.path, f.text]));
  const LIB = '/__lib__/';
  for (const [name, text] of Object.entries(input.libs)) texts.set(LIB + name, text);

  const options: ts.CompilerOptions = {
    allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve, skipLibCheck: true, types: [],
    experimentalDecorators: true, allowImportingTsExtensions: true, resolveJsonModule: true, strict: false,
    noLib: Object.keys(input.libs).length === 0, lib: Object.keys(input.libs).length ? ['lib.es2020.d.ts'] : undefined,
    allowNonTsExtensions: true, maxNodeModuleJsDepth: 0,
  };
  const sfCache = new Map<string, ts.SourceFile>();
  const host: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const hit = sfCache.get(fileName);
      if (hit) return hit;
      const text = texts.get(fileName);
      if (text === undefined) return undefined;
      const sf = ts.createSourceFile(fileName, text, languageVersion, true, fileName.startsWith(LIB) ? ts.ScriptKind.TS : scriptKind(fileName));
      sfCache.set(fileName, sf);
      return sf;
    },
    getDefaultLibFileName: () => LIB + 'lib.es2020.d.ts',
    getDefaultLibLocation: () => LIB.slice(0, -1),
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => texts.has(f),
    readFile: (f) => texts.get(f),
    directoryExists: () => true,
    getDirectories: () => [],
    resolveModuleNameLiterals(literals, containingFile) {
      const from = containingFile.slice(1);
      return literals.map((lit) => {
        const to = resolver.resolve(lit.text, from);
        if (!to || !texts.has('/' + to)) return { resolvedModule: undefined };
        const ext = to.endsWith('.d.ts') ? ts.Extension.Dts : (('.' + to.split('.').pop()) as ts.Extension);
        return { resolvedModule: { resolvedFileName: '/' + to, extension: ext, isExternalLibraryImport: false } };
      });
    },
  };

  const roots = input.files.filter((f) => !f.path.endsWith('.json')).map((f) => '/' + f.path);
  const program = ts.createProgram({ rootNames: roots, options, host });
  const checker = program.getTypeChecker();

  // pass 1: definitions + imports for every file
  const collected = new Map<string, Collected>();
  const declIndex = new Map<ts.Node, { file: string; def: number }>();
  for (const f of input.files) {
    if (f.path.endsWith('.json')) continue;
    const sf = program.getSourceFile('/' + f.path);
    if (!sf) continue;
    if (f.path.endsWith('.d.ts')) {
      collected.set(f.path, { graph: { level: 2, defs: [], imports: [], refs: [] }, nodes: new Map() });
      continue;
    }
    try {
      const c = collectFile(sf, f.path, resolver, unresolved);
      collected.set(f.path, c);
      for (const [node, def] of c.nodes) declIndex.set(node, { file: f.path, def });
    } catch (e) {
      unresolved.push({ file: f.path, line: 1, detail: `L2 could not walk this file: ${e instanceof Error ? e.message : e}` });
    }
  }

  const targetOf = (sym: ts.Symbol | undefined, depth = 0): { file: string; def: number } | null => {
    if (!sym || depth > 4) return null;
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym);
      } catch {
        return null;
      }
    }
    for (const decl of sym.declarations ?? []) {
      const hit = declIndex.get(decl);
      if (hit) return hit;
      if (ts.isShorthandPropertyAssignment(decl)) {
        const t = targetOf(checker.getShorthandAssignmentValueSymbol(decl), depth + 1);
        if (t) return t;
      } else if (ts.isPropertyAssignment(decl) && ts.isIdentifier(decl.initializer)) {
        const t = targetOf(checker.getSymbolAtLocation(decl.initializer), depth + 1);
        if (t) return t;
      } else if (ts.isPropertyAccessExpression(decl) && ts.isBinaryExpression(decl.parent) && ts.isIdentifier(decl.parent.right)) {
        // exports.name = localFunction
        const t = targetOf(checker.getSymbolAtLocation(decl.parent.right), depth + 1);
        if (t) return t;
      } else if (ts.isExportAssignment(decl) && ts.isIdentifier(decl.expression)) {
        const t = targetOf(checker.getSymbolAtLocation(decl.expression), depth + 1);
        if (t) return t;
      } else if (ts.isBinaryExpression(decl) && ts.isIdentifier(decl.right)) {
        // module.exports = localIdentifier
        const t = targetOf(checker.getSymbolAtLocation(decl.right), depth + 1);
        if (t) return t;
      }
    }
    return null;
  };

  // pass 2: resolve every identifier reference
  const partial: string[] = [];
  const usedOutside = new Set<string>(); // `${file}#${def}`
  for (const f of input.files) {
    const c = collected.get(f.path);
    if (!c || f.path.endsWith('.d.ts')) continue;
    if (Date.now() - t0 > input.maxMs) {
      partial.push(f.path);
      continue;
    }
    const sf = program.getSourceFile('/' + f.path)!;
    const seen = new Set<string>();
    const { defs } = c.graph;
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        const p = node.parent;
        const isDeclName = p && (p as { name?: ts.Node }).name === node && (ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isMethodDeclaration(p) || ts.isVariableDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isParameter(p) || ts.isPropertyDeclaration(p) || ts.isPropertyAssignment(p) || ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) || ts.isTypeParameterDeclaration(p) || ts.isBindingElement(p) || ts.isJsxAttribute(p));
        const isImportedName = p && (ts.isImportSpecifier(p) || ts.isExportSpecifier(p));
        if (!isDeclName && !isImportedName) {
          let sym: ts.Symbol | undefined;
          try {
            sym = checker.getSymbolAtLocation(node);
            if (sym && p && ts.isShorthandPropertyAssignment(p)) sym = checker.getShorthandAssignmentValueSymbol(p) ?? sym;
          } catch {
            sym = undefined;
          }
          const t = targetOf(sym);
          if (t) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            const from = enclosingDef(defs, line);
            const selfDecl = t.file === f.path && c.nodes.get(p!) === t.def;
            if (!selfDecl && !(t.file === f.path && t.def === from && defs[t.def].kind !== 'function' && defs[t.def].kind !== 'method')) {
              // classify
              let kind: GRef['kind'] = 'ref';
              const access = p && ts.isPropertyAccessExpression(p) && p.name === node ? p : node;
              const up = access.parent;
              if (up && ts.isCallExpression(up) && up.expression === access) kind = 'call';
              else if (up && ts.isNewExpression(up) && up.expression === access) kind = 'new';
              else if (up && (ts.isJsxOpeningElement(up) || ts.isJsxSelfClosingElement(up)) && up.tagName === access) kind = 'call';
              else if (up && ts.isExpressionWithTypeArguments(up) && ts.isHeritageClause(up.parent)) kind = 'extends';
              else if (up && (ts.isTypeReferenceNode(up) || ts.isTypeQueryNode(up) || ts.isQualifiedName(up))) kind = 'type';
              else if (up && ts.isDecorator(up)) kind = 'call';
              const target = collected.get(t.file)!.graph.defs[t.def];
              const key = `${from}|${line}|${t.file}|${t.def}|${kind}`;
              if (!seen.has(key)) {
                seen.add(key);
                c.graph.refs.push({ line, def: from, toFile: t.file, toName: target.name, toLine: target.line, kind, conf: 'resolved' });
              }
              if (t.file !== f.path) usedOutside.add(`${t.file}#${t.def}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    try {
      visit(sf);
    } catch (e) {
      unresolved.push({ file: f.path, line: 1, detail: `L2 reference resolution failed: ${e instanceof Error ? e.message : e}` });
    }
  }

  // pass 3: exports and whether they are used outside their file
  const publicEntry = new Set<string>();
  for (const p of input.packages) {
    const r = resolver.resolve(p.name, p.dir + '/__x__');
    if (r) publicEntry.add(r);
  }
  const publicDefs = new Set<string>();
  const exportTargets = new Map<string, { def: number; name: string }[]>();
  for (const [path, c] of collected) {
    if (path.endsWith('.d.ts')) continue;
    const sf = program.getSourceFile('/' + path);
    const modSym = sf && checker.getSymbolAtLocation(sf);
    const list: { def: number; name: string }[] = [];
    if (modSym) {
      let exps: ts.Symbol[] = [];
      try {
        exps = checker.getExportsOfModule(modSym);
      } catch {
        exps = [];
      }
      for (const e of exps) {
        const t = targetOf(e);
        if (!t) continue;
        if (t.file === path) list.push({ def: t.def, name: e.name });
        if (publicEntry.has(path)) publicDefs.add(`${t.file}#${t.def}`);
      }
    }
    // CommonJS exports recorded during collection
    c.graph.defs.forEach((d, i) => {
      if (d.exported && !list.some((x) => x.def === i)) list.push({ def: i, name: d.name });
    });
    exportTargets.set(path, list);
  }
  const graphs: Record<string, FileGraph> = {};
  for (const [path, c] of collected) {
    const partialFile = partial.includes(path);
    c.graph.exports = (exportTargets.get(path) ?? []).map((e) => {
      c.graph.defs[e.def].exported = true;
      return { def: e.def, name: e.name, used: partial.length > 0 || usedOutside.has(`${path}#${e.def}`), isPublic: publicDefs.has(`${path}#${e.def}`) || publicEntry.has(path) };
    });
    if (!partialFile) graphs[path] = c.graph;
    else graphs[path] = { ...c.graph, refs: [] };
  }
  return { graphs, unresolved, partial, ms: Date.now() - t0 };
}
