import type { Affinity } from '../protocol';
import { mapAffinity } from './dialect';
import { decodeStringBody } from './values';
import { readQuotedIdent, readWord, skipParens, skipQuoted, splitTopLevel } from './lex';

export interface ParsedColumn {
  name: string;
  type: string;
  affinity: Affinity;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  comment: string | null;
  ordinal: number;
}

export interface ParsedIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface ParsedForeignKey {
  constraint: string | null;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
}

export interface ParsedTable {
  name: string;
  schema: string | null;
  columns: ParsedColumn[];
  primaryKey: string[];
  indexes: ParsedIndex[];
  foreignKeys: ParsedForeignKey[];
  comment: string | null;
}

const ATTR = new Set([
  'NOT',
  'NULL',
  'DEFAULT',
  'AUTO_INCREMENT',
  'AUTOINCREMENT',
  'PRIMARY',
  'UNIQUE',
  'KEY',
  'COMMENT',
  'COLLATE',
  'GENERATED',
  'IDENTITY',
  'CHECK',
  'REFERENCES',
  'ON',
  'CONSTRAINT',
  'SRID',
  'ENFORCED',
  'AS',
  'STORED',
  'VIRTUAL',
  'INVISIBLE',
  'VISIBLE',
  'STORAGE',
  'CHARACTER',
]);

function isSpace(c: string) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function skipWs(s: string, i: number) {
  while (i < s.length && isSpace(s[i])) i++;
  return i;
}

function peekWord(s: string, i: number): string {
  const j = skipWs(s, i);
  const w = readWord(s, j);
  return w.word;
}

/** Reads one token: a quoted literal, a parenthesised group, a number or a word. */
function readToken(s: string, i: number): { text: string; end: number } {
  i = skipWs(s, i);
  if (i >= s.length) return { text: '', end: i };
  const c = s[i];
  if (c === '(') {
    const end = skipParens(s, i);
    return { text: s.slice(i, end), end };
  }
  if (c === "'" || c === '"') {
    const end = skipQuoted(s, i);
    return { text: s.slice(i, end), end };
  }
  if (c === '`') {
    const end = skipQuoted(s, i, false);
    return { text: s.slice(i, end), end };
  }
  const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
  if (num) return { text: num[0], end: i + num[0].length };
  const w = readWord(s, i);
  if (!w.word) return { text: s[i], end: i + 1 };
  // prefixed literal: N'x', E'x', b'1', x'ff'
  const after = skipWs(s, w.end);
  if ((s[after] === "'" || s[after] === '"') && w.word.length <= 2) {
    const end = skipQuoted(s, after);
    return { text: s.slice(i, end), end };
  }
  return { text: w.word, end: w.end };
}

function readExpression(s: string, i: number): { text: string; end: number } {
  i = skipWs(s, i);
  if (i >= s.length) return { text: '', end: i };
  const c = s[i];
  if (c === '(') {
    const end = skipParens(s, i);
    return { text: s.slice(i, end), end };
  }
  if (c === "'" || c === '"') {
    const end = skipQuoted(s, i);
    return { text: s.slice(i, end), end };
  }
  const parts: string[] = [];
  let j = i;
  while (j < s.length) {
    const t = readToken(s, j);
    if (!t.text) break;
    const up = t.text.toUpperCase();
    if (parts.length > 0 && ATTR.has(up)) break;
    parts.push(t.text);
    j = t.end;
    if (t.text.endsWith(')')) break;
  }
  return { text: parts.join(' '), end: j };
}

function readFkAction(s: string, i: number): { action: string; end: number } {
  i = skipWs(s, i);
  const w = readWord(s, i);
  const up = w.word.toUpperCase();
  if (up === 'SET') {
    const nw = readWord(s, skipWs(s, w.end));
    if (nw.word.toUpperCase() === 'NULL' || nw.word.toUpperCase() === 'DEFAULT') {
      return { action: `SET ${nw.word.toUpperCase()}`, end: nw.end };
    }
    return { action: 'SET', end: w.end };
  }
  if (up === 'NO') {
    const nw = readWord(s, skipWs(s, w.end));
    if (nw.word.toUpperCase() === 'ACTION') return { action: 'NO ACTION', end: nw.end };
    return { action: 'NO', end: w.end };
  }
  if (up) return { action: up, end: w.end };
  return { action: '', end: i };
}

