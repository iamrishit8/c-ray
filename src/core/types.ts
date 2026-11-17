// Core data model. Everything here is plain JSON so it can cross worker
// boundaries (structured clone) and be persisted in IndexedDB unchanged.

/** How sure we are about an inferred fact or edge. */
export type Confidence = 'resolved' | 'heuristic' | 'unresolved';

export interface Ref {
  file: string;
  line: number;
  endLine?: number;
}

export interface Evidence {
  /** File path, or '' when the evidence is a commit. */
  file: string;
  line: number;
  note: string;
  kind: 'code' | 'config' | 'manifest' | 'doc' | 'commit' | 'comment' | 'structure';
  commit?: string;
}

export type Role =
  | 'entry' | 'route' | 'controller' | 'middleware' | 'service' | 'repository'
  | 'model' | 'view' | 'component' | 'page' | 'config' | 'util' | 'test'
  | 'migration' | 'job' | 'cli' | 'client' | 'messaging' | 'schema' | 'doc'
  | 'build' | 'unknown';

export interface FileInfo {
  path: string;
  size: number;
  loc: number;
  sloc: number;
  lang: string;
  hash: string;
  role: Role;
  roleConf: Confidence;
  /** What assigned the role: detector id or 'generic'. */
  roleSource: string;
  /** Deepest analysis layer applied: 0 = text only, 1 = tree-sitter, 2 = TS compiler. */
  level: 0 | 1 | 2;
  test: boolean;
  parseError?: string;
  complexity: number;
  maxComplexity: number;
  maxNesting: number;
  symbols: number;
}

export type SkipReason =
  | 'ignored' | 'gitignore' | 'binary' | 'image' | 'lockfile' | 'minified'
  | 'generated' | 'too-large' | 'nested-zip' | 'read-error' | 'budget' | 'empty';

export interface SkippedFile {
  path: string;
  size: number;
  reason: SkipReason;
  detail?: string;
}

export type SymbolKind =
  | 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'struct'
  | 'trait' | 'module' | 'variable' | 'table' | 'view' | 'procedure';

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  /** Index into Analysis.files. */
  file: number;
  line: number;
  endLine: number;
  /** Containing class/impl/module name. */
  parent?: string;
  complexity: number;
  nesting: number;
  params: number;
  exported?: boolean;
}

export type ImportKind = 'static' | 'dynamic' | 'require' | 'include' | 'reexport' | 'typeref';

export interface ImportEdge {
  /** Index into Analysis.files. */
  from: number;
  /** Index into Analysis.files, or -1 when external / unresolved. */
  to: number;
  spec: string;
  /** External package name when the import leaves the project. */
  pkg?: string;
  line: number;
  conf: Confidence;
  kind: ImportKind;
  names?: string[];
  typeOnly?: boolean;
}

export interface RefEdge {
  /** Symbol index of the enclosing definition, or -1 for module level. */
  from: number;
  file: number;
  line: number;
  /** Symbol index of the target. */
  to: number;
  kind: 'call' | 'new' | 'ref' | 'type' | 'extends';
  conf: Confidence;
}

export interface Unresolved {
  file: string;
  line: number;
  kind: 'dynamic-import' | 'reflection' | 'di' | 'dynamic-route' | 'eval' | 'dynamic-call' | 'dynamic-include' | 'import';
  detail: string;
}

// ---------- L0 ----------

export interface ManifestInfo {
  file: string;
  type: string; // package.json, requirements.txt, ...
  name?: string;
  deps: { name: string; version?: string; dev?: boolean; line: number }[];
  scripts?: Record<string, string>;
  workspaces?: string[];
}

export interface ConfigFile {
  file: string;
  kind: 'docker' | 'compose' | 'ci' | 'env' | 'k8s' | 'build' | 'lint' | 'tsconfig' | 'infra' | 'editor' | 'other';
  detail: string;
}

export interface TechHit {
  id: string;
  name: string;
  category: 'framework' | 'library' | 'database' | 'orm' | 'queue' | 'testing' | 'build' | 'language' | 'infra' | 'auth' | 'ui' | 'state' | 'http' | 'cache' | 'api';
  evidence: Evidence[];
  conf: Confidence;
}

export interface L0Result {
  languages: { lang: string; files: number; loc: number; bytes: number }[];
  manifests: ManifestInfo[];
  configs: ConfigFile[];
  tech: TechHit[];
  docs: { file: string; title: string; kind: 'readme' | 'adr' | 'doc' | 'changelog' }[];
  tree: { dirs: number; maxDepth: number };
}

// ---------- Framework layer ----------

export interface DetectedFramework {
  id: string;
  name: string;
  conf: Confidence;
  evidence: Evidence[];
}

export interface Route {
  id: string;
  kind: 'http' | 'page' | 'ws' | 'graphql' | 'rpc';
  method: string;
  path: string;
  file: string;
  line: number;
  handler?: string;
  /** Symbol index of the handler when resolved. */
  handlerSym?: number;
  /** Location of the handler body: the resolved symbol, or an inline function's line range. */
  hFile?: string;
  hLine?: number;
  hEnd?: number;
  middleware: { name: string; file?: string; line?: number; sym?: number }[];
  params: string[];
  framework: string;
  conf: Confidence;
}

