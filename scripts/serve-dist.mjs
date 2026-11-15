// Serves dist/ exactly like the shipped vercel.json / _headers describe it.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const port = Number(process.argv[2] || 8788);

const cfg = JSON.parse(readFileSync(join(dist, 'vercel.json'), 'utf8'));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

function matchSource(source, pathname) {
  const rx = new RegExp('^' + source.replace(/\\\//g, '/').replace(/\(\.\*\)/g, '.*') + '$');
  return rx.test(pathname);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = join(dist, p);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');

  for (const rule of cfg.headers) {
    if (matchSource(rule.source, url.pathname)) {
      for (const h of rule.headers) res.setHeader(h.key, h.value);
    }
  }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, () => console.log('serving dist with COOP/COEP on http://localhost:' + port));
