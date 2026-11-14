import type { Dialect } from '../protocol';

export type SqlValue = string | number | null | Uint8Array;

const MYSQL_ESCAPES: Record<string, string> = {
  '0': '\0',
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  Z: '\x1a',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '%': '\\%',
  _: '\\_',
};

function decodeOctal(body: string, start: number): [string, number] {
  let out = '';
  let i = start;
  while (i < body.length && out.length < 3 && body[i] >= '0' && body[i] <= '7') {
    out += body[i];
    i++;
  }
  return [String.fromCharCode(parseInt(out.padStart(3, '0'), 8)), i];
}

function decodeHex(body: string, start: number, len: number): [string, number] {
  const hex = body.slice(start, start + len);
  return [String.fromCharCode(parseInt(hex, 16)), start + len];
}

/** Decodes the content of a string literal (without the surrounding quotes). */
export function decodeStringBody(body: string, dialect: Dialect, pgEscape = false): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '\\') {
      const next = body[i + 1];
      if (next === undefined) {
        out += c;
        i++;
        continue;
      }
      if (pgEscape) {
        if (next >= '0' && next <= '7') {
          const [text, next2] = decodeOctal(body, i + 1);
          out += text;
          i = next2;
          continue;
        }
        if (next === 'x') {
          const [text, next2] = decodeHex(body, i + 2, 2);
          out += text;
          i = next2;
          continue;
        }
        if (next === 'u') {
          const [text, next2] = decodeHex(body, i + 2, 4);
          out += text;
          i = next2;
          continue;
        }
        if (next === '\n') {
          i += 2;
          continue;
        }
        out += next;
        i += 2;
        continue;
      }
      if (dialect === 'mysql') {
        const mapped = MYSQL_ESCAPES[next];
        if (mapped !== undefined) {
          out += mapped === '\\%' || mapped === '\\_' ? next : mapped;
          i += 2;
          continue;
        }
        out += next;
        i += 2;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (c === "'" && body[i + 1] === "'") {
      out += "'";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Normalises date/timestamp literals so that lexical sorting matches chronology. */
export function normalizeDate(input: string): string {
  const s = input.trim();
  if (!s) return input;
  let m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/.exec(s);
  if (m) {
    const iso = `${m[1]}T${m[2]}${m[3] ?? ''}`;
    const t = Date.parse(iso + (m[4] === 'Z' ? 'Z' : m[4]));
    if (!Number.isNaN(t)) return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(s);
  if (m) return `${m[1]}T${m[2]}${m[3] ?? ''}`;
  m = /^(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m) return m[1];
  return input;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/** Parses a single literal from an INSERT VALUES list. */
export function parseValue(raw: string, dialect: Dialect): SqlValue {
  const s = raw.trim();
  if (s === '') return null;

  const upper = s.toUpperCase();

  if (upper === 'NULL') return null;
  if (upper === 'TRUE') return 1;
  if (upper === 'FALSE') return 0;
  if (upper === 'DEFAULT') return null;

  // Character-set introducers: _utf8mb4'x', _binary'x'
  const introducer = /^_[A-Za-z0-9]+('[\s\S]*')$/.exec(s);
  if (introducer) {
    const body = introducer[1];
    return decodeStringBody(body.slice(1, -1), dialect);
  }

  if (/^0x[0-9a-fA-F]+$/.test(s)) return hexToBytes(s.slice(2));
  // Hex literals are allowed to contain whitespace (mysqldump wraps long blobs).
  if (/^X'[\s0-9a-fA-F]*'$/i.test(s)) return hexToBytes(s.slice(2, -1));
  if (/^B'[01]*'$/i.test(s)) {
    const bits = s.slice(2, -1);
    if (bits === '') return 0;
    return parseInt(bits, 2);
  }

  if (/^E'/i.test(s)) {
    const body = s.slice(2, s.length - 1);
    return decodeStringBody(body, dialect, true);
  }
  if (/^N'/i.test(s)) {
    return decodeStringBody(s.slice(2, s.length - 1), dialect);
  }

  if (s[0] === "'") {
    const body = s.slice(1, s.endsWith("'") ? -1 : undefined);
    return decodeStringBody(body, dialect);
  }
  if (s[0] === '"') {
    const body = s.slice(1, s.endsWith('"') ? -1 : undefined);
    return decodeStringBody(body, dialect);
  }
  if (s[0] === '`') {
    return s.slice(1, s.endsWith('`') ? -1 : undefined);
  }

  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }

  // Function calls / expressions such as NOW() or CURRENT_TIMESTAMP
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|LOCALTIME|LOCALTIMESTAMP|NOW\s*\(|UUID\s*\(|SYSDATE\s*\()/i.test(s)) {
    if (/^CURRENT_TIMESTAMP/i.test(s)) return normalizeDate(new Date().toISOString());
    if (/^CURRENT_DATE/i.test(s)) return new Date().toISOString().slice(0, 10);
    if (/^NOW\s*\(/i.test(s)) return normalizeDate(new Date().toISOString());
    return s;
  }

  return s;
}
