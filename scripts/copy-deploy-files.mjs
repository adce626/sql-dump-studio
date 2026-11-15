// Copies the static-hosting helper files into the production bundle so the
// published folder is self-contained:
//   deploy/_headers          -> dist/_headers          (Netlify / Cloudflare Pages)
//   deploy/vercel-static.json-> dist/vercel.json       (Vercel, prebuilt folder)
//   deploy/vercel.json       -> dist/vercel-source.json (Vercel, deploying from source)
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

const copies = [
  { from: join(root, 'deploy', '_headers'), to: join(dist, '_headers') },
  { from: join(root, 'deploy', 'vercel-static.json'), to: join(dist, 'vercel.json') },
  { from: join(root, 'deploy', 'vercel.json'), to: join(dist, 'vercel-source.json') },
];

for (const { from, to } of copies) {
  if (existsSync(from)) {
    cpSync(from, to);
    console.log(`copied ${from.replace(root + '\\', '')} -> ${to.replace(root + '\\', '')}`);
  }
}