export type EntryKind = 'route' | 'main' | 'cli' | 'job' | 'event' | 'page';

export interface EntryPoint {
  id: string;
  kind: EntryKind;
  label: string;
  file: string;
  line: number;
  sym?: number;
  /** Line range of the entry body when it is not a named symbol. */
  endLine?: number;
  routeId?: string;
  framework?: string;
  conf: Confidence;
}

export type FactKind =
  | 'db' | 'http-call' | 'queue-pub' | 'queue-sub' | 'job' | 'cli' | 'component'
  | 'middleware' | 'controller' | 'service' | 'repository' | 'model' | 'page' | 'di';

export interface Fact {
  kind: FactKind;
  file: string;
  line: number;
  detail: string;
  /** Entity/table, URL, topic, component name ... */
  target?: string;
  op?: 'read' | 'write';
  tech?: string;
  conf: Confidence;
  detector: string;
}

// ---------- Schema ----------

export interface Field {
  name: string;
  type: string;
  line: number;
  pk?: boolean;
  nullable?: boolean;
  unique?: boolean;
  ref?: string;
}

export interface Entity {
  name: string;
  table?: string;
  file: string;
  line: number;
  source: string; // mongoose, prisma, typeorm, sequelize, sqlalchemy, django, jpa, activerecord, sql, migration
  fields: Field[];
  indexes: { fields: string[]; unique?: boolean; line: number }[];
  conf: Confidence;
}

export interface Relation {
  from: string;
  to: string;
  kind: '1-1' | '1-n' | 'n-1' | 'n-n';
  via?: string;
  file: string;
  line: number;
  conf: Confidence;
}

export interface EntityAccess {
  entity: string;
  file: string;
  line: number;
  op: 'read' | 'write';
  detail: string;
  conf: Confidence;
}

export interface SchemaResult {
  entities: Entity[];
  relations: Relation[];
  access: EntityAccess[];
}

// ---------- Dependencies ----------

export interface Cycle {
  files: string[];
  edges: { from: string; to: string; line: number; conf: Confidence }[];
}

export interface ModuleMetric {
  file: string;
  fanIn: number;
  fanOut: number;
  instability: number;
}

export interface LayerViolation {
  file: string;
  line: number;
  fromRole: Role;
  toRole: Role | 'db';
  target?: string;
  detail: string;
  rule: string;
  conf: Confidence;
}

export interface ExternalPkg {
  name: string;
  version?: string;
  declared: boolean;
  manifest?: string;
  uses: { file: string; line: number }[];
}

export interface DepsResult {
  cycles: Cycle[];
  metrics: ModuleMetric[];
  godModules: { file: string; reasons: string[]; fanIn: number; fanOut: number; loc: number; symbols: number }[];
  violations: LayerViolation[];
  packages: ExternalPkg[];
}

// ---------- Health ----------

export type FindingCat =
  | 'oversize-file' | 'oversize-function' | 'complexity' | 'nesting' | 'clone'
  | 'dead-export' | 'todo' | 'secret' | 'eval' | 'sql-concat' | 'tls-disabled' | 'hotspot';

export interface Finding {
  cat: FindingCat;
  sev: 'info' | 'low' | 'medium' | 'high';
  file: string;
  line: number;
  endLine?: number;
  msg: string;
  conf: Confidence;
  related?: Ref[];
  value?: number;
}

// ---------- Git ----------

export interface CommitInfo {
  oid: string;
  msg: string;
  author: string;
  email: string;
  time: number;
  files: string[];
  tags?: string[];
}

export interface ArchSnapshot {
  oid: string;
  label: string;
  time: number;
  files: number;
  loc: number;
  /** Top-level modules (directories, depth <= 2) with file counts and LOC. */
  modules: { name: string; files: number; loc: number }[];
  /** Module-to-module dependency edges. */
  edges: { from: string; to: string; count: number }[];
  /** Most complex files at this commit. */
  hotspots: { file: string; complexity: number; loc: number }[];
  avgComplexity: number;
  langs: Record<string, number>;
}

export interface GitResult {
  branch: string;
  head: string;
  totalCommits: number;
  truncated: boolean;
  commits: CommitInfo[];
  churn: { file: string; commits: number; authors: number; lastTime: number; topAuthor: string; topAuthorShare: number }[];
  authors: { name: string; email: string; commits: number; files: number }[];
  busFactor: { overall: number; risky: { file: string; author: string; share: number; commits: number }[] };
  cochange: { a: string; b: string; count: number; score: number }[];
  messages: { types: Record<string, number>; keywords: { word: string; count: number }[] };
  tags: { name: string; oid: string }[];
  snapshots: ArchSnapshot[];
  notes: string[];
}

// ---------- Decisions / orientation ----------

export interface Decision {
  id: string;
  title: string;
  decision: string;
  category: string;
  evidence: Evidence[];
  conf: Confidence;
  tradeoffs: string[];
}

