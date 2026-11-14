import { readQuotedIdent, skipParens, splitTopLevel } from './lex';

export interface ParsedInsert {
  table: string;
  schema: string | null;
  /** Explicit column list, or null when the statement relies on the DDL order. */
  columns: string[] | null;
  rows: string[][];
}

function isSpace(c: string) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function skipWs(s: string, i: number) {
  while (i < s.length && isSpace(s[i])) i++;
  return i;
}

/** Parses an `INSERT INTO ... VALUES (...), (...)` statement. */
export function parseInsert(stmt: string): ParsedInsert | null {
  const m = /^\s*(?:INSERT|REPLACE)\s+(?:(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY)\s+)?(?:IGNORE\s+)?INTO\s+/i.exec(
    stmt,
  );
  if (!m) return null;

  let i = m[0].length;
  const tableIdent = readQualifiedIdent(stmt, i);
  if (!tableIdent.name) return null;
  i = tableIdent.end;

  // MySQL: INSERT INTO t PARTITION (p1) VALUES ...
  const partMatch = /^\s*PARTITION\s*\(/i.exec(stmt.slice(i));
  if (partMatch) {
    const open = i + partMatch[0].length - 1;
    i = skipParens(stmt, open);
  }

  let columns: string[] | null = null;
  const j = skipWs(stmt, i);
  if (stmt[j] === '(') {
    const end = skipParens(stmt, j);
    columns = splitTopLevel(stmt.slice(j + 1, end - 1), ',')
      .map((p) => readQuotedIdent(p.trim(), 0).word)
      .filter(Boolean);
    i = end;
  }

  const valuesMatch = /^\s*VALUES?\b/i.exec(stmt.slice(i));
  if (!valuesMatch) return null;
  i = skipWs(stmt, i + valuesMatch[0].length);

  const rows: string[][] = [];
  for (;;) {
    const k = skipWs(stmt, i);
    if (stmt[k] !== '(') break;
    const end = skipParens(stmt, k);
    const inner = stmt.slice(k + 1, end - 1);
    rows.push(splitTopLevel(inner, ','));
    i = end;
    const m2 = skipWs(stmt, i);
    if (stmt[m2] === ',') {
      i = m2 + 1;
      continue;
    }
    break;
  }

  if (rows.length === 0) return null;
  return { table: tableIdent.name, schema: tableIdent.schema, columns, rows };
}

function readQualifiedIdent(s: string, i: number): { schema: string | null; name: string; end: number } {
  const first = readQuotedIdent(s, i);
  if (!first.word) return { schema: null, name: '', end: i };
  let end = first.end;
  let schema: string | null = null;
  let name = first.word;
  const dot = skipWs(s, end);
  if (s[dot] === '.') {
    const second = readQuotedIdent(s, dot + 1);
    if (second.word) {
      schema = name;
      name = second.word;
      end = second.end;
    }
  }
  return { schema, name, end };
}

/** Parses a PostgreSQL `COPY ... FROM stdin` payload block. */
export function parseCopyPayload(payload: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of payload.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    const values: string[] = [];
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '\\') {
        const next = line[i + 1];
        switch (next) {
          case 't':
            current += '\t';
            i++;
            break;
          case 'n':
            current += '\n';
            i++;
            break;
          case 'r':
            current += '\r';
            i++;
            break;
          case 'b':
            current += '\b';
            i++;
            break;
          case 'f':
            current += '\f';
            i++;
            break;
          case 'v':
            current += '\v';
            i++;
            break;
          case '\\':
            current += '\\';
            i++;
            break;
          case 'N':
            current += '\\N';
            i++;
            break;
          default:
            current += next ?? '';
            i++;
            break;
        }
        continue;
      }
      if (c === '\t') {
        values.push(current);
        current = '';
        continue;
      }
      current += c;
    }
    values.push(current);
    rows.push(values);
  }
  return rows;
}
