#!/usr/bin/env node
/**
 * Serves `dist/` under a sub-path, the way GitHub Pages serves this project at
 * `https://<user>.github.io/MkwTrackEditor/`.
 *
 * A site that works at `/` can still be broken at `/MkwTrackEditor/` — every asset URL has to go
 * through `import.meta.env.BASE_URL`, and one hard-coded leading slash is enough to break it.
 * This makes that failure reproducible locally.
 *
 *   GITHUB_PAGES=1 npx vite build
 *   node scripts/serve-subpath.mjs --port 5199 --base /MkwTrackEditor/
 *   # then open http://127.0.0.1:5199/MkwTrackEditor/
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const port = Number(readArg('--port', '5199'));
let base = readArg('--base', '/MkwTrackEditor/');
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base = `${base}/`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.szs': 'application/octet-stream',
  '.u8': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

if (!existsSync(DIST)) {
  console.error(`No build found at ${DIST}. Run: GITHUB_PAGES=1 npx vite build`);
  process.exit(2);
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // Anything outside the base path is a 404, exactly as GitHub Pages would serve it.
  if (!pathname.startsWith(base)) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end(`Not found. This site is served at ${base}\n`);
    return;
  }
  pathname = pathname.slice(base.length - 1);

  let file = join(DIST, pathname);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  // A single-page app: unknown routes fall back to index.html.
  if (!existsSync(file)) file = join(DIST, 'index.html');

  response.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${DIST} at http://127.0.0.1:${port}${base}`);
});