export interface Orientation {
  summary: string;
  styles: { name: string; conf: Confidence; score: number; evidence: Evidence[] }[];
  readFirst: { file: string; score: number; reasons: string[] }[];
}

export interface Coverage {
  discovered: number;
  analyzed: number;
  skipped: number;
  pctFiles: number;
  pctBytes: number;
  l1Files: number;
  l2Files: number;
  /** Set when a budget forced analysing a prioritised subset. */
  limited?: string;
}

export interface AnalysisOptions {
  ignore: string[];
  respectGitignore: boolean;
  maxFileBytes: number;
  parseTimeoutMs: number;
  /** Total source text budget; beyond this a prioritised subset is analysed. */
  maxTotalBytes: number;
  maxL2Files: number;
  maxGitCommits: number;
  enableGit: boolean;
}

export interface Analysis {
  version: number;
  projectId: string;
  name: string;
  createdAt: number;
  mode: 'project' | 'file';
  /** Which stages have completed; lets the UI render progressively. */
  stage: 'l0' | 'graph' | 'done';
  contentHash: string;
  options: AnalysisOptions;
  files: FileInfo[];
  skipped: SkippedFile[];
  notices: string[];
  coverage: Coverage;
  l0: L0Result;
  symbols: SymbolDef[];
  imports: ImportEdge[];
  refs: RefEdge[];
  unresolved: Unresolved[];
  frameworks: DetectedFramework[];
  routes: Route[];
  entries: EntryPoint[];
  facts: Fact[];
  schema: SchemaResult;
  deps: DepsResult;
  findings: Finding[];
  git: GitResult | null;
  gitMessage?: string;
  decisions: Decision[];
  orientation: Orientation;
  /** L1-vs-L2 accuracy measured on this project's TS/JS files, when both ran. */
  l1Accuracy?: { imports: PR; calls: PR };
  timings: Record<string, number>;
  reused: { files: number; total: number };
}

export interface PR {
  precision: number;
  recall: number;
  tp: number;
  fp: number;
  fn: number;
}

export const ANALYSIS_VERSION = 1;

export const DEFAULT_IGNORE: string[] = [
  'node_modules/', 'vendor/', 'dist/', 'build/', '.next/', 'target/', 'out/',
  '.git/', '.svn/', '.hg/', '.idea/', '.vscode/', '__pycache__/', '.venv/', 'venv/',
  '.gradle/', '.nuxt/', '.cache/', 'coverage/', 'bower_components/', '.tox/',
  '.mypy_cache/', '.pytest_cache/', 'Pods/', '.terraform/', 'bin/Debug/', 'bin/Release/', 'obj/',
  '*.min.js', '*.min.css', '*.map', '*.lock', 'package-lock.json', 'yarn.lock',
  'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock', 'Cargo.lock', 'poetry.lock',
  'Pipfile.lock', 'go.sum', '.DS_Store', 'Thumbs.db',
];

export const DEFAULT_OPTIONS: AnalysisOptions = {
  ignore: DEFAULT_IGNORE,
  respectGitignore: true,
  maxFileBytes: 2 * 1024 * 1024,
  parseTimeoutMs: 2000,
  maxTotalBytes: 300 * 1024 * 1024,
  maxL2Files: 4000,
  maxGitCommits: 500,
  enableGit: true,
};

// ---------- Per-file intermediate results (cacheable by file hash) ----------

export interface RawDef {
  name: string;
  kind: SymbolKind;
  line: number;
  endLine: number;
  parent?: string;
  complexity: number;
  nesting: number;
  params: number;
  exported?: boolean;
}

export interface RawImport {
  spec: string;
  line: number;
  kind: ImportKind;
  /** [imported, local] pairs; imported '*' = namespace, 'default' = default. */
  names?: [string, string][];
  typeOnly?: boolean;
}

export interface RawCall {
  name: string;
  recv?: string;
  line: number;
  /** Index into FileParse.defs of the enclosing definition, -1 = module level. */
  def: number;
  isNew?: boolean;
}

export interface FileParse {
  defs: RawDef[];
  imports: RawImport[];
  calls: RawCall[];
  /** Capitalised type identifiers referenced (for same-package resolution). */
  typeRefs?: string[];
  /** Package / namespace declaration. */
  pkg?: string;
  error?: string;
  timedOut?: boolean;
}

export interface FileScan {
  loc: number;
  sloc: number;
  todos: { line: number; tag: string; text: string }[];
  smells: { line: number; cat: FindingCat; msg: string; sev: Finding['sev'] }[];
  unresolved: { line: number; kind: Unresolved['kind']; detail: string }[];
  /** Hashes of significant normalised lines, for clone detection: [hash, line, tokenCount]. */
  lineHashes: number[];
}

export interface FileUnit {
  path: string;
  text: string;
  lang: string;
  hash: string;
  size: number;
}

export interface Progress {
  phase: string;
  discovered: number;
  parsed: number;
  skipped: number;
  total: number;
  detail?: string;
}
