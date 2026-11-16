// Copies tree-sitter grammars (WASM) and TypeScript lib .d.ts files into public/
// so the static site can lazy-load them at runtime and work offline.
import { cpSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'grammars');
mkdirSync(out, { recursive: true });
const langs = ['typescript', 'tsx', 'javascript', 'python', 'java', 'go', 'c', 'cpp', 'c_sharp', 'php', 'ruby', 'rust', 'kotlin'];
for (const l of langs) {
  cpSync(join(root, 'node_modules/tree-sitter-wasms/out', `tree-sitter-${l}.wasm`), join(out, `tree-sitter-${l}.wasm`));
}
cpSync(join(root, 'node_modules/web-tree-sitter/tree-sitter.wasm'), join(out, 'tree-sitter.wasm'));

// TypeScript default libs, bundled into one JSON so the L2 worker can type-check offline.
const libDir = join(root, 'node_modules/typescript/lib');
const wanted = readdirSync(libDir).filter((f) => /^lib\.(es5|es20(15|16|17|18|19|20)(\..+)?|decorators(\.legacy)?)\.d\.ts$/.test(f));
const libs = {};
for (const f of wanted) libs[f] = readFileSync(join(libDir, f), 'utf8');
mkdirSync(join(root, 'public', 'tslibs'), { recursive: true });
writeFileSync(join(root, 'public', 'tslibs', 'libs.json'), JSON.stringify(libs));
console.log(`copied ${langs.length} grammars, ${wanted.length} TS libs`);
