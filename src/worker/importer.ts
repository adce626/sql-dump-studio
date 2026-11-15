import { createSplitter, type Chunk } from './sql/splitter';
import { parseAlterForeignKey, parseCreateIndex, parseCreateTable } from './sql/ddl';
import { parseInsert } from './sql/dml';
import { parseValue, type SqlValue } from './sql/values';
import { stripCommentsKeepVersioned } from './sql/lex';
import { mapAffinity } from './sql/dialect';
import { quoteIdent, safeName, type Sqlite3 } from './sqlite';
import type { ColumnMeta, Dialect, ForeignKeyMeta, IndexMeta, StatementInfo, TableMeta } from './protocol';

export const META_PREFIX = '_sds_';

export interface ImportOptions {
  file: File;
  encoding: string;
  dialect: Dialect;
  buildSearchIndex: boolean;
  onlyTables: string[] | null;
  /** Stream with the SQL bytes. Defaults to the file itself (used for .gz/.tar). */
  source?: ReadableStream<Uint8Array>;
  /** Size of the SQL payload in bytes (used for the progress bar). */
  totalSize?: number;
}

export interface ImportOutcome {
  tables: TableMeta[];
  statements: StatementInfo[];
  totalStatements: number;
  warnings: string[];
}

interface TableState {
  key: string;
  name: string;
  schema: string | null;
  sqliteName: string;
  type: 'table' | 'view';
  columns: ColumnMeta[];
  indexes: IndexMeta[];
  foreignKeys: ForeignKeyMeta[];
  ddl: string;
  comment: string | null;
  rawSql: string[];
  rowCount: number;
  created: boolean;
  stmt: any;
  stmtSignature: string;
  searchTextColumns: string[];
}

const MAX_STATEMENTS = 2000;
const MAX_STATEMENT_LENGTH = 200_000;

function keyOf(name: string, schema: string | null) {
  return (schema ? `${schema}.` : '') + name.toLowerCase();
}

function toColumnMeta(c: {
  name: string;
  type: string;
  affinity: ColumnMeta['affinity'];
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  comment: string | null;
  ordinal: number;
}): ColumnMeta {
  return {
    name: c.name,
    originalType: c.type,
    affinity: c.affinity,
    nullable: c.nullable,
    defaultValue: c.defaultValue,
    isPrimaryKey: c.isPrimaryKey,
    isAutoIncrement: c.isAutoIncrement,
    comment: c.comment,
    ordinal: c.ordinal,
  };
}

/**
 * Streams a SQL dump, converts it into a SQLite database and returns the
 * metadata describing every table that was found.
 */
