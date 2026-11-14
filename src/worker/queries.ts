import { META_PREFIX } from './importer';
import { quoteIdent } from './sqlite';
import { createSplitter } from './sql/splitter';
import { mapAffinity } from './sql/dialect';
import type {
  ColumnFilter,
  ColumnMeta,
  ColumnProfile,
  DiffResult,
  DuplicateGroup,
  DuplicateResult,
  ExecResult,
  ForeignKeyMeta,
  GlobalStats,
  IndexMeta,
  RelationEdge,
  RowsQuery,
  RowsResult,
  SearchHit,
  SearchResult,
  SortSpec,
  TableMeta,
} from './protocol';

export const META_TABLES = `${META_PREFIX}tables`;
export const META_STATEMENTS = `${META_PREFIX}statements`;
export const META_FTS = `${META_PREFIX}fts`;

export interface QueryContext {
  db: any;
  tables: TableMeta[];
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Finds a table by its display name or its internal SQLite name. */
export function findTableMeta(tables: TableMeta[], name: string | null | undefined): TableMeta | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return (
    tables.find((t) => t.name.toLowerCase() === lower) ??
    tables.find((t) => t.sqliteName.toLowerCase() === lower)
  );
}

/** Returns the real column names of a table, in storage order. */
export function dbColumnNames(db: any, sqliteName: string): string[] {
  try {
    const rows = db.selectArrays(`PRAGMA table_info(${quoteIdent(sqliteName)})`);
    return rows.map((r: any[]) => String(r[1]));
  } catch {
    return [];
  }
}

export function countRows(db: any, sqliteName: string): number {
  try {
    const value = db.selectValue(`SELECT COUNT(*) FROM ${quoteIdent(sqliteName)}`);
    return Number(value) || 0;
  } catch {
    return 0;
  }
}

/**
 * Most frequent values of a column, used by the quick filter popover.
 * `null` is reported as a literal NULL bucket.
 */
export function distinctValues(
  ctx: QueryContext,
  tableName: string,
  column: string,
  limit = 40,
): { value: string | null; count: number }[] {
  const meta = findTableMeta(ctx.tables, tableName);
  if (!meta) return [];
  const cols = dbColumnNames(ctx.db, meta.sqliteName);
  const target = cols.find((c) => c.toLowerCase() === column.toLowerCase());
  if (!target) return [];
  try {
    const rows = ctx.db.selectArrays(
      `SELECT ${quoteIdent(target)} AS v, COUNT(*) AS c
         FROM ${quoteIdent(meta.sqliteName)}
        GROUP BY v
        ORDER BY c DESC, v
        LIMIT ?`,
      [limit],
    );
    return rows.map((row: any[]) => ({
      value: row[0] === null || row[0] === undefined ? null : String(row[0]),
      count: Number(row[1]) || 0,
    }));
  } catch {
    return [];
  }
}

/** Size of the whole database file in bytes. */
export function dbTotalBytes(db: any): number {
  try {
    const pages = Number(db.selectValue('PRAGMA page_count')) || 0;
    const size = Number(db.selectValue('PRAGMA page_size')) || 0;
    return pages * size;
  } catch {
    return 0;
  }
}

/** Per table size using the `dbstat` virtual table (when compiled in). */
export function tableBytes(db: any, sqliteName: string): number {
  try {
    const value = db.selectValue(
      `SELECT COALESCE(SUM(pgsize), 0) FROM dbstat WHERE name = ?`,
      [sqliteName],
    );
    return Number(value) || 0;
  } catch {
    return 0;
  }
}

