import { basename, extname } from '../util';

/** Languages with a tree-sitter grammar (L1). Value = grammar wasm name. */
export const GRAMMARS: Record<string, string> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyi': 'python',
  '.java': 'java',
  '.go': 'go',
  '.c': 'c', '.h': 'c',
  '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
  '.cs': 'c_sharp',
  '.php': 'php', '.phtml': 'php',
  '.rb': 'ruby', '.rake': 'ruby',
  '.rs': 'rust',
  '.kt': 'kotlin', '.kts': 'kotlin',
};

const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyi': 'python', '.java': 'java', '.go': 'go', '.c': 'c', '.h': 'c',
  '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
  '.cs': 'csharp', '.php': 'php', '.phtml': 'php', '.rb': 'ruby', '.rake': 'ruby', '.rs': 'rust',
  '.kt': 'kotlin', '.kts': 'kotlin', '.sql': 'sql',
  '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
  '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.xml': 'xml', '.md': 'markdown',
  '.mdx': 'markdown', '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.ps1': 'powershell',
  '.swift': 'swift', '.scala': 'scala', '.dart': 'dart', '.lua': 'lua', '.r': 'r', '.pl': 'perl',
  '.vue': 'vue', '.svelte': 'svelte', '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang',
  '.hs': 'haskell', '.clj': 'clojure', '.groovy': 'groovy', '.gradle': 'groovy', '.m': 'objc',
  '.mm': 'objc', '.proto': 'protobuf', '.graphql': 'graphql', '.gql': 'graphql', '.tf': 'terraform',
  '.prisma': 'prisma', '.erb': 'erb', '.ejs': 'ejs', '.hbs': 'handlebars', '.twig': 'twig',
  '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini', '.properties': 'properties', '.env': 'env',
  '.txt': 'text', '.rst': 'text', '.csproj': 'xml', '.sln': 'text', '.bat': 'batch', '.cmd': 'batch',
  '.zig': 'zig', '.nim': 'nim', '.jl': 'julia', '.fs': 'fsharp', '.vb': 'vb', '.asm': 'asm', '.s': 'asm',
  '.cshtml': 'razor', '.razor': 'razor', '.jsp': 'jsp', '.blade.php': 'php',
};

const NAME_LANG: Record<string, string> = {
  dockerfile: 'docker', makefile: 'make', gemfile: 'ruby', rakefile: 'ruby', jenkinsfile: 'groovy',
  'cmakelists.txt': 'cmake', procfile: 'text', vagrantfile: 'ruby', pipfile: 'toml',
};

/** Languages that count as source code (for LOC stats, role inference, health). */
export const CODE_LANGS = new Set([
  'typescript', 'javascript', 'python', 'java', 'go', 'c', 'cpp', 'csharp', 'php', 'ruby', 'rust',
  'kotlin', 'sql', 'swift', 'scala', 'dart', 'lua', 'r', 'perl', 'vue', 'svelte', 'elixir', 'erlang',
  'haskell', 'clojure', 'groovy', 'objc', 'shell', 'powershell', 'zig', 'nim', 'julia', 'fsharp', 'vb',
]);

export function detectLanguage(path: string): string {
  const base = basename(path).toLowerCase();
  if (NAME_LANG[base]) return NAME_LANG[base];
  if (base.startsWith('dockerfile')) return 'docker';
  if (base.startsWith('.env')) return 'env';
  const ext = extname(path);
  return EXT_LANG[ext] ?? (ext ? 'other' : 'text');
}

export function grammarFor(path: string): string | null {
  return GRAMMARS[extname(path)] ?? null;
}

export function isTsJs(path: string): boolean {
  return /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/.test(path);
}

const TEST_RE = /(^|\/)(tests?|__tests__|spec|specs|e2e|__mocks__|testdata|fixtures)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb)$|Tests?\.(java|cs|kt)$|_spec\.rb$/;
export function isTestPath(path: string): boolean {
  return TEST_RE.test(path);
}
