// "How do I run it?" from what the repo itself declares: manifest scripts, Dockerfile, compose, Makefile,
// README code blocks and env templates. `resolved` = copied verbatim from a file; `heuristic` = the usual
// command for this kind of project (we saw pom.xml, not a command). Real `.env` values are never copied.
import { declaredDatabases } from '../decisions/catalogue';
import { CODE_LANGS } from '../l0/languages';
import type { Analysis, Claim, EnvVar, FileUnit, RunCommand, RunInfo } from '../types';
import { basename, dirname, lineOf } from '../util';

const MAX_COMMANDS = 24;
const MAX_ENV = 40;
const SCRIPT_KIND: [RegExp, RunCommand['kind']][] = [[/^(start|dev|serve|watch)/, 'run'], [/^build/, 'build'], [/^(test|e2e|spec)/, 'test'], [/^(lint|typecheck|check|format|migrate|seed|db[:-])/, 'other']];
const KIND_ORDER: RunCommand['kind'][] = ['install', 'run', 'test', 'build', 'docker', 'other'];

const RUNTIME: Record<string, { name: string; image: RegExp }> = {
  javascript: { name: 'Node.js', image: /^FROM\s+node:(\d+)/m },
  typescript: { name: 'Node.js', image: /^FROM\s+node:(\d+)/m },
  python: { name: 'Python', image: /^FROM\s+python:(\d+(?:\.\d+)?)/m },
  java: { name: 'a JDK', image: /^FROM\s+(?:eclipse-temurin|openjdk|amazoncorretto|maven|gradle):?(\d+)?/m },
  go: { name: 'Go', image: /^FROM\s+golang:(\d+(?:\.\d+)?)/m },
  php: { name: 'PHP', image: /^FROM\s+php:(\d+(?:\.\d+)?)/m },
  ruby: { name: 'Ruby', image: /^FROM\s+ruby:(\d+(?:\.\d+)?)/m },
  csharp: { name: 'the .NET SDK', image: /^FROM\s+mcr\.microsoft\.com\/dotnet\/\S+:(\d+(?:\.\d+)?)/m },
  rust: { name: 'the Rust toolchain', image: /^FROM\s+rust:(\d+(?:\.\d+)?)/m },
};

const README_HEAD = /install|setup|set up|getting started|quick ?start|running|run |usage|development|build|test/i;
const README_CMD = /^(?:\$\s*)?((?:npm|npx|yarn|pnpm|pip3?|python3?|poetry|docker(?:-compose)?|make|mvn|\.\/mvnw|gradle|\.\/gradlew|go|cargo|bundle|rails|rake|php|composer|dotnet|flask|uvicorn|gunicorn|node|bun|deno)\b.*)$/;