export async function importDump(
  sqlite3: Sqlite3,
  db: any,
  opts: ImportOptions,
  onProgress: (phase: string, pct: number, detail?: string) => void,
): Promise<ImportOutcome> {
  const warnings: string[] = [];
  const tables = new Map<string, TableState>();
  const statements: StatementInfo[] = [];
  let totalStatements = 0;

  db.exec('PRAGMA journal_mode = OFF');
  db.exec('PRAGMA synchronous = OFF');
  db.exec('PRAGMA temp_store = MEMORY');
  db.exec('BEGIN');

  let hasFts = false;
  try {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${META_PREFIX}fts USING fts5(tname UNINDEXED, txt, rid UNINDEXED)`,
    );
    hasFts = true;
  } catch {
    hasFts = false;
  }

  const searchStmt = hasFts
    ? db.prepare(`INSERT INTO ${META_PREFIX}fts(tname, txt, rid) VALUES (?, ?, ?)`)
    : null;

  const warned = new Set<string>();
  const warn = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    if (warnings.length < 100) warnings.push(message);
  };

  /* ---------------------------------------------------------------- *
   * Table helpers
   * ---------------------------------------------------------------- */
  function findTable(name: string, schema: string | null): TableState | undefined {
    const direct = tables.get(keyOf(name, schema));
    if (direct) return direct;
    if (!schema && name.includes('.')) {
      const parts = name.split('.');
      const qualified = tables.get(keyOf(parts[parts.length - 1], parts[parts.length - 2]));
      if (qualified) return qualified;
    }
    for (const t of tables.values()) {
      if (t.name.toLowerCase() === name.toLowerCase()) return t;
    }
    return undefined;
  }

  function ensureColumn(state: TableState, name: string, type?: string): void {
    if (state.columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    const meta: ColumnMeta = {
      name,
      originalType: type || 'TEXT',
      affinity: mapAffinity(type || 'TEXT'),
      nullable: true,
      defaultValue: null,
      isPrimaryKey: false,
      isAutoIncrement: false,
      comment: null,
      ordinal: state.columns.length,
    };
    state.columns.push(meta);
    if (state.created) {
      try {
        db.exec(`ALTER TABLE ${quoteIdent(state.sqliteName)} ADD COLUMN ${quoteIdent(name)} ${meta.affinity}`);
        state.stmt = null;
      } catch (err) {
        warn('alter:' + name, `Could not add column "${name}": ${String(err)}`);
      }
    }
  }

  function createTableInDb(state: TableState) {
    if (state.created) return;
    const parts: string[] = [];
    const pkColumns = state.columns.filter((c) => c.isPrimaryKey);
    for (const col of state.columns) {
      let def = `${quoteIdent(col.name)} ${col.affinity}`;
      if (col.isPrimaryKey && pkColumns.length === 1 && col.affinity === 'INTEGER') {
        def = `${quoteIdent(col.name)} INTEGER PRIMARY KEY`;
      } else if (!col.nullable && col.isPrimaryKey) {
        def = `${quoteIdent(col.name)} ${col.affinity} NOT NULL`;
      }
      if (col.defaultValue && !col.isPrimaryKey) {
        const dv = col.defaultValue.trim();
        if (/^'.*'$/s.test(dv) || /^-?\d+(\.\d+)?$/.test(dv) || /^(CURRENT_|NOW|LOCALTIME)/i.test(dv)) {
          def += ` DEFAULT ${dv}`;
        }
      }
      parts.push(def);
    }
    if (pkColumns.length > 1) {
      parts.push(`PRIMARY KEY (${pkColumns.map((c) => quoteIdent(c.name)).join(', ')})`);
    }
    try {
      db.exec(`CREATE TABLE ${quoteIdent(state.sqliteName)} (${parts.join(', ')})`);
      state.created = true;
    } catch (err) {
      warn('create:' + state.name, `Could not create table "${state.name}": ${String(err)}`);
      state.created = false;
    }
  }

  function insertStatementFor(state: TableState) {
    const signature = state.columns.map((c) => c.name).join('|');
    if (state.stmt && state.stmtSignature === signature) return state.stmt;
    if (state.stmt) {
      try {
        state.stmt.finalize();
      } catch {
        /* ignore */
      }
      state.stmt = null;
    }
    const cols = state.columns.map((c) => quoteIdent(c.name)).join(', ');
    const holes = state.columns.map(() => '?').join(', ');
    state.stmt = db.prepare(`INSERT INTO ${quoteIdent(state.sqliteName)} (${cols}) VALUES (${holes})`);
    state.stmtSignature = signature;
    return state.stmt;
  }

  function insertRow(state: TableState, values: (SqlValue | undefined)[]) {
    if (!state.created) createTableInDb(state);
    if (!state.created) return;
    const stmt = insertStatementFor(state);
    for (let i = 0; i < state.columns.length; i++) {
      const v = values[i];
      stmt.bind(i + 1, v === undefined ? null : v);
    }
    stmt.stepReset();
    state.rowCount++;

    if (searchStmt) {
      const text = state.columns
        .map((_column, i) => {
          const v = values[i];
          if (v === undefined || v === null) return '';
          if (typeof v === 'number') return String(v);
          if (typeof v === 'string') return v;
          return `<blob ${v.length}>`;
        })
        .join(' ');
      if (text.trim()) {
        const rid = sqlite3.capi.sqlite3_last_insert_rowid(db.pointer);
        searchStmt.bind(1, state.name);
        searchStmt.bind(2, text);
        searchStmt.bind(3, rid);
        searchStmt.stepReset();
      }
    }
  }

  /** Maps the values of an INSERT row onto the canonical column list. */
  function mapRow(state: TableState, columnNames: string[] | null, rawValues: string[], dialect: Dialect) {
    const parsed = rawValues.map((v) => parseValue(v, dialect));
    const out: (SqlValue | undefined)[] = new Array(state.columns.length).fill(undefined);
    if (columnNames && columnNames.length > 0) {
      for (let i = 0; i < columnNames.length; i++) {
        const name = columnNames[i];
        if (i >= parsed.length) break;
        const idx = state.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
        if (idx === -1) {
          ensureColumn(state, name);
          const newIdx = state.columns.length - 1;
          out[newIdx] = parsed[i];
        } else {
          out[idx] = parsed[i];
        }
      }
      if (parsed.length > columnNames.length) {
        warn('extra-values:' + state.name, `Table "${state.name}" has more values than columns in some INSERT rows.`);
      }
    } else {
      for (let i = 0; i < parsed.length; i++) {
        if (i < out.length) out[i] = parsed[i];
        else {
          ensureColumn(state, `col_${i + 1}`);
          out[state.columns.length - 1] = parsed[i];
        }
      }
      if (parsed.length < state.columns.length) {
        warn('missing-values:' + state.name, `Table "${state.name}" has fewer values than columns in some INSERT rows.`);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Statement handling
   * ---------------------------------------------------------------- */
  function handleCreateTable(stmtText: string) {
    const parsed = parseCreateTable(stmtText);
    if (!parsed) return;
    const key = keyOf(parsed.name, parsed.schema);
    const state: TableState = tables.get(key) ?? {
      key,
      name: parsed.name,
      schema: parsed.schema,
      sqliteName: safeName(parsed.name),
      type: 'table',
      columns: [],
      indexes: [],
      foreignKeys: [],
      ddl: '',
      comment: parsed.comment,
      rawSql: [],
      rowCount: 0,
      created: false,
      stmt: null,
      stmtSignature: '',
      searchTextColumns: [],
    };
    state.ddl = stmtText;
    state.columns = parsed.columns.map(toColumnMeta);
    if (parsed.primaryKey.length && !state.columns.some((c) => c.isPrimaryKey)) {
      for (const pk of parsed.primaryKey) {
        const col = state.columns.find((c) => c.name.toLowerCase() === pk.toLowerCase());
        if (col) col.isPrimaryKey = true;
      }
    }
    for (const idx of parsed.indexes) {
      if (!state.indexes.some((i) => i.name.toLowerCase() === idx.name.toLowerCase())) state.indexes.push(idx);
    }
    for (const fk of parsed.foreignKeys) {
      state.foreignKeys.push({
        constraint: fk.constraint,
        columns: fk.columns,
        refTable: fk.refTable,
        refColumns: fk.refColumns,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
        source: 'declared',
      });
    }
    tables.set(key, state);
  }

  function handleCreateIndex(stmtText: string) {
    const parsed = parseCreateIndex(stmtText);
    if (!parsed) return;
    const state = findTable(parsed.table, null);
    if (!state) return;
    if (!state.indexes.some((i) => i.name.toLowerCase() === parsed.name.toLowerCase())) {
      state.indexes.push({ name: parsed.name, unique: parsed.unique, columns: parsed.columns });
    }
  }

  function handleAlter(stmtText: string) {
    const parsed = parseAlterForeignKey(stmtText);
    if (!parsed) return;
    const state = findTable(parsed.table, null);
    if (!state) return;
    state.foreignKeys.push({
      constraint: parsed.fk.constraint,
      columns: parsed.fk.columns,
      refTable: parsed.fk.refTable,
      refColumns: parsed.fk.refColumns,
      onDelete: parsed.fk.onDelete,
      onUpdate: parsed.fk.onUpdate,
      source: 'declared',
    });
  }

  function handleInsert(stmtText: string, dialect: Dialect) {
    const parsed = parseInsert(stmtText);
    if (!parsed) {
      if (/^\s*(?:INSERT|REPLACE)\b/i.test(stmtText)) {
        warn('insert-unsupported', 'Some INSERT statements use a syntax that could not be parsed (INSERT ... SELECT).');
      }
      return;
    }
    const state = findTable(parsed.table, parsed.schema);
    if (!state) {
      const key = keyOf(parsed.table, parsed.schema);
      const created: TableState = {
        key,
        name: parsed.table,
        schema: parsed.schema,
        sqliteName: safeName(parsed.table),
        type: 'table',
        columns: [],
        indexes: [],
        foreignKeys: [],
        ddl: '',
        comment: null,
        rawSql: [],
        rowCount: 0,
        created: false,
        stmt: null,
        stmtSignature: '',
        searchTextColumns: [],
      };
      tables.set(key, created);
      if (parsed.columns?.length) {
        for (const col of parsed.columns) {
          ensureColumn(created, col);
        }
      } else {
        const count = parsed.rows[0]?.length ?? 1;
        for (let i = 0; i < count; i++) ensureColumn(created, `column_${i + 1}`);
      }
      insertRows(stateRef(created), parsed.columns, parsed.rows, dialect);
      return;
    }
    insertRows(state, parsed.columns, parsed.rows, dialect);
  }

  function stateRef(state: TableState) {
    return state;
  }

  function insertRows(state: TableState, columns: string[] | null, rows: string[][], dialect: Dialect) {
    if (opts.onlyTables && opts.onlyTables.length && !opts.onlyTables.includes(state.name)) return;
    for (const raw of rows) {
      insertRow(state, mapRow(state, columns, raw, dialect));
    }
  }

  function handleCopy(chunk: Extract<Chunk, { kind: 'copy' }>, dialect: Dialect) {
    let state = findTable(chunk.table, null);
    if (!state) {
      const key = keyOf(chunk.table, null);
      const created: TableState = {
        key,
        name: chunk.table.includes('.') ? chunk.table.split('.').pop()! : chunk.table,
        schema: chunk.table.includes('.') ? chunk.table.split('.')[0] : null,
        sqliteName: safeName(chunk.table),
        type: 'table',
        columns: [],
        indexes: [],
        foreignKeys: [],
        ddl: '',
        comment: null,
        rawSql: [],
        rowCount: 0,
        created: false,
        stmt: null,
        stmtSignature: '',
        searchTextColumns: [],
      };
      state = created;
      tables.set(key, created);
      for (const col of chunk.columns) ensureColumn(created, col);
    }
    insertRows(state, chunk.columns.length ? chunk.columns : null, chunk.rows, dialect);
  }

  function classify(clean: string): string {
    if (!clean) return 'empty';
    if (/^(SET\b|START\s+TRANSACTION|COMMIT\b|ROLLBACK\b|BEGIN\b|END\b)/i.test(clean)) return 'ignore';
    if (/^(LOCK|UNLOCK)\s+TABLES/i.test(clean)) return 'ignore';
    if (/^(USE\b|CREATE\s+(DATABASE|SCHEMA|USER|ROLE)|GRANT\b|REVOKE\b|FLUSH\b)/i.test(clean)) return 'ignore';
    if (/^DROP\s+(TABLE|INDEX|VIEW|DATABASE)/i.test(clean)) return 'ignore';
    if (/^(INSERT|REPLACE)\b/i.test(clean)) return 'insert';
    if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(clean)) return 'index';
    if (/^CREATE\s+(OR\s+REPLACE\s+)?TABLE/i.test(clean)) return 'table';
    if (/^CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(clean)) return 'view';
    if (/^ALTER\s+TABLE/i.test(clean)) return 'alter';
    if (/^CREATE\s+(TRIGGER|PROCEDURE|FUNCTION|EVENT|AGGREGATE)/i.test(clean)) return 'object';
    if (/^COPY\b/i.test(clean)) return 'copy';
    if (/^(UPDATE|DELETE)\b/i.test(clean)) return 'mutation';
    return 'other';
  }

  function handleSqlChunk(chunk: Extract<Chunk, { kind: 'sql' }>) {
    const text = chunk.text;
    totalStatements++;
    // The splitter keeps the comments that precede a statement, so the parsers
    // always work on a comment free version of the statement.
    const clean = stripCommentsKeepVersioned(text).trim();
    const kind = classify(clean);
    if (statements.length < MAX_STATEMENTS && text.length < MAX_STATEMENT_LENGTH) {
      statements.push({
        index: statements.length,
        kind,
        title: summarize(text),
        line: chunk.line,
        text,
      });
    }

    switch (kind) {
      case 'table':
        handleCreateTable(clean);
        break;
      case 'index':
        handleCreateIndex(clean);
        break;
      case 'alter':
        handleAlter(clean);
        break;
      case 'insert':
        handleInsert(clean, opts.dialect);
        break;
      case 'view': {
        const state = findTable(viewName(clean), null);
        if (state) state.rawSql.push(text);
        break;
      }
      case 'object':
      case 'mutation':
      case 'other': {
        const state = findTable(firstIdentifier(clean), null);
        if (state) state.rawSql.push(text);
        break;
      }
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- *
   * Streaming
   * ---------------------------------------------------------------- */
  const splitter = createSplitter((chunk) => {
    if (chunk.kind === 'copy') {
      handleCopy(chunk, opts.dialect);
    } else {
      handleSqlChunk(chunk);
    }
  });

  const decoder = new TextDecoder(opts.encoding);
  const reader = (opts.source ?? opts.file.stream()).getReader();
  let bytesRead = 0;
  const total = opts.totalSize ?? opts.file.size ?? 1;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    const text = decoder.decode(value, { stream: true });
    splitter.push(text);
    if (bytesRead % (4 * 1024 * 1024) < value.byteLength) {
      onProgress('parsing', Math.min(99, (bytesRead / total) * 100), `${(bytesRead / 1048576).toFixed(1)} MB`);
      db.exec('COMMIT');
      db.exec('BEGIN');
    }
  }
  const tail = decoder.decode();
  if (tail) splitter.push(tail);
  splitter.end();

  /* ---------------------------------------------------------------- *
   * Finalise
   * ---------------------------------------------------------------- */
  onProgress('indexing', 99);

  for (const state of tables.values()) {
    if (!state.created && state.columns.length === 0) continue;
    createTableInDb(state);
  }

  // Persist metadata
  const metaTable = `${META_PREFIX}tables`;
  db.exec(`CREATE TABLE IF NOT EXISTS ${metaTable} (
    name TEXT PRIMARY KEY,
    schema_name TEXT,
    sqlite_name TEXT,
    type TEXT,
    row_count INTEGER,
    ddl TEXT,
    comment TEXT,
    columns_json TEXT,
    indexes_json TEXT,
    fks_json TEXT,
    raw_sql TEXT
  )`);
  const metaStmt = db.prepare(
    `INSERT OR REPLACE INTO ${metaTable}
     (name, schema_name, sqlite_name, type, row_count, ddl, comment, columns_json, indexes_json, fks_json, raw_sql)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const state of tables.values()) {
    if (!state.columns.length && state.type === 'table') continue;
    metaStmt.bind(1, state.name);
    metaStmt.bind(2, state.schema);
    metaStmt.bind(3, state.sqliteName);
    metaStmt.bind(4, state.type);
    metaStmt.bind(5, state.rowCount);
    metaStmt.bind(6, state.ddl);
    metaStmt.bind(7, state.comment);
    metaStmt.bind(8, JSON.stringify(state.columns));
    metaStmt.bind(9, JSON.stringify(state.indexes));
    metaStmt.bind(10, JSON.stringify(state.foreignKeys));
    metaStmt.bind(11, state.rawSql.join('\n\n'));
    metaStmt.stepReset();
  }
  metaStmt.finalize();

  db.exec(
    `CREATE TABLE IF NOT EXISTS ${META_PREFIX}statements (
      idx INTEGER PRIMARY KEY, kind TEXT, title TEXT, line INTEGER, text TEXT)`,
  );
  const stmtMeta = db.prepare(`INSERT INTO ${META_PREFIX}statements (idx, kind, title, line, text) VALUES (?, ?, ?, ?, ?)`);
  for (const s of statements) {
    stmtMeta.bind(1, s.index);
    stmtMeta.bind(2, s.kind);
    stmtMeta.bind(3, s.title);
    stmtMeta.bind(4, s.line);
    stmtMeta.bind(5, s.text);
    stmtMeta.stepReset();
  }
  stmtMeta.finalize();

  for (const state of tables.values()) {
    if (state.stmt) {
      try {
        state.stmt.finalize();
      } catch {
        /* ignore */
      }
      state.stmt = null;
    }
  }
  if (searchStmt) searchStmt.finalize();

  db.exec('COMMIT');
  db.exec('ANALYZE');

  const result: TableMeta[] = [];
  for (const state of tables.values()) {
    if (!state.columns.length && state.type === 'table') continue;
    result.push({
      name: state.name,
      sqliteName: state.sqliteName,
      type: state.type,
      rowCount: state.rowCount,
      bytes: 0,
      columns: state.columns,
      indexes: state.indexes,
      foreignKeys: state.foreignKeys,
      ddl: state.ddl,
      comment: state.comment,
      rawSql: state.rawSql,
    });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));

  return { tables: result, statements, totalStatements, warnings };
}

function summarize(text: string): string {
  const clean = stripCommentsKeepVersioned(text).trim().replace(/\s+/g, ' ');
  if (clean.length <= 90) return clean;
  return clean.slice(0, 90) + '…';
}

function viewName(text: string): string {
  const m = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([^\s(]+)/i.exec(text);
  return m ? m[1].replace(/^[`"[]|[`"\]]$/g, '') : '';
}

function firstIdentifier(text: string): string {
  const m = /(?:INTO|TABLE|UPDATE)\s+([`"[]?[^\s(,;]+)/i.exec(text);
  return m ? m[1].replace(/^[`"[]|[`"\]]$/g, '') : '';
}