export function hasFtsIndex(db: any): boolean {
  try {
    const row = db.selectValue(
      `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [META_FTS],
    );
    return Number(row) > 0;
  } catch {
    return false;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => '\\' + m);
}

/** `selectValue` throws when a bind list is given for a statement without parameters. */
function selectValue(db: any, sql: string, params: unknown[] = []): unknown {
  return params.length ? db.selectValue(sql, params) : db.selectValue(sql);
}

function affinityOf(meta: TableMeta | undefined, column: string): ColumnMeta['affinity'] {
  if (!meta) return 'TEXT';
  const found = meta.columns.find((c) => c.name.toLowerCase() === column.toLowerCase());
  return found ? found.affinity : 'TEXT';
}

/* ------------------------------------------------------------------ *
 * Table listing
 * ------------------------------------------------------------------ */

export function listTables(ctx: QueryContext): TableMeta[] {
  const { db, tables } = ctx;
  const total = dbTotalBytes(db);
  const perTable = tableBytes(db, '__none__');
  const fallbackShare = perTable > 0 ? total / Math.max(tables.length, 1) : 0;

  return tables.map((t) => {
    const rowCount = countRows(db, t.sqliteName);
    const bytes = tableBytes(db, t.sqliteName) || (total > 0 ? fallbackShare : 0);
    return { ...t, rowCount, bytes: Math.round(bytes) };
  });
}

/* ------------------------------------------------------------------ *
 * Rows: filter + search + sort + pagination
 * ------------------------------------------------------------------ */

function buildWhere(
  meta: TableMeta,
  cols: string[],
  query: RowsQuery,
): { where: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  const filters: ColumnFilter[] = query.filters ?? [];
  for (const f of filters) {
    const match = cols.find((c) => c.toLowerCase() === f.column.toLowerCase());
    if (!match) continue;
    const col = quoteIdent(match);
    const affinity = affinityOf(meta, match);
    switch (f.op) {
      case 'isnull':
        parts.push(`${col} IS NULL`);
        break;
      case 'notnull':
        parts.push(`${col} IS NOT NULL`);
        break;
      case 'contains':
        parts.push(`CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(f.value)}%`);
        break;
      case 'starts':
        parts.push(`CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`);
        params.push(`${escapeLike(f.value)}%`);
        break;
      case 'ends':
        parts.push(`CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(f.value)}`);
        break;
      case 'equals': {
        const numeric =
          affinity === 'INTEGER' || affinity === 'REAL' || affinity === 'NUMERIC';
        const asNumber = Number(f.value);
        if (numeric && f.value.trim() !== '' && !Number.isNaN(asNumber)) {
          // Compare as a number so 1 matches 1 and 1.0 instead of the text form.
          parts.push(`${col} = ?`);
          params.push(asNumber);
        } else {
          parts.push(`CAST(${col} AS TEXT) = ?`);
          params.push(f.value);
        }
        break;
      }
      case 'gt':
      case 'lt': {
        const numeric =
          affinity === 'INTEGER' || affinity === 'REAL' || affinity === 'NUMERIC';
        parts.push(`${col} ${f.op === 'gt' ? '>' : '<'} ?`);
        params.push(numeric ? Number(f.value) : f.value);
        break;
      }
      default:
        break;
    }
  }

  const search = (query.search ?? '').trim();
  if (search) {
    const needle = `%${escapeLike(search)}%`;
    const like = cols.map((c) => `CAST(${quoteIdent(c)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ');
    parts.push(`(${like})`);
    for (let i = 0; i < cols.length; i++) params.push(needle);
  }

  return { where: parts.length ? parts.join(' AND ') : '', params };
}

function buildOrder(
  query: RowsQuery,
  cols: string[],
  meta: TableMeta | undefined,
  withRowid: boolean,
): string {
  const parts: string[] = [];

  for (const spec of resolveSorts(query)) {
    const match = cols.find((c) => c.toLowerCase() === spec.column.toLowerCase());
    if (!match) continue;
    const dir = spec.dir === 'desc' ? 'DESC' : 'ASC';
    const quoted = quoteIdent(match);
    const affinity = affinityOf(meta, match);

    if (affinity === 'TEXT') {
      // Case-insensitive first (so "apple" sorts next to "Apple"),
      // then the raw value as a deterministic tie breaker.
      parts.push(`${quoted} COLLATE NOCASE ${dir}`, `${quoted} ${dir}`);
    } else {
      parts.push(`${quoted} ${dir}`);
    }
  }

  // Stable order for equal keys.
  if (withRowid) parts.push('rowid ASC');

  return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
}

/** Returns the effective sort list (multi sort wins over the legacy pair). */
export function resolveSorts(query: RowsQuery): SortSpec[] {
  if (query.sorts?.length) return query.sorts;
  if (query.sortColumn) return [{ column: query.sortColumn, dir: query.sortDir ?? 'asc' }];
  return [];
}

export function getRows(ctx: QueryContext, tableName: string, query: RowsQuery): RowsResult {
  const { db, tables } = ctx;
  const meta = findTableMeta(tables, tableName);
  if (!meta) throw new Error(`Unknown table: ${tableName}`);

  const cols = dbColumnNames(db, meta.sqliteName);
  if (!cols.length) return { columns: [], rows: [], total: 0, rowids: [] };

  const { where, params } = buildWhere(meta, cols, query);
  const whereSql = where ? ` WHERE ${where}` : '';

  const total = Number(selectValue(db, `SELECT COUNT(*) FROM ${quoteIdent(meta.sqliteName)}${whereSql}`, params)) || 0;

  const limit = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 5000);
  const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
  const order = buildOrder(query, cols, meta, true);
  const orderNoRowid = buildOrder(query, cols, meta, false);

  const projection = cols.map(quoteIdent).join(', ');
  let raw: any[][];
  let rowids: number[] = [];
  try {
    const sql = `SELECT rowid AS __sds_rowid, ${projection} FROM ${quoteIdent(meta.sqliteName)}${whereSql}${order} LIMIT ? OFFSET ?`;
    raw = db.selectArrays(sql, [...params, limit, offset]);
    rowids = raw.map((r) => Number(r[0]));
    raw = raw.map((r) => r.slice(1));
  } catch {
    // Views and WITHOUT ROWID tables have no rowid - fall back to a plain select.
    const sql = `SELECT ${projection} FROM ${quoteIdent(meta.sqliteName)}${whereSql}${orderNoRowid} LIMIT ? OFFSET ?`;
    raw = db.selectArrays(sql, [...params, limit, offset]);
    rowids = raw.map((_, i) => i + 1);
  }

  return { columns: cols, rows: raw, total, rowids };
}

