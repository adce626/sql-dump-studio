// Copies the static-hosting helper files into the production bundle so the
// published folder is self-contained:
//   deploy/_headers   -> dist/_headers    (Netlify / Cloudflare Pages)
//   deploy/vercel.json-> dist/vercel.json (Vercel)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('dist/ not found - run vite build first');
  process.exit(1);
}

mkdirSync(dist, { recursive: true });

for (const name of ['_headers', 'vercel.json']) {
  const from = join(root, 'deploy', name);
  if (existsSync(from)) {
    cpSync(from, join(dist, name));
    console.log(`copied deploy/${name} -> dist/${name}`);
  }
}
