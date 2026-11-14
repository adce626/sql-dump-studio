/**
 * Small SQL toolkit for the editor: a formatter and a context aware
 * completion list built from the schema of the open database.
 */

export interface SchemaInfo {
  tables: { name: string; columns: string[] }[];
}

export interface SqlSuggestion {
  label: string;
  kind: 'table' | 'column' | 'keyword';
  /** Extra hint shown next to the suggestion (the table a column belongs to). */
  detail?: string;
}

/* ------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------ */

type TokType = 'word' | 'string' | 'comment' | 'num' | 'punct';

interface Tok {
  type: TokType;
  value: string;
}

function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      out.push({ type: 'comment', value: end === -1 ? sql.slice(i) : sql.slice(i, end) });
      i = end === -1 ? sql.length : end;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      out.push({ type: 'comment', value: end === -1 ? sql.slice(i) : sql.slice(i, end + 2) });
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      out.push({ type: 'string', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[0-9._]/.test(sql[j])) j++;
      out.push({ type: 'num', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      out.push({ type: 'word', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    out.push({ type: 'punct', value: ch });
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Formatter
 * ------------------------------------------------------------------ */

const UPPER_WORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
  'ALL', 'DISTINCT', 'VALUES', 'SET', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN',
  'ON', 'AND', 'OR', 'AS', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NOT', 'NULL', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'DROP',
  'ALTER', 'ADD', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'UNIQUE', 'INDEX',
  'VIEW', 'WITH', 'RETURNING', 'USING', 'ASC', 'DESC', 'COLLATE', 'EXISTS', 'IF',
]);

/** Keywords that start a new clause (and therefore a new line). */
const CLAUSE_STARTS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'VALUES',
  'SET', 'UNION', 'UNION ALL', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'INNER JOIN',
  'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN', 'RETURNING', 'CREATE TABLE',
  'ALTER TABLE', 'DROP TABLE',
]);

function indentOf(level: number): string {
  return '  '.repeat(Math.max(0, level));
}

/**
 * Formats a SQL statement: keywords in upper case, one clause per line and the
 * select list split over several lines.
 */
export function formatSql(sql: string): string {
  const tokens = tokenize(sql);
  const lines: string[] = [];
  let line = '';
  let depth = 0;
  let mode: 'none' | 'select' = 'none';

  const flush = () => {
    // Keep the leading indentation, drop the trailing spaces only.
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed) lines.push(trimmed);
    line = '';
  };

  const append = (text: string) => {
    if (line && !line.endsWith(' ') && !/^[,)]$/.test(text)) line += ' ';
    line += text;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === 'comment') {
      flush();
      lines.push(tok.value);
      continue;
    }

    if (tok.type === 'string' || tok.type === 'num') {
      append(tok.value);
      continue;
    }

    if (tok.type === 'word') {
      const upper = tok.value.toUpperCase();

      // GROUP BY / ORDER BY / UNION ALL are single clauses.
      let clause = upper;
      const next = tokens[i + 1];
      if ((upper === 'GROUP' || upper === 'ORDER') && next?.type === 'word' && next.value.toUpperCase() === 'BY') {
        clause = `${upper} BY`;
        i++;
      } else if (upper === 'UNION' && next?.type === 'word' && next.value.toUpperCase() === 'ALL') {
        clause = 'UNION ALL';
        i++;
      } else if (upper === 'INSERT' && next?.type === 'word' && next.value.toUpperCase() === 'INTO') {
        clause = 'INSERT INTO';
        i++;
      } else if (upper === 'DELETE' && next?.type === 'word' && next.value.toUpperCase() === 'FROM') {
        clause = 'DELETE FROM';
        i++;
      } else if (
        (upper === 'INNER' || upper === 'LEFT' || upper === 'RIGHT' || upper === 'FULL' || upper === 'CROSS') &&
        tokens[i + 1]?.type === 'word' &&
        tokens[i + 1].value.toUpperCase() === 'JOIN'
      ) {
        clause = `${upper} JOIN`;
        i++;
      } else if (upper === 'CREATE' && next?.type === 'word' && next.value.toUpperCase() === 'TABLE') {
        clause = 'CREATE TABLE';
        i++;
      } else if (upper === 'ALTER' && next?.type === 'word' && next.value.toUpperCase() === 'TABLE') {
        clause = 'ALTER TABLE';
        i++;
      } else if (upper === 'DROP' && next?.type === 'word' && next.value.toUpperCase() === 'TABLE') {
        clause = 'DROP TABLE';
        i++;
      }

      if (CLAUSE_STARTS.has(clause)) {
        flush();
        line = indentOf(depth) + clause;
        mode = clause === 'SELECT' ? 'select' : 'none';
        continue;
      }

      append(UPPER_WORDS.has(upper) ? upper : tok.value);
      continue;
    }

    // Punctuation
    if (tok.value === ',') {
      if (mode === 'select') {
        // Keep the comma at the end of the column and break after it.
        append(',');
        flush();
        line = indentOf(depth + 1);
        continue;
      }
      append(',');
      continue;
    }

    if (tok.value === '(') {
      append('(');
      depth++;
      continue;
    }

    if (tok.value === ')') {
      depth = Math.max(0, depth - 1);
      append(')');
      continue;
    }

    if (tok.value === ';') {
      append(';');
      flush();
      mode = 'none';
      continue;
    }

    append(tok.value);
  }

  flush();
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Suggestions
 * ------------------------------------------------------------------ */