/** Reads every row matching the query (used by the export feature). */
export function fetchRows(
  ctx: QueryContext,
  tableName: string,
  query: RowsQuery,
  maxRows = 200_000,
): { columns: string[]; rows: unknown[][] } {
  const { db, tables } = ctx;
  const meta = findTableMeta(tables, tableName);
  if (!meta) throw new Error(`Unknown table: ${tableName}`);
  const cols = dbColumnNames(db, meta.sqliteName);
  if (!cols.length) return { columns: [], rows: [] };
  const { where, params } = buildWhere(meta, cols, query);
  const whereSql = where ? ` WHERE ${where}` : '';
  const order = buildOrder(query, cols, meta, true);
  const orderNoRowid = buildOrder(query, cols, meta, false);
  const projection = cols.map(quoteIdent).join(', ');
  let rows: any[][] = [];
  try {
    rows = db.selectArrays(
      `SELECT ${projection} FROM ${quoteIdent(meta.sqliteName)}${whereSql}${order} LIMIT ?`,
      [...params, maxRows],
    );
  } catch {
    rows = db.selectArrays(
      `SELECT ${projection} FROM ${quoteIdent(meta.sqliteName)}${whereSql}${orderNoRowid} LIMIT ?`,
      [...params, maxRows],
    );
  }
  return { columns: cols, rows };
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

function rowValues(db: any, meta: TableMeta, rid: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    const cols = dbColumnNames(db, meta.sqliteName);
    const row = db.selectArrays(
      `SELECT ${cols.map(quoteIdent).join(', ')} FROM ${quoteIdent(meta.sqliteName)} WHERE rowid = ?`,
      [rid],
    )[0];
    if (!row) return out;
    cols.forEach((c, i) => {
      out[c] = row[i] ?? null;
    });
  } catch {
    /* ignore */
  }
  return out;
}

function snippetFor(row: Record<string, unknown>, term: string): string {
  const lower = term.toLowerCase();
  for (const value of Object.values(row)) {
    if (typeof value !== 'string') continue;
    const idx = value.toLowerCase().indexOf(lower);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 40);
    const end = Math.min(value.length, idx + term.length + 40);
    return (start > 0 ? '…' : '') + value.slice(start, end) + (end < value.length ? '…' : '');
  }
  const first = Object.values(row).find((v) => typeof v === 'string' && v.length);
  return typeof first === 'string' ? first.slice(0, 120) : '';
}

function searchWithLike(
  ctx: QueryContext,
  term: string,
  tableName: string | null,
  limit: number,
): SearchHit[] {
  const { db, tables } = ctx;
  const hits: SearchHit[] = [];
  const needle = `%${escapeLike(term)}%`;

  for (const meta of tables) {
    if (hits.length >= limit) break;
    if (tableName && meta.name.toLowerCase() !== tableName.toLowerCase()) continue;
    const cols = dbColumnNames(db, meta.sqliteName);
    if (!cols.length) continue;
    const like = cols.map((c) => `CAST(${quoteIdent(c)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ');
    const remaining = limit - hits.length;
    let raw: any[][];
    try {
      raw = db.selectArrays(
        `SELECT ${cols.map(quoteIdent).join(', ')} FROM ${quoteIdent(meta.sqliteName)} WHERE ${like} LIMIT ?`,
        [...cols.map(() => needle), remaining],
      );
    } catch {
      continue;
    }
    for (const row of raw) {
      const values: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        values[c] = row[i] ?? null;
      });
      hits.push({
        table: meta.name,
        rowid: hits.length + 1,
        snippet: snippetFor(values, term),
        values,
      });
    }
  }
  return hits;
}

export function search(
  ctx: QueryContext,
  term: string,
  tableName: string | null,
  limit = 100,
): SearchResult {
  const { db, tables } = ctx;
  const trimmed = term.trim();
  if (!trimmed) return { hits: [], total: 0, truncated: false };

  const capped = Math.min(Math.max(limit, 1), 500);

  if (hasFtsIndex(db)) {
    try {
      const match = `"${trimmed.replace(/"/g, '""')}"`;
      const rows = db.selectArrays(
        `SELECT tname, rid, snippet(${META_FTS}, 1, '«', '»', '…', 14)
           FROM ${META_FTS}
          WHERE ${META_FTS} MATCH ?${tableName ? ' AND tname = ?' : ''}
          ORDER BY bm25(${META_FTS})
          LIMIT ?`,
        tableName ? [match, tableName, capped + 1] : [match, capped + 1],
      );
      const truncated = rows.length > capped;
      const hits: SearchHit[] = [];
      for (const row of rows.slice(0, capped)) {
        const tname = String(row[0]);
        const rid = Number(row[1]);
        const meta = findTableMeta(tables, tname);
        if (!meta) continue;
        const values = rowValues(db, meta, rid);
        hits.push({
          table: meta.name,
          rowid: rid,
          snippet: String(row[2] ?? ''),
          values,
        });
      }
      if (hits.length) return { hits, total: hits.length, truncated };
    } catch (err) {
      console.warn('FTS search failed, falling back to LIKE', err);
    }
  }

  const hits = searchWithLike(ctx, trimmed, tableName, capped);
  return { hits, total: hits.length, truncated: hits.length >= capped };
}

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

