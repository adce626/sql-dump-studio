import type { Affinity, Dialect } from '../protocol';

/* ------------------------------------------------------------------ *
 * Dialect detection
 * ------------------------------------------------------------------ */
export function detectDialect(sample: string): Dialect {
  const s = sample.slice(0, 200_000);
  if (/\/\*!\d{4,5}/.test(s) || /\bAUTO_INCREMENT\b/i.test(s) || /\bENGINE\s*=/i.test(s)) return 'mysql';
  if (/\bCOPY\s+[^\n]*FROM\s+stdin/i.test(s)) return 'postgres';
  if (/\bOWNER\s+TO\b/i.test(s) || /::\s*(text|jsonb|uuid|int|varchar)\b/i.test(s) || /\bSERIAL\b/i.test(s)) {
    return 'postgres';
  }
  if (/\[[A-Za-z_][\w]*\]\s*\./.test(s) || /\bNVARCHAR\b/i.test(s) || /\bGETDATE\s*\(/i.test(s)) return 'mssql';
  if (/\bAUTOINCREMENT\b/i.test(s) || /\bPRAGMA\b/i.test(s)) return 'sqlite';
  if (/`[A-Za-z_][\w]*`\s*\(/i.test(s) && /,\s*\n\s*`/i.test(s)) return 'mysql';
  return 'generic';
}

/* ------------------------------------------------------------------ *
 * Encoding detection
 * ------------------------------------------------------------------ */
export interface EncodingGuess {
  encoding: string;
  confident: boolean;
}

export function guessEncoding(bytes: Uint8Array): EncodingGuess {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', confident: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', confident: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', confident: true };
  }

  const probe = bytes.subarray(0, Math.min(bytes.length, 128 * 1024));
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(probe);
    return { encoding: 'utf-8', confident: true };
  } catch {
    /* not valid utf-8 */
  }

  // UTF-16 without BOM: lots of zero bytes in odd/even positions.
  let evenZeros = 0;
  let oddZeros = 0;
  const limit = Math.min(probe.length, 4096);
  for (let i = 0; i < limit; i++) {
    if (probe[i] === 0) {
      if (i % 2 === 0) evenZeros++;
      else oddZeros++;
    }
  }
  if (oddZeros > limit / 8 && oddZeros > evenZeros * 4) {
    return { encoding: 'utf-16le', confident: true };
  }
  if (evenZeros > limit / 8 && evenZeros > oddZeros * 4) {
    return { encoding: 'utf-16be', confident: true };
  }
  return { encoding: 'windows-1252', confident: false };
}

/* ------------------------------------------------------------------ *
 * Type -> SQLite affinity
 * ------------------------------------------------------------------ */
const INT_TYPES = /^(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8|serial|smallserial|bigserial|year|bit|bool|boolean|int_identity|tinyint_identity|smallint_identity|mediumint_identity|int_identity|bigint_identity)\b/;
const REAL_TYPES = /^(decimal|numeric|dec|float|double|double\s+precision|real|money|smallmoney|float4|float8)\b/;
const TEXT_TYPES = /^(char|varchar|nchar|nvarchar|varchar2|text|tinytext|mediumtext|longtext|ntext|character|character\s+varying|varying|string|uuid|guid|json|jsonb|xml|enum|set|citext|clob|name|label|inet|cidr|macaddr|tsvector|tsquery|bytea_text|xmltype)\b/;
const DATE_TYPES = /^(date|datetime|datetime2|timestamp|timestamptz|smalldatetime|time|timetz|datetimeoffset|year_date)\b/;
const BLOB_TYPES = /^(blob|binary|varbinary|tinyblob|mediumblob|longblob|bytea|image|raw|longraw|bytes)\b/;

export function mapAffinity(type: string): Affinity {
  const t = (type || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return 'TEXT';
  const base = t.replace(/\(.*$/, '').trim();
  if (INT_TYPES.test(base)) return 'INTEGER';
  if (REAL_TYPES.test(base)) return 'REAL';
  if (BLOB_TYPES.test(base)) return 'BLOB';
  if (DATE_TYPES.test(base)) return 'TEXT';
  if (TEXT_TYPES.test(base)) return 'TEXT';
  if (/^(bit|binary)\b/.test(base)) return 'BLOB';
  return 'TEXT';
}

/** Heuristic: does this column look like it holds a date/timestamp? */
export function looksLikeDate(type: string): boolean {
  return DATE_TYPES.test((type || '').toLowerCase().replace(/\(.*$/, '').trim());
}