const TABLE_CONTEXT = new Set([
  'FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN',
  'FULL JOIN', 'CROSS JOIN',
]);

const KEYWORD_SUGGESTIONS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN',
  'LEFT JOIN', 'INNER JOIN', 'UNION', 'DISTINCT', 'INSERT INTO', 'UPDATE', 'DELETE FROM',
  'VALUES', 'AND', 'OR', 'NOT NULL', 'IS NULL', 'LIKE', 'BETWEEN', 'COUNT', 'SUM', 'AVG',
  'MIN', 'MAX', 'COALESCE', 'CASE',
];

/** The word that is currently being typed, plus where it starts. */
export function currentWord(sql: string, cursor: number): { word: string; start: number } {
  const before = sql.slice(0, cursor);
  const match = /([A-Za-z0-9_$]*)$/.exec(before);
  const word = match ? match[1] : '';
  return { word, start: cursor - word.length };
}

/** The last SQL keyword before the cursor. */
export function contextKeyword(sql: string, cursor: number): string {
  const before = sql.slice(0, cursor);
  const matches = before.match(
    /\b(SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|INTO|UPDATE|TABLE|VALUES|SET|ON)\b/gi,
  );
  if (!matches?.length) return '';
  return matches[matches.length - 1].toUpperCase().replace(/\s+/g, ' ');
}

/** Tables that are already referenced by the statement. */
export function referencedTables(sql: string): string[] {
  const out: string[] = [];
  const re = /\b(?:from|join|update|into)\s+["'`\[]?([A-Za-z_][\w$]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const name = match[1];
    if (!out.some((item) => item.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/**
 * Builds the completion list for the current cursor position: table names
 * after FROM/JOIN, column names everywhere else.
 */
export function suggestFor(sql: string, cursor: number, schema: SchemaInfo): SqlSuggestion[] {
  const { word } = currentWord(sql, cursor);
  const keyword = contextKeyword(sql, cursor);
  const wantsTable = TABLE_CONTEXT.has(keyword);
  const needle = word.toLowerCase();

  const suggestions: SqlSuggestion[] = [];

  if (wantsTable) {
    for (const table of schema.tables) {
      if (!needle || table.name.toLowerCase().startsWith(needle)) {
        suggestions.push({ label: table.name, kind: 'table' });
      }
    }
    return suggestions.slice(0, 12);
  }

  const used = referencedTables(sql.slice(0, cursor));
  const relevant = schema.tables.filter((table) =>
    used.length ? used.some((name) => name.toLowerCase() === table.name.toLowerCase()) : true,
  );

  for (const table of relevant) {
    for (const column of table.columns) {
      if (!needle || column.toLowerCase().startsWith(needle)) {
        suggestions.push({
          label: column,
          kind: 'column',
          detail: used.length ? table.name : undefined,
        });
      }
    }
  }

  for (const table of schema.tables) {
    if (!needle || table.name.toLowerCase().startsWith(needle)) {
      suggestions.push({ label: table.name, kind: 'table' });
    }
  }

  for (const keywordItem of KEYWORD_SUGGESTIONS) {
    if (!needle || keywordItem.toLowerCase().startsWith(needle)) {
      suggestions.push({ label: keywordItem, kind: 'keyword' });
    }
  }

  return suggestions.slice(0, 20);
}