function resolveTableName(tables: TableMeta[], base: string): TableMeta | undefined {
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const candidates: string[] = [];
  if (base.endsWith('y')) candidates.push(base.slice(0, -1) + 'ies');
  candidates.push(base, base + 's', base + 'es');
  if (base.endsWith('s')) candidates.push(base.slice(0, -1));
  for (const c of candidates) {
    const found = byName.get(c);
    if (found) return found;
  }
  return undefined;
}

export function buildRelations(tables: TableMeta[]): RelationEdge[] {
  const edges: RelationEdge[] = [];
  const declaredPairs = new Set<string>();

  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (fk.source !== 'declared') continue;
      const id = `${t.name}.${fk.columns.join('+')}->${fk.refTable}.${fk.refColumns.join('+')}`;
      declaredPairs.add(
        `${t.name.toLowerCase()}.${fk.columns.join(',').toLowerCase()}->${fk.refTable.toLowerCase()}`,
      );
      edges.push({
        id,
        fromTable: t.name,
        fromColumns: fk.columns,
        toTable: fk.refTable,
        toColumns: fk.refColumns,
        source: 'declared',
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
      });
    }
  }

  for (const t of tables) {
    for (const col of t.columns) {
      const m = /^(.+)_id$/i.exec(col.name);
      if (!m) continue;
      const target = resolveTableName(tables, m[1].toLowerCase());
      if (!target) continue;
      const key = `${t.name.toLowerCase()}.${col.name.toLowerCase()}->${target.name.toLowerCase()}`;
      if (declaredPairs.has(key)) continue;
      if (
        edges.some(
          (e) =>
            e.source === 'inferred' &&
            e.fromTable === t.name &&
            e.fromColumns[0].toLowerCase() === col.name.toLowerCase(),
        )
      ) {
        continue;
      }
      const targetColumns = target.columns.some((c) => c.name.toLowerCase() === 'id')
        ? ['id']
        : target.columns.filter((c) => c.isPrimaryKey).map((c) => c.name).slice(0, 1);
      if (!targetColumns.length) continue;
      edges.push({
        id: `inferred:${key}`,
        fromTable: t.name,
        fromColumns: [col.name],
        toTable: target.name,
        toColumns: targetColumns,
        source: 'inferred',
        onDelete: null,
        onUpdate: null,
      });
    }
  }

  return edges;
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

export function globalStats(ctx: QueryContext): GlobalStats {
  const { db, tables } = ctx;
  const listed = listTables(ctx);
  const tableCount = listed.filter((t) => t.type === 'table').length;
  const viewCount = listed.filter((t) => t.type === 'view').length;
  const totalRows = listed.reduce((sum, t) => sum + (t.rowCount || 0), 0);
  const totalBytes = listed.reduce((sum, t) => sum + (t.bytes || 0), 0);
  const indexCount = listed.reduce((sum, t) => sum + t.indexes.length, 0);
  const foreignKeyCount = listed.reduce((sum, t) => sum + t.foreignKeys.length, 0);
  const largest = [...listed]
    .sort((a, b) => (b.rowCount || 0) - (a.rowCount || 0) || b.bytes - a.bytes)
    .slice(0, 8)
    .map((t) => ({ table: t.name, rows: t.rowCount || 0, bytes: t.bytes || 0 }));
  void db;
  void tables;
  return {
    tableCount,
    viewCount,
    totalRows,
    totalBytes,
    indexCount,
    foreignKeyCount,
    largest,
  };
}

