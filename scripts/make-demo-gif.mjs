#!/usr/bin/env node
/**
 * Builds the animated demo GIF used in README.md.
 *
 * Usage:
 *   node scripts/make-demo-gif.mjs --src <frames-dir> --out docs/demo.gif \
 *        [--width 900] [--delay 700] [--colors 128]
 *
 * The frames are PNG screenshots of the running app. They are downscaled with a
 * box filter, quantized against ONE global palette (so the animation does not
 * flicker between frames) and written as a looping animated GIF.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
// gifenc ships a CommonJS build as "main"; the ESM build is used explicitly
// so the named exports work from an ES module.
import { GIFEncoder, quantize, applyPalette } from 'gifenc/dist/gifenc.esm.js';

function parseArgs(argv) {
  const args = { width: 900, delay: 700, colors: 128, src: '', out: 'docs/demo.gif' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--src') args.src = argv[++i];
    else if (key === '--out') args.out = argv[++i];
    else if (key === '--width') args.width = Number(argv[++i]);
    else if (key === '--delay') args.delay = Number(argv[++i]);
    else if (key === '--colors') args.colors = Number(argv[++i]);
  }
  return args;
}

/** Box-filter downscale of an RGBA buffer. */
function resize(data, width, height, targetWidth) {
  const scale = targetWidth / width;
  const targetHeight = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = width / targetWidth;
  const yRatio = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(height, Math.ceil((y + 1) * yRatio));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(width, Math.ceil((x + 1) * xRatio));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * width + sx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          a += data[i + 3];
          n += 1;
        }
      }
      const o = (y * targetWidth + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { data: out, width: targetWidth, height: targetHeight };
}

const args = parseArgs(process.argv.slice(2));
if (!args.src) {
  console.error('missing --src <frames-dir>');
  process.exit(1);
}

const srcDir = resolve(args.src);
const files = readdirSync(srcDir)
  .filter((name) => name.toLowerCase().endsWith('.png'))
  .sort();

if (files.length === 0) {
  console.error(`no PNG frames found in ${srcDir}`);
  process.exit(1);
}

console.log(`reading ${files.length} frames from ${srcDir}`);
const frames = files.map((name) => {
  const png = PNG.sync.read(readFileSync(join(srcDir, name)));
  const scaled = resize(png.data, png.width, png.height, args.width);
  console.log(`  ${name} ${png.width}x${png.height} -> ${scaled.width}x${scaled.height}`);
  return scaled;
});

/* One global palette built from a sample of every frame keeps the colors
   stable across the animation. */
const sampleStep = Math.max(1, Math.floor((frames[0].data.length / 4) / 4000));
const sample = Buffer.alloc(
  frames.length * Math.ceil((frames[0].data.length / 4) / sampleStep) * 4,
);
let offset = 0;
for (const frame of frames) {
  for (let i = 0; i < frame.data.length; i += 4 * sampleStep) {
    sample[offset] = frame.data[i];
    sample[offset + 1] = frame.data[i + 1];
    sample[offset + 2] = frame.data[i + 2];
    sample[offset + 3] = frame.data[i + 3];
    offset += 4;
  }
}
const palette = quantize(sample.subarray(0, offset), args.colors);

const gif = GIFEncoder();
for (const frame of frames) {
  const index = applyPalette(frame.data, palette);
  gif.writeFrame(index, frame.width, frame.height, {
    palette,
    delay: args.delay,
    repeat: 0,
  });
}
gif.finish();

const bytes = Buffer.from(gif.bytes());
const outPath = resolve(args.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);
console.log(
  `wrote ${basename(outPath)} — ${(bytes.length / 1024).toFixed(1)} KB, ` +
    `${frames.length} frames, ${args.width}px wide, ${args.delay}ms delay`,
);
