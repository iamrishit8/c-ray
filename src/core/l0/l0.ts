// L0: facts available for any language without parsing code.
import type { ConfigFile, Evidence, L0Result, ManifestInfo, TechHit } from '../types';
import { basename, dirname, extname, lineOf } from '../util';
import { techForDep } from './tech';

type Dep = ManifestInfo['deps'][number];

function lineOfKey(text: string, key: string, from = 0): number {
  const i = text.indexOf(key, from);
  return i < 0 ? 1 : lineOf(text, i);
}

function parsePackageJson(file: string, text: string): ManifestInfo | null {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const deps: Dep[] = [];
  for (const [section, dev] of [['dependencies', false], ['devDependencies', true], ['peerDependencies', false], ['optionalDependencies', false]] as const) {
    const obj = json[section];
    if (!obj || typeof obj !== 'object') continue;
    const start = Math.max(0, text.indexOf(`"${section}"`));
    for (const [name, version] of Object.entries(obj)) {
      deps.push({ name, version: String(version), dev, line: lineOfKey(text, `"${name}"`, start) });
    }
  }
  const ws = Array.isArray(json.workspaces) ? json.workspaces : Array.isArray(json.workspaces?.packages) ? json.workspaces.packages : undefined;
  return {
    file, type: 'package.json', name: typeof json.name === 'string' ? json.name : undefined, deps,
    scripts: json.scripts && typeof json.scripts === 'object' ? json.scripts : undefined,
    workspaces: ws?.filter((w: unknown) => typeof w === 'string'),
  };
}

function parseComposer(file: string, text: string): ManifestInfo | null {
  try {
    const json = JSON.parse(text);
    const deps: Dep[] = [];
    for (const [section, dev] of [['require', false], ['require-dev', true]] as const) {
      for (const [name, version] of Object.entries(json[section] ?? {})) {
        if (name === 'php' || name.startsWith('ext-')) continue;
        deps.push({ name, version: String(version), dev, line: lineOfKey(text, `"${name}"`) });
      }
    }
    return { file, type: 'composer.json', name: json.name, deps };
  } catch {
    return null;
  }
}

function parseLines(file: string, type: string, text: string, re: RegExp, pick: (m: RegExpExecArray) => { name: string; version?: string; dev?: boolean } | null, name?: string): ManifestInfo {
  const deps: Dep[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const d = pick(m);
    if (d) deps.push({ ...d, line: i + 1 });
  }
  return { file, type, name, deps };
}