export function columnProfiles(ctx: QueryContext, tableName: string): ColumnProfile[] {
  const { db, tables } = ctx;
  const meta = findTableMeta(tables, tableName);
  if (!meta) throw new Error(`Unknown table: ${tableName}`);
  const cols = dbColumnNames(db, meta.sqliteName);
  const profiles: ColumnProfile[] = [];

  for (const col of cols) {
    const q = quoteIdent(col);
    let nullCount = 0;
    let nonNullCount = 0;
    let distinctCount = 0;
    let minLength: number | null = null;
    let maxLength: number | null = null;
    let min: unknown = null;
    let max: unknown = null;
    let avg: number | null = null;
    let sum: number | null = null;

    try {
      const row = db.selectArrays(
        `SELECT COUNT(*), COUNT(${q}), COUNT(DISTINCT ${q}),
                MIN(LENGTH(CAST(${q} AS TEXT))), MAX(LENGTH(CAST(${q} AS TEXT))),
                MIN(${q}), MAX(${q}), AVG(CAST(${q} AS REAL)), SUM(CAST(${q} AS REAL))
           FROM ${quoteIdent(meta.sqliteName)}`,
      )[0];
      const total = Number(row?.[0]) || 0;
      nonNullCount = Number(row?.[1]) || 0;
      nullCount = total - nonNullCount;
      distinctCount = Number(row?.[2]) || 0;
      minLength = row?.[3] === null || row?.[3] === undefined ? null : Number(row[3]);
      maxLength = row?.[4] === null || row?.[4] === undefined ? null : Number(row[4]);
      min = row?.[5] ?? null;
      max = row?.[6] ?? null;
      avg = row?.[7] === null || row?.[7] === undefined ? null : Number(row[7]);
      sum = row?.[8] === null || row?.[8] === undefined ? null : Number(row[8]);
    } catch {
      /* ignore */
    }

    let topValues: { value: string; count: number }[] = [];
    try {
      const rows = db.selectArrays(
        `SELECT CAST(${q} AS TEXT) AS v, COUNT(*) AS n
           FROM ${quoteIdent(meta.sqliteName)}
          WHERE ${q} IS NOT NULL
          GROUP BY v
          ORDER BY n DESC
          LIMIT 5`,
      );
      topValues = rows.map((r: any[]) => ({ value: String(r[0] ?? ''), count: Number(r[1]) || 0 }));
    } catch {
      /* ignore */
    }

    profiles.push({
      column: col,
      nullCount,
      nonNullCount,
      distinctCount,
      minLength,
      maxLength,
      min,
      max,
      avg,
      sum,
      topValues,
    });
  }

  return profiles;
}

/* ------------------------------------------------------------------ *
 * Duplicates & table comparison
 * ------------------------------------------------------------------ */

/** Finds groups of rows that share the same values in the given columns. */
export function findDuplicates(
  ctx: QueryContext,
  tableName: string,
  columns?: string[],
  limit = 50,
): DuplicateResult {
  const { db, tables } = ctx;
  const meta = findTableMeta(tables, tableName);
  if (!meta) throw new Error(`Unknown table: ${tableName}`);

  const available = dbColumnNames(db, meta.sqliteName);
  // Without an explicit column list we ignore the primary key: it is unique by
  // definition, so grouping by it could never yield a duplicate.
  const pkNames = meta.columns
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name.toLowerCase());
  const withoutPk = available.filter((column) => !pkNames.includes(column.toLowerCase()));
  const defaults = withoutPk.length ? withoutPk : available;
  const chosen = (columns?.length ? columns : defaults).filter((column) =>
    available.some((c) => c.toLowerCase() === column.toLowerCase()),
  );
  const finalColumns = chosen.length ? chosen : defaults;
  if (!finalColumns.length) {
    return { table: meta.name, columns: [], groupCount: 0, rowCount: 0, groups: [] };
  }

  const groupCols = finalColumns.map((column) => quoteIdent(column)).join(', ');
  const quoted = quoteIdent(meta.sqliteName);

  let groupCount = 0;
  let rowCount = 0;
  try {
    const stats = db.selectArrays(
      `SELECT COUNT(*), COALESCE(SUM(n), 0) FROM (
         SELECT COUNT(*) AS n FROM ${quoted}
          GROUP BY ${groupCols}
         HAVING COUNT(*) > 1
       )`,
    )[0];
    groupCount = Number(stats?.[0]) || 0;
    rowCount = Number(stats?.[1]) || 0;
  } catch {
    /* ignore */
  }

  const groups: DuplicateGroup[] = [];
  try {
    const rows = db.selectArrays(
      `SELECT ${groupCols}, COUNT(*) AS n
         FROM ${quoted}
        GROUP BY ${groupCols}
       HAVING COUNT(*) > 1
        ORDER BY n DESC, ${groupCols}
        LIMIT ?`,
      [limit],
    );
    for (const row of rows as any[][]) {
      const n = Number(row[finalColumns.length]) || 0;
      groups.push({
        key: finalColumns.map((_, index) => String(row[index] ?? '')).join(' | '),
        count: n,
        values: [finalColumns.map((_, index) => row[index] ?? null)],
      });
    }
  } catch {
    /* ignore */
  }

  return { table: meta.name, columns: finalColumns, groupCount, rowCount, groups };
}

