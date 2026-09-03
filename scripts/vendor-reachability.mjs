#!/usr/bin/env node
/**
 * Reachability analysis over the vendored noclip renderer.
 *
 * `vendor/noclip.website/` is a trimmed in-tree fork, kept to exactly the transitive import
 * closure of `src/**` plus `LICENSE`. This recomputes that closure and reports any vendored file
 * nothing imports any more, so the fork does not silently re-accumulate dead weight.
 *
 * Roots are every `.ts`/`.tsx` under `src/` (product code, tests and test data all count — a
 * vendored parser used only by a round-trip test is still load bearing) plus every `.mjs` under
 * `scripts/`, which reach vendored modules through Vite's SSR loader.
 *
 * Usage:
 *   node scripts/vendor-reachability.mjs           # report
 *   node scripts/vendor-reachability.mjs --delete  # report, then delete the unreachable files
 */

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor/noclip.website/src');
const RUST_STUB = join(ROOT, 'src/noclipRustStub.ts');

function walk(dir, match, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(name)) out.push(full);
  }
  return out;
}

/** Every static and dynamic import specifier in a source file. */
function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g, // import ... from 'x' / export ... from 'x'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('x')
    /\bimport\s*['"]([^'"]+)['"]/g, // bare side-effect import 'x'
    /\bssrLoadModule\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // the batch/probe runners
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolves a specifier to an on-disk file, honouring noclip's `.js`-means-`.ts` convention. */
function resolveSpecifier(specifier, fromFile) {
  if (specifier === 'noclip-rust-support') return existsSync(RUST_STUB) ? RUST_STUB : null;

  let base;
  if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  // A root-relative specifier, which is how the Vite SSR runners name their entry modules.
  else if (specifier.startsWith('/')) base = join(ROOT, specifier);
  else return null; // a bare package specifier: node_modules, not our problem

  const candidates = [];
  if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base);
  else if (/\.tsx?$/.test(base)) candidates.push(base);
  else candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx'), base);

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const roots = [
  ...walk(join(ROOT, 'src'), (name) => /\.(ts|tsx)$/.test(name)),
  ...walk(join(ROOT, 'scripts'), (name) => /\.mjs$/.test(name)),
];

const seen = new Set();
const queue = [...roots];
const unresolved = new Map();

while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);

  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveSpecifier(specifier, file);
    if (resolved) {
      if (!seen.has(resolved)) queue.push(resolved);
    } else if (specifier.startsWith('.') || specifier.startsWith('/')) {
      // A relative specifier that does not resolve is a broken import, worth surfacing.
      if (!unresolved.has(file)) unresolved.set(file, []);
      unresolved.get(file).push(specifier);
    }
  }
}

const vendorFiles = walk(VENDOR, (name) => /\.(ts|tsx)$/.test(name));
const reachable = vendorFiles.filter((file) => seen.has(file));
const unreachable = vendorFiles.filter((file) => !seen.has(file));
const rel = (file) => relative(ROOT, file).split('\\').join(posix.sep);

console.log(`Vendored TypeScript files: ${vendorFiles.length}`);
console.log(`  reachable from src/ + scripts/: ${reachable.length}`);
console.log(`  unreachable:                    ${unreachable.length}`);

if (unresolved.size > 0) {
  console.log('');
  console.log('Imports that do not resolve to a file (broken, or an alias this script does not know):');
  for (const [file, specifiers] of unresolved) {
    console.log(`  ${rel(file)}`);
    for (const specifier of specifiers) console.log(`      ${specifier}`);
  }
}

if (unreachable.length > 0) {
  console.log('');
  console.log('Unreachable vendored files:');
  for (const file of unreachable) console.log(`  ${rel(file)}`);
}

if (process.argv.includes('--delete')) {
  for (const file of unreachable) unlinkSync(file);
  console.log('');
  console.log(`Deleted ${unreachable.length} unreachable vendored files.`);
}

process.exit(unresolved.size > 0 ? 2 : 0);
