// Packs the production build (dist/) into a release ZIP.
// The archive contains the built site at its root (index.html, assets/, fonts/, ...)
// so it can be uploaded to any static host or published with `npx vercel --prod`.
//
//   node scripts/make-release-zip.mjs [--out sql-dump-studio-v1.0.0.zip]
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const outArg = process.argv.indexOf('--out');
const outName = outArg > -1 ? process.argv[outArg + 1] : 'sql-dump-studio.zip';
const outDir = join(root, 'release');
const outFile = join(outDir, outName);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist);
if (!files.length) {
  console.error('dist/ is empty - run "npm run build" first');
  process.exit(1);
}

const entries = {};
for (const file of files) {
  // forward slashes, no leading folder - the archive root IS the site root
  const name = relative(dist, file).split(sep).join('/');
  entries[name] = new Uint8Array(readFileSync(file));
}

mkdirSync(outDir, { recursive: true });
const zipped = zipSync(entries, { level: 9 });
writeFileSync(outFile, zipped);

console.log(`${outName}  ${(zipped.length / 1024).toFixed(1)} KB  (${files.length} files)`);
console.log(outFile);