/** Compares two tables row by row using the given key column pairs. */
export function diffTables(
  ctx: QueryContext,
  leftName: string,
  rightName: string,
  keyPairs?: { left: string; right: string }[],
  limit = 50,
): DiffResult {
  const { db, tables } = ctx;
  const leftMeta = findTableMeta(tables, leftName);
  const rightMeta = findTableMeta(tables, rightName);
  if (!leftMeta) throw new Error(`Unknown table: ${leftName}`);
  if (!rightMeta) throw new Error(`Unknown table: ${rightName}`);

  const leftColumns = dbColumnNames(db, leftMeta.sqliteName);
  const rightColumns = dbColumnNames(db, rightMeta.sqliteName);
  const leftLower = new Map(leftColumns.map((c) => [c.toLowerCase(), c]));
  const rightLower = new Map(rightColumns.map((c) => [c.toLowerCase(), c]));

  const commonColumns = leftColumns.filter((column) => rightLower.has(column.toLowerCase()));
  const onlyLeftColumns = leftColumns.filter((column) => !rightLower.has(column.toLowerCase()));
  const onlyRightColumns = rightColumns.filter((column) => !leftLower.has(column.toLowerCase()));

  /* Auto-detect the key pairs: primary key first, then shared column names. */
  let pairs: { left: string; right: string }[] = [];
  if (keyPairs?.length) {
    pairs = keyPairs.filter(
      (pair) => leftLower.has(pair.left.toLowerCase()) && rightLower.has(pair.right.toLowerCase()),
    );
  }
  if (!pairs.length) {
    const leftPk = leftMeta.columns.find((column) => column.isPrimaryKey)?.name;
    const rightPk = rightMeta.columns.find((column) => column.isPrimaryKey)?.name;
    if (leftPk && rightPk && leftLower.has(leftPk.toLowerCase()) && rightLower.has(rightPk.toLowerCase())) {
      pairs = [{ left: leftLower.get(leftPk.toLowerCase())!, right: rightLower.get(rightPk.toLowerCase())! }];
    }
  }
  if (!pairs.length) {
    const shared = commonColumns.find((column) => /^(id|.*_id)$/i.test(column));
    if (shared) pairs = [{ left: shared, right: shared }];
  }

  const lq = quoteIdent(leftMeta.sqliteName);
  const rq = quoteIdent(rightMeta.sqliteName);

  const counts = { leftRows: 0, rightRows: 0, onlyLeft: 0, onlyRight: 0, changed: 0, identical: 0 };
  try {
    const row = db.selectArrays(
      `SELECT (SELECT COUNT(*) FROM ${lq}), (SELECT COUNT(*) FROM ${rq})`,
    )[0];
    counts.leftRows = Number(row?.[0]) || 0;
    counts.rightRows = Number(row?.[1]) || 0;
  } catch {
    /* ignore */
  }

  const onlyLeftRows: unknown[][] = [];
  const onlyRightRows: unknown[][] = [];
  const changedRows: DiffResult['changedRows'] = [];

  if (!pairs.length) {
    return {
      left: leftMeta.name,
      right: rightMeta.name,
      leftColumns,
      rightColumns,
      commonColumns,
      onlyLeftColumns,
      onlyRightColumns,
      keyPairs: [],
      counts,
      onlyLeftRows,
      onlyRightRows,
      changedRows,
      truncated: false,
    };
  }

  const onClause = pairs
    .map((pair) => `l.${quoteIdent(pair.left)} = r.${quoteIdent(pair.right)}`)
    .join(' AND ');
  const leftKeyExpr = pairs.map((pair) => `l.${quoteIdent(pair.left)}`).join(" || '␟' || ");

  try {
    const only = db.selectArrays(
      `SELECT COUNT(*) FROM ${lq} l WHERE NOT EXISTS (SELECT 1 FROM ${rq} r WHERE ${onClause})`,
    )[0];
    counts.onlyLeft = Number(only?.[0]) || 0;
  } catch {
    /* ignore */
  }
  try {
    const only = db.selectArrays(
      `SELECT COUNT(*) FROM ${rq} r WHERE NOT EXISTS (SELECT 1 FROM ${lq} l WHERE ${onClause})`,
    )[0];
    counts.onlyRight = Number(only?.[0]) || 0;
  } catch {
    /* ignore */
  }

  const comparedColumns = commonColumns.filter(
    (column) => !pairs.some((pair) => pair.left.toLowerCase() === column.toLowerCase()),
  );
  const diffPredicate = comparedColumns
    .map(
      (column) =>
        `l.${quoteIdent(column)} IS NOT r.${quoteIdent(column)}`,
    )
    .join(' OR ');

  if (diffPredicate) {
    try {
      const changed = db.selectArrays(
        `SELECT COUNT(*) FROM ${lq} l JOIN ${rq} r ON ${onClause} WHERE ${diffPredicate}`,
      )[0];
      counts.changed = Number(changed?.[0]) || 0;
      counts.identical = Math.max(0, counts.leftRows - counts.onlyLeft - counts.changed);
    } catch {
      /* ignore */
    }
  } else {
    const joined = db.selectArrays(
      `SELECT COUNT(*) FROM ${lq} l JOIN ${rq} r ON ${onClause}`,
    )[0];
    const matched = Number(joined?.[0]) || 0;
    counts.changed = 0;
    counts.identical = Math.max(0, matched - counts.onlyLeft);
  }

  const leftSelect = leftColumns.map((column) => `l.${quoteIdent(column)}`).join(', ');
  const rightSelect = rightColumns.map((column) => `r.${quoteIdent(column)}`).join(', ');

  try {
    const rows = db.selectArrays(
      `SELECT ${leftSelect}, ${leftKeyExpr} FROM ${lq} l
        WHERE NOT EXISTS (SELECT 1 FROM ${rq} r WHERE ${onClause})
        LIMIT ?`,
      [limit],
    );
    for (const row of rows as any[][]) {
      onlyLeftRows.push(leftColumns.map((_, index) => row[index] ?? null));
    }
  } catch {
    /* ignore */
  }

  try {
    const rows = db.selectArrays(
      `SELECT ${rightSelect} FROM ${rq} r
        WHERE NOT EXISTS (SELECT 1 FROM ${lq} l WHERE ${onClause})
        LIMIT ?`,
      [limit],
    );
    for (const row of rows as any[][]) {
      onlyRightRows.push(rightColumns.map((_, index) => row[index] ?? null));
    }
  } catch {
    /* ignore */
  }

  if (diffPredicate) {
    try {
      const rows = db.selectArrays(
        `SELECT ${leftSelect}, ${rightSelect}, ${leftKeyExpr}
           FROM ${lq} l JOIN ${rq} r ON ${onClause}
          WHERE ${diffPredicate}
          LIMIT ?`,
        [limit],
      );
      for (const row of rows as any[][]) {
        const leftValues = leftColumns.map((_, index) => row[index] ?? null);
        const rightValues = rightColumns.map((_, index) => row[leftColumns.length + index] ?? null);
        const key = String(row[leftColumns.length + rightColumns.length] ?? '');
        const changedColumns = commonColumns.filter((column) => {
          const leftValue = leftValues[leftColumns.findIndex((c) => c === column)] ?? null;
          const rightValue = rightValues[rightColumns.findIndex((c) => c === column)] ?? null;
          return leftValue !== rightValue;
        });
        changedRows.push({ key, left: leftValues, right: rightValues, changedColumns });
      }
    } catch {
      /* ignore */
    }
  }

  return {
    left: leftMeta.name,
    right: rightMeta.name,
    leftColumns,
    rightColumns,
    commonColumns,
    onlyLeftColumns,
    onlyRightColumns,
    keyPairs: pairs,
    counts,
    onlyLeftRows,
    onlyRightRows,
    changedRows,
    truncated:
      counts.onlyLeft > onlyLeftRows.length ||
      counts.onlyRight > onlyRightRows.length ||
      counts.changed > changedRows.length,
  };
}

