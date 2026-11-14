// Downloads the Google Fonts woff2 files referenced by public/fonts/fonts.css
// and rewrites the CSS to point at the local copies (self-hosted = offline + no CSP issues).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, '..', 'public', 'fonts');
const cssPath = join(fontsDir, 'fonts.css');

if (!existsSync(cssPath)) {
  console.error('fonts.css not found - fetch it first');
  process.exit(1);
}
mkdirSync(fontsDir, { recursive: true });

let css = readFileSync(cssPath, 'utf8');
const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((m) => m[1]))];

for (const url of urls) {
  const name = url.split('/').slice(-3).join('-');
  const out = join(fontsDir, name);
  if (!existsSync(out)) {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.error('failed', url, res.status);
      continue;
    }
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log('saved', name);
  }
  css = css.split(url).join(`/fonts/${name}`);
}

writeFileSync(cssPath, css);
console.log('fonts.css rewritten ->', cssPath);
