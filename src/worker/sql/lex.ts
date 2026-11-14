/** Low level SQL lexing helpers shared by the statement parsers. */

/**
 * Returns the index right after the string literal that starts at `i`.
 * Handles doubled quotes (SQL standard) and backslash escapes (MySQL).
 */
export function skipQuoted(s: string, i: number, allowBackslash = true): number {
  const quote = s[i];
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && allowBackslash) {
      j += 2;
      continue;
    }
    if (c === quote) {
      if (s[j + 1] === quote) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return s.length;
}

/** Skips a `[...]` identifier (SQL Server) starting at `i`. */
export function skipBracket(s: string, i: number): number {
  const end = s.indexOf(']', i + 1);
  return end === -1 ? s.length : end + 1;
}

/** Skips a balanced `(...)` group starting at `i` (which must be a `(`). */
export function skipParens(s: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === "'" || c === '"') {
      j = skipQuoted(s, j);
      continue;
    }
    if (c === '`') {
      j = skipQuoted(s, j, false);
      continue;
    }
    if (c === '[') {
      j = skipBracket(s, j);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return s.length;
}

/** Splits a string on `sep` at the top level only (ignores quoted/parenthesised text). */
export function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') {
      i = skipQuoted(s, i);
      continue;
    }
    if (c === '`') {
      i = skipQuoted(s, i, false);
      continue;
    }
    if (c === '[') {
      i = skipBracket(s, i);
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

/** Finds the index of the first `(` that is not inside a string literal. */
export function findTopLevelParen(s: string): number {
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') {
      i = skipQuoted(s, i);
      continue;
    }
    if (c === '`') {
      i = skipQuoted(s, i, false);
      continue;
    }
    if (c === '[') {
      i = skipBracket(s, i);
      continue;
    }
    if (c === '(') return i;
    i++;
  }
  return -1;
}

/** Removes line and block comments while keeping string literals intact. */
export function stripComments(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') {
      const end = skipQuoted(s, i);
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      const end = skipQuoted(s, i, false);
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '[') {
      const end = skipBracket(s, i);
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? s.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Removes comments but preserves MySQL conditional comments (the ones starting with
 * an exclamation mark) because they contain real DDL.
 */
export function stripCommentsKeepVersioned(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') {
      const end = skipQuoted(s, i);
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      const end = skipQuoted(s, i, false);
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const isVersioned = s[i + 2] === '!';
      const end = s.indexOf('*/', i + 2);
      const stop = end === -1 ? s.length : end + 2;
      if (isVersioned) {
        out += ' ' + s.slice(i + 3, end === -1 ? s.length : end) + ' ';
      }
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Removes the identifier quoting characters. */
export function unquoteIdent(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '`' && last === '`') || (first === '"' && last === '"') || (first === '[' && last === ']')) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Splits `schema`.`table` into its parts. */
export function splitQualifiedName(raw: string): { schema: string | null; name: string } {
  const parts: string[] = [];
  let i = 0;
  const s = raw.trim();
  while (i < s.length) {
    const c = s[i];
    if (c === '`') {
      const end = skipQuoted(s, i, false);
      parts.push(s.slice(i, end));
      i = end;
      continue;
    }
    if (c === '[') {
      const end = skipBracket(s, i);
      parts.push(s.slice(i, end));
      i = end;
      continue;
    }
    if (c === '"') {
      const end = skipQuoted(s, i, false);
      parts.push(s.slice(i, end));
      i = end;
      continue;
    }
    if (c === '.') {
      parts.push('.');
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== '.' && s[j] !== ' ' && s[j] !== '\n') j++;
    if (j > i) parts.push(s.slice(i, j));
    i = j;
    while (i < s.length && /\s/.test(s[i])) i++;
  }
  const cleaned = parts.filter((p) => p !== '.');
  if (cleaned.length >= 2) {
    return { schema: unquoteIdent(cleaned[cleaned.length - 2]), name: unquoteIdent(cleaned[cleaned.length - 1]) };
  }
  return { schema: null, name: unquoteIdent(cleaned[0] ?? s) };
}

/** Reads a bare word (identifier/keyword) at `i`. */
export function readWord(s: string, i: number): { word: string; end: number } {
  let j = i;
  while (j < s.length && /[A-Za-z0-9_$@#]/.test(s[j])) j++;
  return { word: s.slice(i, j), end: j };
}

/** Reads a quoted identifier at `i`. */
export function readQuotedIdent(s: string, i: number): { word: string; end: number } {
  const c = s[i];
  if (c === '`') {
    const end = skipQuoted(s, i, false);
    return { word: unquoteIdent(s.slice(i, end)), end };
  }
  if (c === '[') {
    const end = skipBracket(s, i);
    return { word: unquoteIdent(s.slice(i, end)), end };
  }
  if (c === '"') {
    const end = skipQuoted(s, i, false);
    return { word: unquoteIdent(s.slice(i, end)), end };
  }
  return readWord(s, i);
}