export function buildRunInfo(a: Analysis, units: Map<string, FileUnit>): RunInfo {
  const commands: RunCommand[] = [];
  const add = (c: RunCommand) => {
    const i = commands.findIndex((x) => x.command === c.command && (x.cwd ?? '') === (c.cwd ?? ''));
    // the same command copied verbatim from a file beats the conventional guess
    if (i >= 0) {
      if (commands[i].conf !== 'resolved' && c.conf === 'resolved') commands[i] = c;
    } else if (commands.length < MAX_COMMANDS) commands.push(c);
  };
  const has = (id: string) => a.l0.tech.some((t) => t.id === id);
  const lock = new Set(a.skipped.filter((s) => s.reason === 'lockfile').map((s) => basename(s.path)));
  const pm = lock.has('pnpm-lock.yaml') || a.l0.configs.some((c) => basename(c.file) === 'pnpm-workspace.yaml') ? 'pnpm' : lock.has('yarn.lock') ? 'yarn' : 'npm';
  const text = (file: string) => units.get(file)?.text ?? '';
  const find = (file: string, needle: string) => lineOf(text(file), Math.max(0, text(file).indexOf(needle)));
  const cwdOf = (file: string) => dirname(file) || undefined;

  // ---- package.json (JS/TS): install once at the root (or per top-level package), then declared scripts ----
  const pkgs = a.l0.manifests.filter((m) => m.type === 'package.json').sort((x, y) => x.file.length - y.file.length);
  const rootPkg = pkgs.find((m) => !m.file.includes('/'));
  for (const m of (rootPkg ? [rootPkg, ...pkgs.filter((x) => x !== rootPkg && x.scripts)] : pkgs).slice(0, 6)) {
    if (m === rootPkg || !rootPkg) add({ kind: 'install', label: 'Install dependencies', command: `${pm} install`, cwd: cwdOf(m.file), file: m.file, line: 1, conf: 'heuristic' });
    for (const [name, body] of Object.entries(m.scripts ?? {}).slice(0, 40)) {
      const kind = SCRIPT_KIND.find(([re]) => re.test(name))?.[1];
      if (!kind) continue;
      const run = name === 'start' || name === 'test' ? `${pm} ${name}` : `${pm} run ${name}`;
      add({ kind, label: `scripts.${name}: ${body}`, command: run, cwd: cwdOf(m.file), file: m.file, line: find(m.file, `"${name}"`), conf: 'resolved' });
    }
  }

  // ---- other ecosystems: the conventional command, derived from the manifest we saw ----
  for (const m of a.l0.manifests) {
    const cwd = cwdOf(m.file);
    const hint = (kind: RunCommand['kind'], label: string, command: string, line = 1) => add({ kind, label, command, cwd, file: m.file, line, conf: 'heuristic' });
    if (m.type === 'requirements.txt') hint('install', 'Install Python dependencies', `pip install -r ${basename(m.file)}`);
    else if (m.type === 'pyproject.toml') hint('install', 'Install the project', 'pip install -e .');
    else if (m.type === 'Pipfile') hint('install', 'Install Python dependencies', 'pipenv install');
    else if (m.type === 'pom.xml') {
      hint('run', 'Run the application', has('spring-boot') ? 'mvn spring-boot:run' : 'mvn package');
      hint('test', 'Run the tests', 'mvn test');
    } else if (m.type === 'build.gradle') {
      hint('run', 'Run the application', has('spring-boot') ? './gradlew bootRun' : './gradlew build');
      hint('test', 'Run the tests', './gradlew test');
    } else if (m.type === 'go.mod') {
      hint('run', 'Run the program', 'go run .');
      hint('test', 'Run the tests', 'go test ./...');
    } else if (m.type === 'Cargo.toml') {
      hint('run', 'Run the program', 'cargo run');
      hint('test', 'Run the tests', 'cargo test');
    } else if (m.type === 'Gemfile') {
      hint('install', 'Install gems', 'bundle install');
      if (has('activerecord')) hint('run', 'Start the Rails server', 'bin/rails server');
    } else if (m.type === 'composer.json') {
      hint('install', 'Install PHP dependencies', 'composer install');
      if (m.deps.some((d) => d.name === 'laravel/framework')) hint('run', 'Start the development server', 'php artisan serve');
    } else if (m.type === 'csproj') {
      hint('run', 'Run the application', 'dotnet run');
      hint('test', 'Run the tests', 'dotnet test');
    }
  }
  const manage = a.files.find((f) => basename(f.path) === 'manage.py');
  if (manage) {
    add({ kind: 'other', label: 'Apply Django migrations', command: 'python manage.py migrate', cwd: cwdOf(manage.path), file: manage.path, line: 1, conf: 'heuristic' });
    add({ kind: 'run', label: 'Start the Django development server', command: 'python manage.py runserver', cwd: cwdOf(manage.path), file: manage.path, line: 1, conf: 'heuristic' });
    add({ kind: 'test', label: 'Run the Django tests', command: 'python manage.py test', cwd: cwdOf(manage.path), file: manage.path, line: 1, conf: 'heuristic' });
  } else if (has('pytest')) {
    const m = a.l0.manifests.find((x) => x.deps.some((d) => /^pytest$/i.test(d.name)));
    if (m) add({ kind: 'test', label: 'Run the tests', command: 'pytest', cwd: cwdOf(m.file), file: m.file, line: 1, conf: 'heuristic' });
  }
  // legacy PHP without Composer: the built-in server is the lowest-effort way to see it
  if (a.frameworks.some((f) => f.id === 'php-pages') && !a.l0.manifests.some((m) => m.type === 'composer.json')) {
    const idx = a.entries.find((e) => e.kind === 'main' && e.file.endsWith('.php'));
    if (idx) add({ kind: 'run', label: 'Serve the PHP scripts locally', command: 'php -S localhost:8000', file: idx.file, line: idx.line, conf: 'heuristic' });
  }

  // ---- Docker, compose, Makefile ----
  const dockerfiles = a.l0.configs.filter((c) => c.kind === 'docker');
  const ports: RunInfo['ports'] = [];
  for (const d of dockerfiles.slice(0, 2)) {
    const slug = (a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app');
    const dir = dirname(d.file);
    const expose = /^EXPOSE\s+(\d+)/m.exec(text(d.file));
    if (expose) ports.push({ port: Number(expose[1]), file: d.file, line: find(d.file, 'EXPOSE') });
    add({ kind: 'docker', label: 'Build the image', command: `docker build -t ${slug} ${dir ? `-f ${d.file} ` : ''}.`, file: d.file, line: 1, conf: 'heuristic' });
    add({ kind: 'docker', label: 'Run the container', command: `docker run --rm ${expose ? `-p ${expose[1]}:${expose[1]} ` : ''}${slug}`, file: d.file, line: find(d.file, 'CMD'), conf: 'heuristic' });
  }
  const compose = a.l0.configs.find((c) => c.kind === 'compose');
  if (compose) {
    add({ kind: 'docker', label: 'Start every service in the Compose stack', command: 'docker compose up', cwd: cwdOf(compose.file), file: compose.file, line: 1, conf: 'heuristic' });
    for (const m of text(compose.file).matchAll(/^\s+-\s*["']?(\d{2,5}):(\d{2,5})["']?\s*$/gm)) ports.push({ port: Number(m[1]), file: compose.file, line: lineOf(text(compose.file), m.index ?? 0) });
  }
  const make = a.l0.configs.find((c) => basename(c.file).toLowerCase() === 'makefile');
  if (make) {
    for (const m of text(make.file).matchAll(/^(install|setup|run|dev|start|serve|test|build|lint|migrate)\s*:/gm)) {
      const t = m[1];
      add({ kind: /test/.test(t) ? 'test' : /build/.test(t) ? 'build' : /install|setup/.test(t) ? 'install' : /lint|migrate/.test(t) ? 'other' : 'run', label: `Makefile target ${t}`, command: `make ${t}`, cwd: cwdOf(make.file), file: make.file, line: lineOf(text(make.file), m.index ?? 0), conf: 'resolved' });
    }
  }

  // ---- README: commands in code blocks under setup/run headings, copied verbatim ----
  const readme = a.l0.docs.filter((d) => d.kind === 'readme').sort((x, y) => x.file.length - y.file.length)[0];
  if (readme) {
    const lines = text(readme.file).split('\n');
    let inHead = false;
    let fence = false;
    lines.forEach((l, i) => {
      const h = /^#{1,6}\s+(.*)$/.exec(l);
      if (!fence && h) inHead = README_HEAD.test(h[1]);
      if (/^\s*```/.test(l)) {
        fence = !fence;
        return;
      }
      if (!fence || !inHead) return;
      const cmd = README_CMD.exec(l.trim())?.[1];
      if (cmd && cmd.length < 160) add({ kind: /test/.test(cmd) ? 'test' : /install|bundle|composer|pip/.test(cmd) ? 'install' : /build/.test(cmd) ? 'build' : /docker/.test(cmd) ? 'docker' : 'run', label: `From ${readme.file}`, command: cmd, file: readme.file, line: i + 1, conf: 'resolved' });
    });
  }

  // ---- environment variables ----
  const env: EnvVar[] = [];
  const isTemplate = (file: string) => /example|sample|template|dist/i.test(basename(file));
  // templates first, so their example values win over the bare names found in a real .env
  for (const c of a.l0.configs.filter((x) => x.kind === 'env').sort((x, y) => Number(isTemplate(y.file)) - Number(isTemplate(x.file)))) {
    const template = isTemplate(c.file);
    text(c.file).split('\n').forEach((l, i) => {
      const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l);
      if (!m || env.length >= MAX_ENV || env.some((e) => e.name === m[1])) return;
      env.push({ name: m[1], file: c.file, line: i + 1, example: template ? m[2].replace(/^["']|["']\s*$/g, '').slice(0, 80) || undefined : undefined });
    });
  }
  const portVar = env.find((e) => /^PORT$/.test(e.name) && e.example && /^\d{2,5}$/.test(e.example));
  if (portVar) ports.push({ port: Number(portVar.example), file: portVar.file, line: portVar.line });

  // ---- prerequisites ----
  const prerequisites: Claim[] = [];
  const dockerText = dockerfiles.map((d) => ({ file: d.file, text: text(d.file) }));
  const code = a.l0.languages.filter((l) => CODE_LANGS.has(l.lang) && l.loc > 0);
  const total = code.reduce((s, l) => s + l.loc, 0) || 1;
  const seenRuntime = new Set<string>();
  for (const l of code) {
    const r = RUNTIME[l.lang];
    if (!r || l.loc / total < 0.1 || seenRuntime.has(r.name)) continue;
    seenRuntime.add(r.name);
    const img = dockerText.map((d) => ({ d, m: r.image.exec(d.text) })).find((x) => x.m);
    const engines = r.name === 'Node.js' ? pkgs.map((m) => ({ m, v: /"node"\s*:\s*"([^"]+)"/.exec(text(m.file))?.[1] })).find((x) => x.v) : undefined;
    if (engines) prerequisites.push({ text: `Node.js ${engines.v} (engines in ${engines.m.file})`, conf: 'resolved', file: engines.m.file, line: find(engines.m.file, '"node"') });
    else if (img) prerequisites.push({ text: `${r.name}${img.m![1] ? ` ${img.m![1]}` : ''} (the Dockerfile builds on ${/^FROM\s+(\S+)/m.exec(img.d.text)![1]})`, conf: 'resolved', file: img.d.file, line: find(img.d.file, 'FROM') });
    else prerequisites.push({ text: `${r.name} (the version is not stated in the repository)`, conf: 'heuristic', file: a.l0.manifests[0]?.file, line: a.l0.manifests[0] ? 1 : undefined });
  }
  for (const t of a.l0.tech.filter((x) => x.category === 'database' || x.category === 'cache' || (x.category === 'queue' && x.id !== 'cron' && x.id !== 'celery' && x.id !== 'bull' && x.id !== 'sidekiq'))) {
    const key = t.id === 'postgres' ? /postgres|pg|database_url|datasource/i : t.id === 'mongodb' ? /mongo/i : t.id === 'redis' ? /redis/i : t.id === 'kafka' ? /kafka|broker/i : new RegExp(t.id, 'i');
    const via = env.find((e) => key.test(e.name));
    prerequisites.push({ text: `A reachable ${t.name} instance${via ? `, configured by ${via.name}` : ''}`, conf: 'resolved', file: t.evidence[0].file || undefined, line: t.evidence[0].file ? t.evidence[0].line : undefined });
  }

  // databases named in config (Prisma datasource, JDBC URL, Django ENGINE, mysqli) rather than in a dependency
  for (const d of declaredDatabases({ units })) {
    if (a.l0.tech.some((t) => t.name === d.name)) continue;
    prerequisites.push({ text: `A reachable ${d.name} instance`, conf: d.conf, file: d.ev.file, line: d.ev.line });
  }

  commands.sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
  return { prerequisites, commands, env, ports: ports.filter((p, i) => ports.findIndex((q) => q.port === p.port) === i).slice(0, 6) };
}
