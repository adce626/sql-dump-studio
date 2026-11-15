/**
 * Shared contract between the UI thread and the database worker.
 * The worker owns the SQLite database and the parser; the UI only talks to it
 * through these messages.
 */

export type Affinity = 'INTEGER' | 'REAL' | 'TEXT' | 'BLOB' | 'NUMERIC';

export type Dialect = 'mysql' | 'postgres' | 'mssql' | 'sqlite' | 'generic';

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'sql';

export interface ColumnMeta {
  name: string;
  originalType: string;
  affinity: Affinity;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  comment: string | null;
  ordinal: number;
}

export interface IndexMeta {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface ForeignKeyMeta {
  constraint: string | null;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
  source: 'declared' | 'inferred';
}

export interface TableMeta {
  name: string;
  sqliteName: string;
  type: 'table' | 'view';
  rowCount: number;
  bytes: number;
  columns: ColumnMeta[];
  indexes: IndexMeta[];
  foreignKeys: ForeignKeyMeta[];
  ddl: string;
  comment: string | null;
  /** Statements that could not be executed but are kept for display. */
  rawSql: string[];
}

export interface FileInfo {
  name: string;
  size: number;
  encoding: string;
  dialect: Dialect;
  importedAt: number;
  mode: 'opfs' | 'memory';
  isNativeSqlite: boolean;
  /** Identifier of the persisted session (the OPFS database file). */
  sessionId: string;
}

/** A file that was opened before and can be restored without uploading it again. */
export interface SessionInfo {
  id: string;
  name: string;
  size: number;
  dialect: Dialect;
  importedAt: number;
  kind: 'dump' | 'native';
  mode: 'opfs' | 'memory';
  tableCount: number;
  rowCount: number;
}

export interface SortSpec {
  column: string;
  dir: 'asc' | 'desc';
}

export interface RowsQuery {
  offset?: number;
  limit?: number;
  /** Legacy single column sort (kept for older callers). */
  sortColumn?: string | null;
  sortDir?: 'asc' | 'desc';
  /** Multi column sort; takes precedence over sortColumn / sortDir. */
  sorts?: SortSpec[];
  /** Per column filter: exact / contains / starts / gt / lt / is-null */
  filters?: ColumnFilter[];
  search?: string | null;
}

export interface ColumnFilter {
  column: string;
  op: 'contains' | 'equals' | 'starts' | 'ends' | 'gt' | 'lt' | 'isnull' | 'notnull';
  value: string;
}

export interface RowsResult {
  columns: string[];
  rows: unknown[][];
  total: number;
  /** Row identifier per returned row (rowid) so the UI can render details. */
  rowids: number[];
}

export interface SearchHit {
  table: string;
  rowid: number;
  snippet: string;
  values: Record<string, unknown>;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  truncated: boolean;
}

export interface RelationEdge {
  id: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  source: 'declared' | 'inferred';
  onDelete: string | null;
  onUpdate: string | null;
}

export interface ColumnProfile {
  column: string;
  nullCount: number;
  nonNullCount: number;
  distinctCount: number;
  minLength: number | null;
  maxLength: number | null;
  min: unknown;
  max: unknown;
  avg: number | null;
  sum: number | null;
  topValues: { value: string; count: number }[];
}

/** A group of rows that share the same values in every selected column. */
export interface DuplicateGroup {
  key: string;
  count: number;
  values: unknown[][];
}

export interface DuplicateResult {
  table: string;
  columns: string[];
  groupCount: number;
  rowCount: number;
  groups: DuplicateGroup[];
}

/** Side-by-side comparison of two tables. */
export interface DiffResult {
  left: string;
  right: string;
  leftColumns: string[];
  rightColumns: string[];
  commonColumns: string[];
  onlyLeftColumns: string[];
  onlyRightColumns: string[];
  keyPairs: { left: string; right: string }[];
  counts: {
    leftRows: number;
    rightRows: number;
    onlyLeft: number;
    onlyRight: number;
    changed: number;
    identical: number;
  };
  onlyLeftRows: unknown[][];
  onlyRightRows: unknown[][];
  changedRows: { key: string; left: unknown[][]; right: unknown[][]; changedColumns: string[] }[];
  truncated: boolean;
}

export interface TableStats {
  table: string;
  rowCount: number;
  bytes: number;
  columnCount: number;
  nullableColumns: number;
  profiles: ColumnProfile[];
}

export interface GlobalStats {
  tableCount: number;
  viewCount: number;
  totalRows: number;
  totalBytes: number;
  indexCount: number;
  foreignKeyCount: number;
  largest: { table: string; rows: number; bytes: number }[];
}

export interface StatementInfo {
  index: number;
  kind: string;
  title: string;
  line: number;
  text: string;
}

export interface OpenOptions {
  encoding?: string | null;
  dialect?: Dialect | 'auto';
  /** When true the parser also builds the full-text search index. */
  buildSearchIndex?: boolean;
  /** Optional allow-list of table names to import. */
  onlyTables?: string[] | null;
}

export interface OpenResult {
  file: FileInfo;
  tables: TableMeta[];
  stats: GlobalStats;
  statements: StatementInfo[];
  warnings: string[];
}

export interface ExecResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  error?: string;
}

/**
 * Details about a file that could not be opened. The UI uses them to show a
 * localized explanation and the exact command that converts the file.
 */
export interface OpenErrorPayload {
  code: 'unsupported-format' | 'unsupported-archive' | 'binary-file' | 'corrupt-archive';
  /** Key of the localized guidance: sqlserver | postgres | customdump | mysql | mssql | binary */
  format?: string;
  /** The extension of the file that was rejected. */
  extension?: string;
  /** English fallback message. */
  message?: string;
  /** Members of an archive that did not contain anything usable. */
  members?: string[];
}

export type WorkerRequest =
  | { id: number; type: 'open'; file: File; options: OpenOptions }
  | { id: number; type: 'tables' }
  | { id: number; type: 'rows'; table: string; query: RowsQuery }
  | { id: number; type: 'search'; term: string; table?: string | null; limit?: number }
  | { id: number; type: 'relations' }
  | { id: number; type: 'stats' }
  | { id: number; type: 'columnProfiles'; table: string }
  | { id: number; type: 'distinct'; table: string; column: string; limit?: number }
  | { id: number; type: 'duplicates'; table: string; columns?: string[]; limit?: number }
  | { id: number; type: 'diff'; left: string; right: string; keyPairs?: { left: string; right: string }[]; limit?: number }
  | { id: number; type: 'exec'; sql: string }
  | { id: number; type: 'export'; table: string; format: ExportFormat; query: RowsQuery; maxRows?: number }
  | { id: number; type: 'statements' }
  | { id: number; type: 'rawSql' }
  | { id: number; type: 'restoreSession'; sessionId: string }
  | { id: number; type: 'deleteSession'; sessionId: string }
  | { id: number; type: 'exportZip' }
  | { id: number; type: 'close' };

export type WorkerResponse =
  | { kind: 'result'; id: number; ok: true; result: unknown }
  | { kind: 'result'; id: number; ok: false; error: string; payload?: OpenErrorPayload }
  | { kind: 'progress'; id: number; phase: string; pct: number; detail?: string };
