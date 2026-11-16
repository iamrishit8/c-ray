// Single-pass, language-agnostic line scanner: LOC, TODOs, security smells,
// statically-unresolvable constructs and line hashes for clone detection.
import type { FileScan, FindingCat, Finding, Unresolved } from './types';
import { hash32 } from './util';

const COMMENT_START = /^\s*(\/\/|#(?!include|define|if|endif|pragma|!\[)|\/\*|\*|--|<!--|;;|"""|''')/;
const TODO_RE = /(?:\/\/|#|\/\*|\*|--|<!--|;)\s*.*?\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)$/;

const TOKEN_SECRETS: [RegExp, string][] = [
  [/\bAKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bsk_live_[0-9a-zA-Z]{16,}/, 'Stripe live key'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'Google API key'],
];
const ASSIGN_SECRET = /(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key)[A-Za-z0-9_]*["']?\s*(?::|=>|=)\s*["']([^"'\s]{8,})["']/i;
const PROP_SECRET = /^\s*([\w.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)[\w.-]*)\s*[=:]\s*([^\s"'#]{6,})\s*$/i;
const PLACEHOLDER = /example|changeme|change_me|placeholder|your[_-]|xxxx|<[^>]+>|\$\{|\{\{|process\.env|os\.environ|getenv|dummy|redacted|\*{4,}|^(true|false|null|none|undefined)$/i;

const EVAL_RE = /(^|[^.\w$])(eval|exec)\s*\(|new\s+Function\s*\(/;
const SQL_CONCAT_RE = /["'`].*\b(SELECT\b.+\bFROM|INSERT\s+INTO|UPDATE\b.+\bSET|DELETE\s+FROM)\b.*["']\s*(?:\+|\.(?![\w.]))\s*[$\w(]/i;
const SQL_INTERP_RE = /(?:`[^`]*\b(?:SELECT\b[^`]+\bFROM|INSERT\s+INTO|UPDATE\b[^`]+\bSET|DELETE\s+FROM)\b[^`]*\$\{)|(?:\bf["'][^"']*\b(?:SELECT\b.+\bFROM|INSERT\s+INTO|UPDATE\b.+\bSET|DELETE\s+FROM)\b[^"']*\{)|(?:["'][^"']*\b(?:SELECT\b.+\bFROM|INSERT\s+INTO|DELETE\s+FROM)\b[^"']*["']\s*(?:%\s*[\w(]|\.format\())/i;
const TLS_RE = /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*['"\]]*\s*=\s*['"]?0|\bverify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*(?:false|0)|ssl_verify\w*\s*[=:]\s*false|VERIFY_NONE|check_hostname\s*=\s*False|ServerCertificateValidationCallback\s*[+=]+.*true|TrustAllCert|ALLOW_ALL_HOSTNAME_VERIFIER/i;

type UPat = [RegExp, Unresolved['kind'], string];
const UNRESOLVED: Record<string, UPat[]> = {
  js: [
    [/\bimport\s*\(\s*(?!["'`][^"'`$]*["'`]\s*\))/, 'dynamic-import', 'import() with a non-literal argument'],
    [/\brequire\s*\(\s*(?!["'`][^"'`$]*["'`]\s*\))[^)]/, 'dynamic-import', 'require() with a non-literal argument'],
    [/\b(?:container|injector|moduleRef|app)\.(?:get|resolve)\s*[<(]/, 'di', 'DI container lookup'],
    [/\bReflect\.(?:getMetadata|construct|apply)\b/, 'reflection', 'Reflect API'],
    [/[\w\])]\[[A-Za-z_$][\w$.]*\]\s*\(/, 'dynamic-call', 'computed member call'],
  ],
  python: [
    [/\bimportlib\.import_module\s*\(|\b__import__\s*\(/, 'dynamic-import', 'dynamic import'],
    [/\bgetattr\s*\(/, 'reflection', 'getattr()'],
    [/\bglobals\(\)\[|\blocals\(\)\[/, 'reflection', 'globals()/locals() lookup'],
  ],
  java: [
    [/\bClass\.forName\s*\(/, 'reflection', 'Class.forName'],
    [/\.getMethod\s*\(|\.getDeclaredMethod\s*\(|\.newInstance\s*\(/, 'reflection', 'reflection call'],
    [/\.getBean\s*\(/, 'di', 'Spring getBean()'],
  ],
  kotlin: [
    [/\bClass\.forName\s*\(|::class\.java\.getMethod/, 'reflection', 'reflection'],
    [/\.getBean\s*\(/, 'di', 'getBean()'],
  ],
  php: [
    [/\b(?:include|require)(?:_once)?\s*\(?\s*\$\w+\s*\)?\s*;/, 'dynamic-include', 'include of a variable path'],
    [/\bcall_user_func(?:_array)?\s*\(/, 'dynamic-call', 'call_user_func'],
    [/\bnew\s+\$\w+/, 'reflection', 'class instantiated from a variable'],
    [/\$\$\w+/, 'reflection', 'variable variable'],
    [/->make\s*\(|\bapp\s*\(\s*['"\w]/, 'di', 'container lookup'],
  ],
  ruby: [
    [/\.(?:send|public_send|__send__)\s*[( ]/, 'dynamic-call', 'send()'],
    [/\.constantize\b|\bconst_get\s*\(/, 'reflection', 'constant lookup by name'],
    [/\bdefine_method\b|\bmethod_missing\b/, 'reflection', 'metaprogramming'],
  ],
  go: [
    [/\breflect\.\w+\s*\(/, 'reflection', 'reflect package'],
    [/\bplugin\.Open\s*\(/, 'dynamic-import', 'plugin.Open'],
  ],
  csharp: [
    [/\bActivator\.CreateInstance\b|\.GetMethod\s*\(|\bType\.GetType\s*\(|\.Invoke\s*\(/, 'reflection', 'reflection'],
    [/\.GetService\s*[<(]|\.GetRequiredService\s*[<(]/, 'di', 'service locator'],
  ],
  c: [[/\bdlopen\s*\(|\bdlsym\s*\(/, 'dynamic-import', 'dlopen/dlsym']],
  rust: [[/\blibloading::|\bdlopen\b/, 'dynamic-import', 'dynamic library loading']],
};
UNRESOLVED.typescript = UNRESOLVED.javascript = UNRESOLVED.js;
UNRESOLVED.cpp = UNRESOLVED.c;

const IMPORTISH = /^\s*(import\b|from\s+\S+\s+import\b|export\s+\*|export\s+\{[^}]*\}\s+from|using\s+[\w.]+;|#include\b|package\s+[\w.]+|use\s+[\w\\:{}, ]+;|require(?:_once|_relative)?\b|(?:const|let|var)\s+[\w{}, :$]+=\s*require\()/;
const TOKEN_RE = /[A-Za-z_$][\w$]*|\d[\w.]*|[^\s\w]/g;

const KEY_VALUE_LANGS = new Set(['properties', 'env', 'ini', 'yaml', 'toml']);
const EVAL_LANGS = new Set(['javascript', 'typescript', 'python', 'php', 'ruby', 'vue', 'svelte']);

export function scanFile(text: string, lang: string, path = ''): FileScan {
  const out: FileScan = { loc: 0, sloc: 0, todos: [], smells: [], unresolved: [], lineHashes: [] };
  if (!text) return out;
  const lines = text.split('\n');
  out.loc = lines.length - (text.endsWith('\n') ? 1 : 0);
  const upats = UNRESOLVED[lang];
  const isExample = /\.(example|sample|template|dist)$|example|sample/i.test(path.slice(path.lastIndexOf('/') + 1));
  const kv = KEY_VALUE_LANGS.has(lang);
  const smell = (line: number, cat: FindingCat, msg: string, sev: Finding['sev']) => out.smells.push({ line, cat, msg, sev });
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > 2000) continue; // data blobs: nothing useful, and regexes get slow
    const line = raw.trim();
    if (!line) continue;
    const n = i + 1;

    // comment tracking (approximate; good enough for SLOC)
    let isComment = false;
    if (inBlock) {
      isComment = true;
      if (line.includes('*/')) inBlock = false;
    } else if (COMMENT_START.test(line)) {
      isComment = true;
      if (line.startsWith('/*') && !line.includes('*/')) inBlock = true;
    }
    if (!isComment) out.sloc++;

    if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK') || line.includes('XXX')) {
      const m = TODO_RE.exec(line);
      if (m) out.todos.push({ line: n, tag: m[1], text: m[2].replace(/\*\/\s*$|-->\s*$/, '').trim().slice(0, 160) });
    }
    if (isComment) continue;

    // --- security smells ---
    if (!isExample) {
      let secret = false;
      for (const [re, label] of TOKEN_SECRETS) {
        if (re.test(line)) {
          smell(n, 'secret', `Possible hardcoded ${label}`, 'high');
          secret = true;
          break;
        }
      }
      if (!secret) {
        const m = ASSIGN_SECRET.exec(line);
        if (m && !PLACEHOLDER.test(m[2]) && !/^(.)\1+$/.test(m[2]) && m[2].toLowerCase() !== m[1].toLowerCase()) {
          smell(n, 'secret', `Possible hardcoded secret assigned to "${m[1]}…"`, 'high');
        } else if (kv) {
          const p = PROP_SECRET.exec(line);
          if (p && !PLACEHOLDER.test(p[2])) smell(n, 'secret', `Possible hardcoded secret in config key "${p[1]}"`, 'high');
        }
      }
    }
    if (EVAL_LANGS.has(lang) && EVAL_RE.test(line) && !/\.exec\s*\(/.test(line)) {
      smell(n, 'eval', 'Dynamic code execution (eval / exec / new Function)', 'medium');
      out.unresolved.push({ line: n, kind: 'eval', detail: 'dynamic code execution' });
    }
    if (SQL_CONCAT_RE.test(line) || SQL_INTERP_RE.test(line)) {
      smell(n, 'sql-concat', 'SQL statement built with string concatenation or interpolation', 'medium');
    }
    if (TLS_RE.test(line)) smell(n, 'tls-disabled', 'TLS certificate verification appears to be disabled', 'high');

    if (upats) {
      for (const [re, kind, detail] of upats) {
        if (re.test(line)) {
          out.unresolved.push({ line: n, kind, detail: `${detail}: ${line.slice(0, 120)}` });
          break;
        }
      }
    }

    // --- clone-detection line hash ---
    if (!IMPORTISH.test(line)) {
      const norm = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, 'S');
      const toks = norm.match(TOKEN_RE);
      if (toks && toks.length >= 3 && /[A-Za-z]/.test(norm)) {
        out.lineHashes.push(hash32(toks.join(' ')), n, toks.length);
      }
    }
  }
  return out;
}