/** Minimal TOML section reader: returns [section, key, value, line] tuples. */
function tomlEntries(text: string): [string, string, string, number][] {
  const out: [string, string, string, number][] = [];
  let section = '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    const s = /^\[+([^\]]+)\]+$/.exec(l);
    if (s) {
      section = s[1].trim();
      continue;
    }
    const kv = /^([\w."-]+)\s*=\s*(.+)$/.exec(l);
    if (kv) out.push([section, kv[1].replace(/"/g, ''), kv[2], i + 1]);
    else if (/^["']/.test(l)) out.push([section, '', l, i + 1]); // array continuation line
  }
  return out;
}

function parsePyproject(file: string, text: string): ManifestInfo {
  const deps: Dep[] = [];
  let name: string | undefined;
  let inDepsArray = false;
  for (const [section, key, value, line] of tomlEntries(text)) {
    if ((section === 'project' || section === 'tool.poetry') && key === 'name') name = value.replace(/["']/g, '');
    if (section === 'project' && key === 'dependencies') inDepsArray = !value.includes(']');
    const fromArray = (section === 'project' && (key === 'dependencies' || (key === '' && inDepsArray)));
    if (fromArray) {
      for (const m of value.matchAll(/["']([A-Za-z0-9_.-]+)\s*([^"']*)["']/g)) deps.push({ name: m[1], version: m[2] || undefined, line });
      if (key === '' && value.includes(']')) inDepsArray = false;
    } else if (/^tool\.poetry\.(dev-)?dependencies$|^tool\.poetry\.group\.\w+\.dependencies$/.test(section) && key && key !== 'python') {
      deps.push({ name: key, version: value.replace(/["']/g, ''), dev: section.includes('dev'), line });
    }
  }
  return { file, type: 'pyproject.toml', name, deps };
}

function parseCargo(file: string, text: string): ManifestInfo {
  const deps: Dep[] = [];
  let name: string | undefined;
  for (const [section, key, value, line] of tomlEntries(text)) {
    if (section === 'package' && key === 'name') name = value.replace(/["']/g, '');
    if (/^(dev-|build-)?dependencies$/.test(section) && key) deps.push({ name: key, version: (/"([^"]+)"/.exec(value) ?? [])[1], dev: section.startsWith('dev'), line });
    const sub = /^(?:dev-)?dependencies\.(.+)$/.exec(section);
    if (sub && key === 'version') deps.push({ name: sub[1], version: value.replace(/["']/g, ''), line });
  }
  return { file, type: 'Cargo.toml', name, deps };
}

function parsePom(file: string, text: string): ManifestInfo {
  const deps: Dep[] = [];
  const re = /<(dependency|parent|plugin)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const g = /<groupId>([^<]+)</.exec(m[2])?.[1]?.trim();
    const a = /<artifactId>([^<]+)</.exec(m[2])?.[1]?.trim();
    const v = /<version>([^<]+)</.exec(m[2])?.[1]?.trim();
    const scope = /<scope>([^<]+)</.exec(m[2])?.[1]?.trim();
    if (a) {
      deps.push({ name: a, version: v, dev: scope === 'test', line: lineOf(text, m.index) });
      if (g && !techForDep(a).length && techForDep(g).length) deps.push({ name: g, version: v, line: lineOf(text, m.index) });
    }
  }
  const head = text.replace(/<(dependencies|parent|build|dependencyManagement)>[\s\S]*?<\/\1>/g, '');
  return { file, type: 'pom.xml', name: /<artifactId>([^<]+)</.exec(head)?.[1], deps };
}

export function parseManifest(file: string, text: string): ManifestInfo | null {
  const base = basename(file);
  const lower = base.toLowerCase();
  if (base === 'package.json') return parsePackageJson(file, text);
  if (base === 'composer.json') return parseComposer(file, text);
  if (/^requirements.*\.txt$/.test(lower)) {
    return parseLines(file, 'requirements.txt', text, /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*((?:[=<>!~]=?|===)\s*[^\s;#]+)?/, (m) =>
      m[1] && !m[0].trim().startsWith('#') && !m[0].trim().startsWith('-') ? { name: m[1], version: m[2]?.replace(/^==/, ''), dev: /dev|test/.test(lower) } : null);
  }
  if (lower === 'pyproject.toml') return parsePyproject(file, text);
  if (lower === 'pipfile') {
    const deps: Dep[] = [];
    for (const [section, key, value, line] of tomlEntries(text)) {
      if ((section === 'packages' || section === 'dev-packages') && key) deps.push({ name: key, version: value.replace(/["']/g, ''), dev: section !== 'packages', line });
    }
    return { file, type: 'Pipfile', deps };
  }
  if (lower === 'pom.xml') return parsePom(file, text);
  if (/^build\.gradle(\.kts)?$/.test(lower)) {
    const mi = parseLines(file, 'build.gradle', text, /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|kapt|annotationProcessor|classpath)\s*\(?\s*(?:platform\()?["']([^"']+)["']/, (m) => {
      const [g, a, v] = m[2].split(':');
      return { name: a ?? g, version: v, dev: m[1].startsWith('test') };
    });
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      const p = /^\s*(?:id\s*\(?\s*["']([^"']+)["']|apply\s+plugin:\s*["']([^"']+)["'])/.exec(l);
      if (p) mi.deps.push({ name: p[1] ?? p[2], line: i + 1 });
      const g = /["']([\w.-]+):[\w.-]+(?::[^"']+)?["']/.exec(l);
      if (g && techForDep(g[1]).length) mi.deps.push({ name: g[1], line: i + 1 });
    });
    return mi;
  }
  if (lower === 'go.mod') {
    const mi = parseLines(file, 'go.mod', text, /^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[^\s]+)\s+(v[^\s]+)/, (m) => ({ name: m[1], version: m[2] }));
    mi.name = /^module\s+(\S+)/m.exec(text)?.[1];
    return mi;
  }
  if (lower === 'cargo.toml') return parseCargo(file, text);
  if (lower === 'gemfile') {
    return parseLines(file, 'Gemfile', text, /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/, (m) => ({ name: m[1], version: m[2] }));
  }
  if (lower.endsWith('.csproj') || lower.endsWith('.fsproj')) {
    const mi = parseLines(file, 'csproj', text, /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/, (m) => ({ name: m[1], version: m[2] }));
    const sdk = /<Project\s+Sdk="([^"]+)"/.exec(text);
    if (sdk) mi.deps.push({ name: sdk[1], line: lineOf(text, sdk.index) });
    mi.name = basename(file).replace(/\.\w+$/, '');
    return mi;
  }
  if (lower === 'setup.py') {
    const deps: Dep[] = [];
    const block = /install_requires\s*=\s*\[([\s\S]*?)\]/.exec(text);
    if (block) for (const m of block[1].matchAll(/["']([A-Za-z0-9_.-]+)([^"']*)["']/g)) deps.push({ name: m[1], version: m[2] || undefined, line: lineOf(text, block.index + (m.index ?? 0)) });
    return { file, type: 'setup.py', name: /name\s*=\s*["']([^"']+)["']/.exec(text)?.[1], deps };
  }
  return null;
}

export function isManifest(path: string): boolean {
  const b = basename(path).toLowerCase();
  return b === 'package.json' || b === 'composer.json' || /^requirements.*\.txt$/.test(b) || b === 'pyproject.toml' || b === 'pipfile' ||
    b === 'pom.xml' || /^build\.gradle(\.kts)?$/.test(b) || b === 'go.mod' || b === 'cargo.toml' || b === 'gemfile' ||
    b.endsWith('.csproj') || b.endsWith('.fsproj') || b === 'setup.py';
}

export function classifyConfig(path: string, text: string): ConfigFile | null {
  const b = basename(path);
  const lower = b.toLowerCase();
  const ext = extname(path);
  const mk = (kind: ConfigFile['kind'], detail: string): ConfigFile => ({ file: path, kind, detail });
  if (lower.startsWith('dockerfile') || lower.endsWith('.dockerfile')) {
    const from = /^FROM\s+(\S+)/m.exec(text)?.[1];
    return mk('docker', from ? `Docker image based on ${from}` : 'Docker image definition');
  }
  if (/^(docker-)?compose[\w.-]*\.ya?ml$/.test(lower)) {
    const services = [...text.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);
    return mk('compose', `Compose stack${services.length ? `: ${services.slice(0, 8).join(', ')}` : ''}`);
  }
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return mk('ci', `GitHub Actions workflow${/^name:\s*(.+)$/m.exec(text) ? `: ${/^name:\s*(.+)$/m.exec(text)![1]}` : ''}`);
  if (lower === '.gitlab-ci.yml') return mk('ci', 'GitLab CI pipeline');
  if (lower === 'jenkinsfile') return mk('ci', 'Jenkins pipeline');
  if (/(^|\/)\.circleci\/config\.yml$/.test(path)) return mk('ci', 'CircleCI pipeline');
  if (lower === 'azure-pipelines.yml' || lower === '.travis.yml' || lower === 'bitbucket-pipelines.yml') return mk('ci', `${b} pipeline`);
  if (lower.startsWith('.env')) {
    const keys = [...text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]);
    return mk('env', `${/example|sample|template|dist/.test(lower) ? 'Environment template' : 'Environment file'} (${keys.length} keys${keys.length ? `: ${keys.slice(0, 6).join(', ')}` : ''})`);
  }
  if ((ext === '.yml' || ext === '.yaml') && /^apiVersion:\s*\S+/m.test(text) && /^kind:\s*(\S+)/m.test(text)) {
    return mk('k8s', `Kubernetes ${/^kind:\s*(\S+)/m.exec(text)![1]}`);
  }
  if (lower === 'chart.yaml') return mk('k8s', 'Helm chart');
  if (ext === '.tf') return mk('infra', 'Terraform configuration');
  if (lower === 'serverless.yml' || lower === 'serverless.yaml') return mk('infra', 'Serverless Framework configuration');
  if (/^tsconfig.*\.json$/.test(lower) || lower === 'jsconfig.json') return mk('tsconfig', 'TypeScript/JavaScript project configuration');
  if (lower === 'makefile' || lower === 'cmakelists.txt' || /^(vite|webpack|rollup|babel|esbuild|next|nuxt|svelte|astro|jest|vitest|playwright|tailwind|postcss)\.config\.[cm]?[jt]s$/.test(lower) || lower === 'turbo.json' || lower === 'nx.json' || lower === 'lerna.json' || lower === 'pnpm-workspace.yaml' || lower === 'procfile') {
    return mk('build', `${b} build/tooling configuration`);
  }
  if (/^\.(eslintrc|prettierrc|stylelintrc|editorconfig|rubocop|flake8|pylintrc)/.test(lower) || lower === 'eslint.config.js' || lower === 'setup.cfg' || lower === 'tox.ini' || lower === 'phpcs.xml') {
    return mk('lint', `${b} lint/format configuration`);
  }
  if (/^application[\w-]*\.(properties|ya?ml)$/.test(lower) || lower === 'appsettings.json' || lower === 'settings.py' || lower === 'web.config' || lower === 'nginx.conf') {
    return mk('other', `${b} application configuration`);
  }
  return null;
}

export function classifyDoc(path: string, text: string): L0Result['docs'][number] | null {
  const lower = path.toLowerCase();
  const b = basename(lower);
  if (!/\.(md|mdx|rst|txt|adoc)$/.test(b) && !/^readme$/.test(b)) return null;
  const title = (/^#\s+(.+)$/m.exec(text)?.[1] ?? /^(.+)\n[=]{3,}/m.exec(text)?.[1] ?? basename(path)).trim().slice(0, 120);
  if (/(^|\/)(adr|adrs|decisions|architecture-decisions)\//.test(lower) || /(^|\/)adr[-_]?\d+/.test(lower)) return { file: path, title, kind: 'adr' };
  if (b.startsWith('readme')) return { file: path, title, kind: 'readme' };
  if (b.startsWith('changelog') || b.startsWith('history')) return { file: path, title, kind: 'changelog' };
  if (/\.(md|mdx|rst|adoc)$/.test(b)) return { file: path, title, kind: 'doc' };
  return null;
}

/** Combine manifests + config files into a technology list with evidence. */
export function detectTech(manifests: ManifestInfo[], configs: ConfigFile[], langs: L0Result['languages']): TechHit[] {
  const hits = new Map<string, TechHit>();
  const add = (id: string, name: string, category: TechHit['category'], ev: Evidence) => {
    const h = hits.get(id);
    if (h) {
      if (h.evidence.length < 6) h.evidence.push(ev);
    } else hits.set(id, { id, name, category, evidence: [ev], conf: 'resolved' });
  };
  for (const m of manifests) {
    for (const d of m.deps) {
      for (const t of techForDep(d.name)) {
        add(t.id, t.name, t.category, { file: m.file, line: d.line, kind: 'manifest', note: `${m.type} declares ${d.name}${d.version ? ` ${d.version}` : ''}` });
      }
    }
    if (m.workspaces?.length) add('workspaces', 'Workspaces monorepo', 'build', { file: m.file, line: 1, kind: 'manifest', note: `workspaces: ${m.workspaces.join(', ')}` });
    if (m.type === 'Gemfile' && m.deps.some((d) => d.name === 'rails')) add('activerecord', 'ActiveRecord', 'orm', { file: m.file, line: m.deps.find((d) => d.name === 'rails')!.line, kind: 'manifest', note: 'Rails bundles ActiveRecord' });
    if (m.type === 'composer.json' && m.deps.some((d) => d.name === 'laravel/framework')) add('eloquent', 'Eloquent ORM', 'orm', { file: m.file, line: m.deps.find((d) => d.name === 'laravel/framework')!.line, kind: 'manifest', note: 'Laravel bundles Eloquent' });
  }
  for (const c of configs) {
    const ev: Evidence = { file: c.file, line: 1, kind: 'config', note: c.detail };
    if (c.kind === 'docker' || c.kind === 'compose') add('docker', 'Docker', 'infra', ev);
    if (c.kind === 'k8s') add('kubernetes', 'Kubernetes', 'infra', ev);
    if (c.kind === 'ci') add('ci', 'Continuous integration', 'infra', ev);
    if (c.kind === 'infra') add('iac', 'Infrastructure as code', 'infra', ev);
    if (c.file.endsWith('pnpm-workspace.yaml')) add('workspaces', 'Workspaces monorepo', 'build', ev);
    if (c.kind === 'tsconfig' && basename(c.file).startsWith('tsconfig')) add('typescript', 'TypeScript', 'language', ev);
  }
  if (!hits.has('typescript') && langs.some((l) => l.lang === 'typescript')) {
    add('typescript', 'TypeScript', 'language', { file: '', line: 0, kind: 'structure', note: 'TypeScript source files present' });
  }
  return [...hits.values()];
}

export function manifestDir(m: ManifestInfo): string {
  return dirname(m.file);
}
