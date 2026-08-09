// Stage the server for packaging: compiled JS plus production dependencies
// only. The full node_modules is ~53MB, mostly tsx/esbuild/typescript that the
// shipped app never runs.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'bundle');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

execSync('npm run build', { cwd: root, stdio: 'inherit' });
cpSync(join(root, 'dist'), out, { recursive: true });

// A minimal manifest so `npm install --omit=dev` pulls only what runs.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module', dependencies: pkg.dependencies }, null, 2),
);
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
console.log(`\nbundled -> ${out}`);