function extractIndexColumn(part: string): string {
  let p = part.trim();
  const m = /^(?:`([^`]+)`|\[([^\]]+)\]|"([^"]+)"|([A-Za-z_][\w$]*))/.exec(p);
  if (m) return m[1] ?? m[2] ?? m[3] ?? m[4] ?? p;
  const any = /[A-Za-z_][\w$]*/.exec(p);
  return any ? any[0] : p;
}

function parseIndexColumns(text: string): string[] {
  const open = text.indexOf('(');
  if (open === -1) return [];
  const end = skipParens(text, open);
  const inner = text.slice(open + 1, end - 1);
  return splitTopLevel(inner, ',')
    .map((p) => extractIndexColumn(p))
    .filter(Boolean);
}

export function parseColumnDefinition(def: string, ordinal: number): ParsedColumn | null {
  let i = skipWs(def, 0);
  if (i >= def.length) return null;
  const ident = readQuotedIdent(def, i);
  if (!ident.word) return null;
  const name = ident.word;
  i = ident.end;

  const typeParts: string[] = [];
  while (i < def.length) {
    i = skipWs(def, i);
    if (i >= def.length) break;
    const c = def[i];
    if (c === '(') {
      const end = skipParens(def, i);
      typeParts.push(def.slice(i, end));
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = skipQuoted(def, i);
      typeParts.push(def.slice(i, end));
      i = end;
      continue;
    }
    const w = readWord(def, i);
    if (!w.word) {
      i++;
      continue;
    }
    const up = w.word.toUpperCase();
    if (up === 'CHARACTER' && peekWord(def, w.end).toUpperCase() === 'SET') break;
    if (ATTR.has(up)) break;
    typeParts.push(w.word);
    i = w.end;
  }

  const type = typeParts.join(' ').replace(/\s+/g, ' ').trim();
  const affinity = mapAffinity(type);

  let nullable = true;
  let defaultValue: string | null = null;
  let isPrimaryKey = false;
  let isAutoIncrement = false;
  let comment: string | null = null;
  let inlineFk: { refTable: string; refColumns: string[]; onDelete: string | null; onUpdate: string | null } | null = null;

  while (i < def.length) {
    i = skipWs(def, i);
    if (i >= def.length) break;
    const c = def[i];
    if (c === '(') {
      i = skipParens(def, i);
      continue;
    }
    const w = readWord(def, i);
    if (!w.word) {
      i++;
      continue;
    }
    const up = w.word.toUpperCase();
    switch (up) {
      case 'NOT': {
        const nw = readWord(def, skipWs(def, w.end));
        if (nw.word.toUpperCase() === 'NULL') {
          nullable = false;
          i = nw.end;
        } else {
          i = w.end;
        }
        break;
      }
      case 'NULL':
        nullable = true;
        i = w.end;
        break;
      case 'DEFAULT': {
        const expr = readExpression(def, w.end);
        defaultValue = expr.text || null;
        i = expr.end;
        break;
      }
      case 'AUTO_INCREMENT':
      case 'AUTOINCREMENT':
        isAutoIncrement = true;
        i = w.end;
        break;
      case 'IDENTITY': {
        isAutoIncrement = true;
        i = w.end;
        const j = skipWs(def, i);
        if (def[j] === '(') i = skipParens(def, j);
        break;
      }
      case 'PRIMARY': {
        const kw = readWord(def, skipWs(def, w.end));
        if (kw.word.toUpperCase() === 'KEY') {
          isPrimaryKey = true;
          i = kw.end;
        } else {
          i = w.end;
        }
        break;
      }
      case 'UNIQUE':
      case 'KEY':
      case 'STORED':
      case 'VIRTUAL':
      case 'INVISIBLE':
      case 'VISIBLE':
      case 'ENFORCED':
        i = w.end;
        break;
      case 'COMMENT': {
        const j = skipWs(def, w.end);
        if (def[j] === "'") {
          const end = skipQuoted(def, j);
          comment = decodeStringBody(def.slice(j + 1, end - 1), 'mysql');
          i = end;
        } else {
          i = w.end;
        }
        break;
      }
      case 'COLLATE': {
        const cw = readWord(def, skipWs(def, w.end));
        i = cw.end || w.end;
        break;
      }
      case 'CONSTRAINT': {
        const cw = readQuotedIdent(def, skipWs(def, w.end));
        i = cw.end || w.end;
        break;
      }
      case 'SRID':
        i = w.end;
        break;
      case 'CHARACTER': {
        const sw = readWord(def, skipWs(def, w.end));
        if (sw.word.toUpperCase() === 'SET') {
          const vw = readWord(def, skipWs(def, sw.end));
          i = vw.end || sw.end;
        } else {
          i = w.end;
        }
        break;
      }
      case 'GENERATED':
      case 'AS': {
        i = w.end;
        const j = skipWs(def, i);
        if (def[j] === '(') i = skipParens(def, j);
        break;
      }
      case 'CHECK': {
        i = w.end;
        const j = skipWs(def, i);
        if (def[j] === '(') i = skipParens(def, j);
        break;
      }
      case 'REFERENCES': {
        i = w.end;
        const j = skipWs(def, i);
        const t = readQuotedIdent(def, j);
        i = t.end;
        const refColumns: string[] = [];
        const k = skipWs(def, i);
        if (def[k] === '(') {
          const end = skipParens(def, k);
          for (const p of splitTopLevel(def.slice(k + 1, end - 1), ',')) {
            const idr = readQuotedIdent(p, 0);
            if (idr.word) refColumns.push(idr.word);
          }
          i = end;
        }
        inlineFk = { refTable: t.word, refColumns, onDelete: null, onUpdate: null };
        break;
      }
      case 'ON': {
        const aw = readWord(def, skipWs(def, w.end));
        if (aw.word.toUpperCase() === 'DELETE' || aw.word.toUpperCase() === 'UPDATE') {
          const action = readFkAction(def, aw.end);
          if (inlineFk) {
            if (aw.word.toUpperCase() === 'DELETE') inlineFk.onDelete = action.action;
            else inlineFk.onUpdate = action.action;
          }
          i = action.end;
        } else {
          i = aw.end || w.end;
        }
        break;
      }
      default:
        i = w.end;
        break;
    }
  }

  return {
    name,
    type,
    affinity,
    nullable,
    defaultValue,
    isPrimaryKey,
    isAutoIncrement,
    comment,
    ordinal,
  };
}

function parseForeignKeyClause(text: string, constraint: string | null): ParsedForeignKey | null {
  const m = /FOREIGN\s+KEY\s*\(/i.exec(text);
  if (!m) return null;
  const open = text.indexOf('(', m.index);
  const end = skipParens(text, open);
  const columns = splitTopLevel(text.slice(open + 1, end - 1), ',')
    .map((p) => extractIndexColumn(p))
    .filter(Boolean);

  const refMatch = /REFERENCES\s+/i.exec(text.slice(end));
  if (!refMatch) return null;
  const afterRef = text.slice(end + refMatch.index + refMatch[0].length);
  const t = readQuotedIdent(afterRef, 0);
  const refTable = t.word;
  const refColumns: string[] = [];
  const j = skipWs(afterRef, t.end);
  if (afterRef[j] === '(') {
    const endRef = skipParens(afterRef, j);
    for (const p of splitTopLevel(afterRef.slice(j + 1, endRef - 1), ',')) {
      const idr = readQuotedIdent(p, 0);
      if (idr.word) refColumns.push(idr.word);
    }
  }

  let onDelete: string | null = null;
  let onUpdate: string | null = null;
  const tail = afterRef.slice(j);
  const del = /ON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/i.exec(tail);
  if (del) onDelete = del[1].toUpperCase().replace(/\s+/g, ' ');
  const upd = /ON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/i.exec(tail);
  if (upd) onUpdate = upd[1].toUpperCase().replace(/\s+/g, ' ');

  return { constraint, columns, refTable, refColumns, onDelete, onUpdate };
}

/** Parses a `CREATE TABLE` statement. */
export function parseCreateTable(stmt: string): ParsedTable | null {
  const m = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP\s+|TEMPORARY\s+|GLOBAL\s+|LOCAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(
    stmt,
  );
  if (!m) return null;

  const rest = stmt.slice(m[0].length);
  const open = rest.indexOf('(');
  if (open === -1) return null;
  const namePart = rest.slice(0, open).trim();
  const bodyEnd = skipParens(rest, open);
  const body = rest.slice(open + 1, bodyEnd - 1);
  const trailing = rest.slice(bodyEnd).trim();

  const nameMatch = /^(?:`[^`]+`|\[[^\]]+\]|"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|\[[^\]]+\]|"[^"]+"|[A-Za-z_][\w$]*))*/.exec(namePart);
  const fullName = nameMatch ? nameMatch[0] : namePart;
  const segments = fullName.split('.').map((s) => s.trim().replace(/^[`"[]|[`"\]]$/g, ''));
  const name = segments[segments.length - 1] ?? fullName;
  const schema = segments.length > 1 ? segments[segments.length - 2] : null;

  const parts = splitTopLevel(body, ',');
  const columns: ParsedColumn[] = [];
  const indexes: ParsedIndex[] = [];
  const foreignKeys: ParsedForeignKey[] = [];
  const primaryKey: string[] = [];
  let comment: string | null = null;

  const trailingComment = /COMMENT\s*=?\s*'((?:[^']|'')*)'/i.exec(trailing);
  if (trailingComment) comment = trailingComment[1].replace(/''/g, "'");

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const up = part.toUpperCase();

    if (up.startsWith('PRIMARY KEY')) {
      primaryKey.push(...parseIndexColumns(part));
      continue;
    }
    if (up.startsWith('UNIQUE')) {
      const rest2 = part
        .slice(part.toUpperCase().indexOf('UNIQUE') + 6)
        .trim()
        .replace(/^(KEY|INDEX)\b\s*/i, '');
      const nm = readQuotedIdent(rest2, 0);
      const hasName = Boolean(nm.word) && !/^\s*\(/.test(rest2);
      indexes.push({
        name: hasName ? nm.word : `uq_${name}_${indexes.length + 1}`,
        unique: true,
        columns: parseIndexColumns(part),
      });
      continue;
    }
    if (/^(KEY|INDEX)\b/.test(up)) {
      const rest2 = part.replace(/^(KEY|INDEX)\s+/i, '');
      const nm = readQuotedIdent(rest2, 0);
      indexes.push({
        name: nm.word || `idx_${name}_${indexes.length + 1}`,
        unique: false,
        columns: parseIndexColumns(part),
      });
      continue;
    }
    if (/^(FULLTEXT|SPATIAL)\b/.test(up)) {
      const rest2 = part.replace(/^(FULLTEXT|SPATIAL)\s+/i, '');
      const nm = readQuotedIdent(rest2, 0);
      indexes.push({ name: nm.word || `ft_${name}_${indexes.length + 1}`, unique: false, columns: parseIndexColumns(part) });
      continue;
    }
    if (up.startsWith('CONSTRAINT')) {
      const after = part.slice(10).trim();
      const nm = readQuotedIdent(after, 0);
      const rest2 = after.slice(nm.end).trim();
      if (/^FOREIGN\s+KEY/i.test(rest2)) {
        const fk = parseForeignKeyClause(rest2, nm.word || null);
        if (fk) foreignKeys.push(fk);
        continue;
      }
      if (/^UNIQUE/i.test(rest2)) {
        indexes.push({ name: nm.word || `uq_${name}_${indexes.length + 1}`, unique: true, columns: parseIndexColumns(rest2) });
        continue;
      }
      if (/^PRIMARY/i.test(rest2)) {
        primaryKey.push(...parseIndexColumns(rest2));
        continue;
      }
      continue;
    }
    if (/^FOREIGN\s+KEY/i.test(up)) {
      const fk = parseForeignKeyClause(part, null);
      if (fk) foreignKeys.push(fk);
      continue;
    }
    if (/^CHECK\b/i.test(up)) continue;
    if (/^EXCLUDE\b/i.test(up)) continue;

    const col = parseColumnDefinition(part, columns.length);
    if (col) {
      columns.push(col);
      if (col.isPrimaryKey) primaryKey.push(col.name);
    }
  }

  return { name, schema, columns, primaryKey, indexes, foreignKeys, comment };
}

