import { parseCopyPayload } from './dml';
import { stripCommentsKeepVersioned } from './lex';

export type Chunk =
  | { kind: 'sql'; text: string; line: number }
  | { kind: 'copy'; table: string; columns: string[]; rows: string[][]; line: number };

const S_NORMAL = 0;
const S_SINGLE = 1;
const S_DOUBLE = 2;
const S_BACKTICK = 3;
const S_BRACKET = 4;
const S_LINE_COMMENT = 5;
const S_BLOCK_COMMENT = 6;
const S_DOLLAR = 7;

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++;
  return n;
}

/**
 * Splits a SQL dump into statements while streaming: the file is fed in chunks
 * and complete statements are emitted as soon as they are available.
 */
export function createSplitter(sink: (chunk: Chunk) => void) {
  let buf = '';
  let i = 0;
  let line = 1;
  let stmtLine = 1;
  let term = ';';
  let state = S_NORMAL;
  let dollarTag = '';
  let copyTarget: { table: string; columns: string[]; line: number } | null = null;
  let copyRows: string[][] = [];

  function emitStatement(text: string, startLine: number) {
    const trimmed = text.trim();
    if (!trimmed) return;
    sink({ kind: 'sql', text: trimmed, line: startLine });
    // The chunk may contain the comments that precede the statement.
    const bare = stripCommentsKeepVersioned(trimmed).trim();
    const m = /^\s*COPY\s+([^\s(]+)\s*(?:\(([^)]*)\))?\s+FROM\s+stdin\s*;?\s*$/i.exec(bare);
    if (m) {
      copyTarget = {
        table: m[1].replace(/^[`"[]|[`"\]]$/g, ''),
        columns: m[2]
          ? m[2].split(',').map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ''))
          : [],
        line: startLine,
      };
      copyRows = [];
    }
  }

  function scan() {
    for (;;) {
      if (copyTarget) {
        const nl = buf.indexOf('\n', i);
        if (nl === -1) {
          if (i > 1 << 20) {
            buf = buf.slice(i);
            i = 0;
          }
          return;
        }
        const rawLine = buf.slice(i, nl);
        i = nl + 1;
        line++;
        const trimmed = rawLine.replace(/\r$/, '');
        if (trimmed === '\\.') {
          sink({
            kind: 'copy',
            table: copyTarget.table,
            columns: copyTarget.columns,
            rows: copyRows,
            line: copyTarget.line,
          });
          copyTarget = null;
          copyRows = [];
          // Drop the consumed block so the next statement starts clean.
          buf = buf.slice(i);
          i = 0;
          continue;
        }
        if (trimmed === '') continue;
        copyRows.push(...parseCopyPayload(trimmed));
        continue;
      }

      if (i >= buf.length) return;

      const c = buf[i];

      switch (state) {
        case S_NORMAL: {
          if (buf.startsWith(term, i)) {
            const text = buf.slice(0, i);
            const startLine = stmtLine;
            buf = buf.slice(i + term.length);
            i = 0;
            emitStatement(text, startLine);
            stmtLine = line;
            continue;
          }
          if (c === "'") {
            state = S_SINGLE;
            i++;
            continue;
          }
          if (c === '"') {
            state = S_DOUBLE;
            i++;
            continue;
          }
          if (c === '`') {
            state = S_BACKTICK;
            i++;
            continue;
          }
          if (c === '[') {
            state = S_BRACKET;
            i++;
            continue;
          }
          if (c === '-' && buf[i + 1] === '-') {
            state = S_LINE_COMMENT;
            i += 2;
            continue;
          }
          if (c === '#') {
            state = S_LINE_COMMENT;
            i++;
            continue;
          }
          if (c === '/' && buf[i + 1] === '*') {
            state = S_BLOCK_COMMENT;
            i += 2;
            continue;
          }
          if (c === '$') {
            const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(buf.slice(i, i + 64));
            if (m) {
              dollarTag = m[0];
              state = S_DOLLAR;
              i += dollarTag.length;
              continue;
            }
          }
          if (c === 'D' && (i === 0 || buf[i - 1] === '\n') && buf.slice(i, i + 9).toUpperCase() === 'DELIMITER') {
            const endOfLine = buf.indexOf('\n', i);
            const stop = endOfLine === -1 ? buf.length : endOfLine;
            const directive = buf.slice(i + 9, stop).trim();
            if (directive) term = directive;
            const consumed = buf.slice(i, stop);
            line += countNewlines(consumed);
            buf = buf.slice(stop);
            i = 0;
            continue;
          }
          if (c === '\n') line++;
          i++;
          continue;
        }
        case S_SINGLE:
        case S_DOUBLE:
        case S_BACKTICK: {
          if (c === '\\' && state !== S_BACKTICK) {
            i += 2;
            continue;
          }
          if (c === "'" && state === S_SINGLE) {
            if (buf[i + 1] === "'") {
              i += 2;
              continue;
            }
            state = S_NORMAL;
            i++;
            continue;
          }
          if (c === '"' && state === S_DOUBLE) {
            if (buf[i + 1] === '"') {
              i += 2;
              continue;
            }
            state = S_NORMAL;
            i++;
            continue;
          }
          if (c === '`' && state === S_BACKTICK) {
            if (buf[i + 1] === '`') {
              i += 2;
              continue;
            }
            state = S_NORMAL;
            i++;
            continue;
          }
          if (c === '\n') line++;
          i++;
          continue;
        }
        case S_BRACKET: {
          if (c === ']') {
            state = S_NORMAL;
            i++;
            continue;
          }
          if (c === '\n') line++;
          i++;
          continue;
        }
        case S_LINE_COMMENT: {
          if (c === '\n') {
            line++;
            state = S_NORMAL;
          }
          i++;
          continue;
        }
        case S_BLOCK_COMMENT: {
          if (c === '*' && buf[i + 1] === '/') {
            state = S_NORMAL;
            i += 2;
            continue;
          }
          if (c === '\n') line++;
          i++;
          continue;
        }
        case S_DOLLAR: {
          if (buf.startsWith(dollarTag, i)) {
            state = S_NORMAL;
            i += dollarTag.length;
            continue;
          }
          if (c === '\n') line++;
          i++;
          continue;
        }
        default:
          i++;
          continue;
      }
    }
  }

  return {
    push(chunk: string) {
      buf += chunk;
      scan();
    },
    end() {
      scan();
      // After the last emission the buffer is re-based to the statement that
      // is still being scanned, so the whole buffer is the pending tail
      // (it may have no trailing ";" — e.g. a query typed in the editor).
      const tail = buf;
      if (tail.trim()) emitStatement(tail, stmtLine);
      buf = '';
      i = 0;
    },
  };
}
