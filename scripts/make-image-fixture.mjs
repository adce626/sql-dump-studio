/**
 * Generates test/fixtures/mysql-images.sql — a MySQL dump whose table stores
 * real PNG bytes in BLOB columns (one as a base64 data-URI inside TEXT).
 *
 * Run: node scripts/make-image-fixture.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'test', 'fixtures', 'mysql-images.sql');

/** Minimal PNG encoder (truecolour, 8 bit, no filtering). */
function encodePng(width, height, painter) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = painter(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return crc ^ -1;
}

const signature = encodePng(180, 56, (x, y) => {
  const border = x < 3 || y < 3 || x > 176 || y > 52;
  if (border) return [12, 32, 66];
  const wave = Math.sin(x / 9) * 10;
  const t = (x + wave) / 180;
  return [Math.round(20 + t * 180), Math.round(90 + t * 120), Math.round(230 - t * 90)];
});

const avatar = encodePng(64, 64, (x, y) => {
  const dx = x - 32;
  const dy = y - 32;
  const d = Math.sqrt(dx * dx + dy * dy);
  return d < 28 ? [244, 114, 182] : [30, 41, 59];
});

/** A tiny but structurally valid PDF, so the "non image blob" column is realistic. */
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

const sqlHex = (buf) => buf.toString('hex').toUpperCase().match(/.{1,32}/g).join('\n  ');

/** A real (tiny) JPEG — used to check that the download keeps the true format. */
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAB' +
    'AAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF' +
    'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
    'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6' +
    'ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEB' +
    'AQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoE' +
    'IFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp' +
    'anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna' +
    '4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64',
);

const sql = `-- SQL Dump Studio — image fixture
-- A table that stores real PNG bytes in BLOB columns (one as a base64 data-URI inside TEXT).
-- Two columns keep the original file name inside the column name ("*.img", "*.jpg").
DROP TABLE IF EXISTS \`employees\`;
CREATE TABLE \`employees\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`full_name\` varchar(80) NOT NULL,
  \`email\` varchar(120) DEFAULT NULL,
  \`signature_png\` longblob DEFAULT NULL,
  \`avatar_png\` blob DEFAULT NULL,
  \`signature_data_uri\` text DEFAULT NULL,
  \`resume_pdf\` longblob DEFAULT NULL,
  \`residence_card_front.img\` longblob DEFAULT NULL,
  \`passport_scan.jpg\` longblob DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_email\` (\`email\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO \`employees\` (\`id\`, \`full_name\`, \`email\`, \`signature_png\`, \`avatar_png\`, \`signature_data_uri\`, \`resume_pdf\`, \`residence_card_front.img\`, \`passport_scan.jpg\`) VALUES
(1, 'سالم العتيبي', 'salem@example.com', X'
  ${sqlHex(signature)}
', X'
  ${sqlHex(avatar)}
', 'data:image/png;base64,${avatar.toString('base64')}', X'
  ${sqlHex(pdf)}
', X'
  ${sqlHex(signature)}
', X'
  ${sqlHex(jpeg)}
'),
(2, 'Nora Ahmed', 'nora@example.com', X'
  ${sqlHex(signature)}
', X'
  ${sqlHex(avatar)}
', NULL, NULL, X'
  ${sqlHex(jpeg)}
', NULL),
(3, 'خالد الشمري', 'khaled@example.com', NULL, NULL, NULL, NULL, NULL, NULL),
(4, 'Layla Hassan', 'layla@example.com', X'
  ${sqlHex(avatar)}
', X'
  ${sqlHex(signature)}
', NULL, NULL, NULL, X'
  ${sqlHex(jpeg)}
');

ALTER TABLE \`employees\` AUTO_INCREMENT = 5;
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sql, 'utf8');
console.log('wrote', out, '| signature', signature.length, 'bytes | avatar', avatar.length, 'bytes');