/** Parses `CREATE [UNIQUE] INDEX name ON table (cols)`. */
export function parseCreateIndex(stmt: string): { name: string; table: string; unique: boolean; columns: string[] } | null {
  const m = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(stmt);
  if (!m) return null;
  const unique = Boolean(m[1]);
  let rest = stmt.slice(m[0].length);
  const nm = readQuotedIdent(rest, 0);
  const name = nm.word;
  rest = rest.slice(nm.end);
  const onMatch = /\bON\s+/i.exec(rest);
  if (!onMatch) return null;
  rest = rest.slice(onMatch.index + onMatch[0].length);
  const t = readQuotedIdent(rest, 0);
  const table = t.word;
  rest = rest.slice(t.end);
  const open = rest.indexOf('(');
  if (open === -1) return null;
  const end = skipParens(rest, open);
  const columns = splitTopLevel(rest.slice(open + 1, end - 1), ',')
    .map((p) => extractIndexColumn(p))
    .filter(Boolean);
  return { name, table, unique, columns };
}

/** Parses `ALTER TABLE t ADD CONSTRAINT ... FOREIGN KEY ...`. */
export function parseAlterForeignKey(stmt: string): { table: string; fk: ParsedForeignKey } | null {
  const m = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?/i.exec(stmt);
  if (!m) return null;
  const rest = stmt.slice(m[0].length);
  const t = readQuotedIdent(rest, 0);
  const table = t.word;
  const after = rest.slice(t.end);
  if (!/\bADD\b/i.test(after)) return null;
  const addIdx = after.search(/\bADD\b/i);
  let tail = after.slice(addIdx + 3).trim();
  let constraint: string | null = null;
  const cm = /^\s*CONSTRAINT\s+/i.exec(tail);
  if (cm) {
    const nm = readQuotedIdent(tail, cm[0].length);
    constraint = nm.word || null;
    tail = tail.slice(nm.end);
  }
  if (!/^\s*FOREIGN\s+KEY/i.test(tail)) return null;
  const fk = parseForeignKeyClause(tail, constraint);
  if (!fk) return null;
  return { table, fk };
}