/* ------------------------------------------------------------------ *
 * SQL editor
 * ------------------------------------------------------------------ */

export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  const splitter = createSplitter((chunk) => {
    if (chunk.kind === 'sql') out.push(chunk.text);
  });
  splitter.push(sql);
  splitter.end();
  return out;
}

export function execSql(ctx: QueryContext, sql: string): ExecResult {
  const { db } = ctx;
  const started = Date.now();
  const statements = splitSqlStatements(sql).filter((s) => s.trim().length);
  if (!statements.length) {
    return { columns: [], rows: [], rowCount: 0, durationMs: Date.now() - started };
  }

  let lastColumns: string[] = [];
  let lastRows: unknown[][] = [];
  let lastRowCount = 0;

  for (const statement of statements) {
    const columnNames: string[] = [];
    const resultRows: Record<string, unknown>[] = [];
    let stmt: any = null;
    try {
      stmt = db.prepare(statement);
      const names = stmt.getColumnNames?.() ?? [];
      if (Array.isArray(names)) columnNames.push(...names);
      while (stmt.step()) {
        resultRows.push(stmt.get({ rowMode: 'object' }));
      }
    } catch (err) {
      return {
        columns: lastColumns,
        rows: lastRows,
        rowCount: lastRowCount,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      try {
        stmt?.finalize?.();
      } catch {
        /* ignore */
      }
    }
    if (columnNames.length) {
      lastColumns = columnNames;
      lastRows = resultRows.map((r) => columnNames.map((c) => r[c] ?? null));
      lastRowCount = resultRows.length;
    }
  }

  return {
    columns: lastColumns,
    rows: lastRows,
    rowCount: lastRowCount,
    durationMs: Date.now() - started,
  };
}

/* ------------------------------------------------------------------ *
 * Schema inspection (native SQLite files)
 * ------------------------------------------------------------------ */

/** Reads the schema of a database that was not produced by the importer. */
export function inspectSqliteSchema(db: any): TableMeta[] {
  const out: TableMeta[] = [];
  let master: any[][] = [];
  try {
    master = db.selectArrays(
      `SELECT type, name, sql FROM sqlite_master
        WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    );
  } catch {
    return out;
  }

  for (const row of master) {
    const type = String(row[0]) === 'view' ? 'view' : 'table';
    const name = String(row[1]);
    const sql = row[2] ? String(row[2]) : '';

    const columns: ColumnMeta[] = [];
    try {
      const info = db.selectArrays(`PRAGMA table_info(${quoteIdent(name)})`) as any[][];
      info.forEach((c, i) => {
        const originalType = String(c[2] ?? 'TEXT');
        columns.push({
          name: String(c[1]),
          originalType,
          affinity: mapAffinity(originalType),
          nullable: !(Number(c[3]) || 0),
          defaultValue: c[4] === null || c[4] === undefined ? null : String(c[4]),
          isPrimaryKey: (Number(c[5]) || 0) > 0,
          isAutoIncrement: /AUTOINCREMENT|IDENTITY/i.test(sql),
          comment: null,
          ordinal: i,
        });
      });
    } catch {
      /* ignore */
    }

    const indexes: IndexMeta[] = [];
    try {
      const list = db.selectArrays(`PRAGMA index_list(${quoteIdent(name)})`);
      for (const item of list) {
        const origin = String(item[3] ?? 'c');
        if (origin === 'pk') continue;
        const indexName = String(item[1]);
        const info = db.selectArrays(`PRAGMA index_info(${quoteIdent(indexName)})`);
        indexes.push({
          name: indexName,
          unique: (Number(item[2]) || 0) > 0,
          columns: info.map((x: any[]) => String(x[2])),
        });
      }
    } catch {
      /* ignore */
    }

    const foreignKeys: ForeignKeyMeta[] = [];
    try {
      const list = db.selectArrays(`PRAGMA foreign_key_list(${quoteIdent(name)})`);
      const grouped = new Map<number, { columns: string[]; refTable: string; refColumns: string[]; onDelete: string | null; onUpdate: string | null }>();
      for (const item of list) {
        const id = Number(item[0]);
        const group = grouped.get(id) ?? {
          columns: [],
          refTable: String(item[2]),
          refColumns: [],
          onDelete: null,
          onUpdate: null,
        };
        group.columns.push(String(item[3]));
        const refCol = item[4] === null || item[4] === undefined ? '' : String(item[4]);
        group.refColumns.push(refCol);
        group.onUpdate = item[5] ? String(item[5]) : null;
        group.onDelete = item[6] ? String(item[6]) : null;
        grouped.set(id, group);
      }
      for (const group of grouped.values()) {
        foreignKeys.push({
          constraint: null,
          columns: group.columns,
          refTable: group.refTable,
          refColumns: group.refColumns.map((c) => c || 'id'),
          onDelete: group.onDelete,
          onUpdate: group.onUpdate,
          source: 'declared',
        });
      }
    } catch {
      /* ignore */
    }

    out.push({
      name,
      sqliteName: name,
      type,
      rowCount: 0,
      bytes: 0,
      columns,
      indexes,
      foreignKeys,
      ddl: sql,
      comment: null,
      rawSql: [],
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Metadata readers (used by the SQL viewer)
 * ------------------------------------------------------------------ */

export function readStatements(ctx: QueryContext): { index: number; kind: string; title: string; line: number; text: string }[] {
  const { db } = ctx;
  try {
    const rows = db.selectArrays(
      `SELECT idx, kind, title, line, text FROM ${META_STATEMENTS} ORDER BY idx`,
    );
    return rows.map((r: any[]) => ({
      index: Number(r[0]),
      kind: String(r[1] ?? ''),
      title: String(r[2] ?? ''),
      line: Number(r[3] ?? 0),
      text: String(r[4] ?? ''),
    }));
  } catch {
    return [];
  }
}

export function readRawSql(ctx: QueryContext): { table: string; sql: string }[] {
  const { db, tables } = ctx;
  const out: { table: string; sql: string }[] = [];
  for (const meta of tables) {
    for (const sql of meta.rawSql) out.push({ table: meta.name, sql });
  }
  void db;
  return out;
}
