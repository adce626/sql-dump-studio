/// <reference lib="webworker" />
import { initSqlite, createDb, writeOpfsStream, removeOpfsFile } from './sqlite';
import { importDump } from './importer';
import { detectDialect, guessEncoding } from './sql/dialect';
import * as Q from './queries';
import { buildExport } from './export';
import { buildPackage } from './package';
import type {
  FileInfo,
  OpenOptions,
  OpenResult,
  StatementInfo,
  TableMeta,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let sqlite3: any = null;
let db: any = null;
let dbMode: 'opfs' | 'memory' = 'memory';
let sessionId: string | null = null;
let tables: TableMeta[] = [];
let fileInfo: FileInfo | null = null;
let statements: StatementInfo[] = [];
let warnings: string[] = [];

/** Key/value table that keeps the session metadata inside the database file. */
const META_META = '_sds_meta';

function post(message: WorkerResponse) {
  scope.postMessage(message);
}

function progress(phase: string, pct: number, detail?: string) {
  post({ kind: 'progress', id: -1, phase, pct, detail });
}

function requireDb(): any {
  if (!db) throw new Error('No database is open. Upload a .sql dump or a .sqlite file first.');
  return db;
}

function context(): Q.QueryContext {
  return { db: requireDb(), tables };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/* ------------------------------------------------------------------ *
 * Session helpers
 * ------------------------------------------------------------------ */

/** Name of the OPFS file that backs a session. */
function sessionFileName(id: string): string {
  return `sds_db_${id}.db`;
}

function newSessionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Stores the session metadata inside the database so it survives a reload. */
function writeMeta(target: any, entries: Record<string, string>) {
  try {
    target.exec(`CREATE TABLE IF NOT EXISTS ${META_META} (key TEXT PRIMARY KEY, value TEXT)`);
    const stmt = target.prepare(`INSERT OR REPLACE INTO ${META_META} (key, value) VALUES (?, ?)`);
    for (const [key, value] of Object.entries(entries)) {
      stmt.bind(1, key);
      stmt.bind(2, value);
      stmt.stepReset();
    }
    stmt.finalize();
  } catch (err) {
    console.warn('Could not write the session metadata', err);
  }
}

/** Reads the session metadata back. */
function readMeta(target: any): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const rows = target.selectArrays(`SELECT key, value FROM ${META_META}`);
    for (const row of rows) out[String(row[0])] = row[1] === null ? '' : String(row[1]);
  } catch {
    /* the table does not exist */
  }
  return out;
}

function parseJson<T>(text: unknown, fallback: T): T {
  try {
    if (typeof text !== 'string' || !text) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Rebuilds the table list from the metadata table of an imported dump. */
function rebuildTables(target: any): TableMeta[] {
  const rows = target.selectArrays(
    `SELECT name, sqlite_name, type, ddl, comment, columns_json, indexes_json, fks_json, raw_sql
     FROM ${Q.META_TABLES} ORDER BY name`,
  );
  const out: TableMeta[] = [];
  for (const row of rows) {
    out.push({
      name: String(row[0]),
      sqliteName: String(row[1] ?? row[0]),
      type: row[2] === 'view' ? 'view' : 'table',
      rowCount: 0,
      bytes: 0,
      columns: parseJson(row[5], []),
      indexes: parseJson(row[6], []),
      foreignKeys: parseJson(row[7], []),
      ddl: row[3] ?? '',
      comment: row[4] ?? null,
      rawSql: row[8] ? String(row[8]).split('\n\n').filter(Boolean) : [],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Opening files
 * ------------------------------------------------------------------ */

function isNativeSqlite(head: Uint8Array): boolean {
  if (head.length < 16) return false;
  const magic = 'SQLite format 3\u0000';
  for (let i = 0; i < magic.length; i++) {
    if (head[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

async function openDump(file: File, options: OpenOptions, stamp: number): Promise<OpenResult> {
  progress('reading', 2, file.name);
  const sample = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
  const guess = guessEncoding(sample);
  const encoding = options.encoding && options.encoding !== 'auto' ? options.encoding : guess.encoding;

  let dialect = options.dialect && options.dialect !== 'auto' ? options.dialect : 'generic';
  if (options.dialect === 'auto' || !options.dialect) {
    try {
      const text = new TextDecoder(encoding).decode(sample.subarray(0, 64 * 1024));
      dialect = detectDialect(text);
    } catch {
      /* keep generic */
    }
  }

  const id = newSessionId();
  const fileName = sessionFileName(id);
  const handle = await createDb(fileName);
  db = handle.db;
  dbMode = handle.mode;
  sessionId = id;

  const outcome = await importDump(
    sqlite3,
    db,
    {
      file,
      encoding,
      dialect,
      buildSearchIndex: options.buildSearchIndex ?? true,
      onlyTables: options.onlyTables ?? null,
    },
    progress,
  );

  tables = outcome.tables;
  statements = outcome.statements;
  warnings = outcome.warnings;

  fileInfo = {
    name: file.name,
    size: file.size,
    encoding,
    dialect,
    importedAt: stamp,
    mode: dbMode,
    isNativeSqlite: false,
    sessionId: id,
  };

  writeMeta(db, {
    sessionId: id,
    name: file.name,
    size: String(file.size),
    encoding,
    dialect,
    importedAt: String(stamp),
    mode: dbMode,
    kind: 'dump',
  });

  return buildOpenResult();
}

async function openNativeSqlite(file: File, stamp: number): Promise<OpenResult> {
  progress('reading', 5, file.name);
  const id = newSessionId();
  const fileName = sessionFileName(id);
  sessionId = id;

  const wrote = await writeOpfsStream(fileName, file);
  if (wrote) {
    try {
      db = new sqlite3.oo1.OpfsDb('/' + fileName);
      db.exec('SELECT 1');
      dbMode = 'opfs';
    } catch (err) {
      console.warn('Could not open the native database through OPFS', err);
      db = null;
    }
  }

  if (!db) {
    progress('loading', 30);
    const bytes = new Uint8Array(await file.arrayBuffer());
    db = new sqlite3.oo1.DB(':memory:', 'ct');
    try {
      const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
      const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', ptr, bytes.length, bytes.length, 1);
      if (rc !== 0) throw new Error('sqlite3_deserialize failed');
    } catch (err) {
      throw new Error(`This .sqlite file could not be opened: ${errorMessage(err)}`);
    }
    dbMode = 'memory';
  }

  tables = Q.inspectSqliteSchema(db);
  statements = [];
  warnings = [];

  fileInfo = {
    name: file.name,
    size: file.size,
    encoding: 'binary',
    dialect: 'sqlite',
    importedAt: stamp,
    mode: dbMode,
    isNativeSqlite: true,
    sessionId: id,
  };

  if (dbMode === 'opfs') {
    writeMeta(db, {
      sessionId: id,
      name: file.name,
      size: String(file.size),
      encoding: 'binary',
      dialect: 'sqlite',
      importedAt: String(stamp),
      mode: dbMode,
      kind: 'native',
    });
  }

  progress('indexing', 90);
  return buildOpenResult();
}

function buildOpenResult(): OpenResult {
  const ctx = context();
  const listed = Q.listTables(ctx);
  tables = listed;
  const stats = Q.globalStats(ctx);
  return {
    file: fileInfo!,
    tables: listed,
    stats,
    statements,
    warnings,
  };
}

/**
 * Closes the current database. The OPFS file is kept on purpose: it is the
 * persisted session that can be restored later without uploading the file again.
 */
async function closeCurrent() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
  sessionId = null;
  tables = [];
  statements = [];
  warnings = [];
  fileInfo = null;
}

/** Re-opens a previously imported file straight from the browser storage. */
async function restoreSession(id: string): Promise<OpenResult> {
  await closeCurrent();
  sqlite3 = await initSqlite();
  const fileName = sessionFileName(id);
  try {
    db = new sqlite3.oo1.OpfsDb('/' + fileName);
    db.exec('SELECT 1');
  } catch (err) {
    db = null;
    throw new Error(
      `The stored session could not be opened: ${errorMessage(err)}. It may have been removed from the browser storage.`,
    );
  }
  dbMode = 'opfs';
  sessionId = id;

  const meta = readMeta(db);
  const kind = meta.kind === 'native' ? 'native' : 'dump';

  if (kind === 'native') {
    tables = Q.inspectSqliteSchema(db);
    statements = [];
  } else {
    tables = rebuildTables(db);
    statements = Q.readStatements(context());
  }
  warnings = [];

  fileInfo = {
    name: meta.name ?? 'restored.sql',
    size: Number(meta.size ?? 0) || 0,
    encoding: meta.encoding ?? 'utf-8',
    dialect: (meta.dialect as FileInfo['dialect']) ?? 'generic',
    importedAt: Number(meta.importedAt ?? Date.now()) || Date.now(),
    mode: dbMode,
    isNativeSqlite: kind === 'native',
    sessionId: id,
  };

  progress('restoring', 90);
  return buildOpenResult();
}

/** Removes a stored session from the browser storage. */
async function deleteSession(id: string): Promise<{ deleted: boolean }> {
  if (sessionId === id) await closeCurrent();
  try {
    await removeOpfsFile(sessionFileName(id));
  } catch {
    /* the file may not exist any more */
  }
  return { deleted: true };
}

/* ------------------------------------------------------------------ *
 * Message handling
 * ------------------------------------------------------------------ */

async function handle(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'open': {
      await closeCurrent();
      sqlite3 = await initSqlite();
      const stamp = Date.now();
      const head = new Uint8Array(await msg.file.slice(0, 16).arrayBuffer());
      if (isNativeSqlite(head)) return await openNativeSqlite(msg.file, stamp);
      return await openDump(msg.file, msg.options ?? {}, stamp);
    }
    case 'tables':
      return Q.listTables(context());
    case 'rows':
      return Q.getRows(context(), msg.table, msg.query ?? {});
    case 'search':
      return Q.search(context(), msg.term ?? '', msg.table ?? null, msg.limit ?? 100);
    case 'relations':
      return Q.buildRelations(Q.listTables(context()));
    case 'stats':
      return Q.globalStats(context());
    case 'columnProfiles':
      return Q.columnProfiles(context(), msg.table);
    case 'distinct':
      return Q.distinctValues(context(), msg.table, msg.column, msg.limit ?? 40);
    case 'duplicates':
      return Q.findDuplicates(context(), msg.table, msg.columns, msg.limit ?? 50);
    case 'diff':
      return Q.diffTables(context(), msg.left, msg.right, msg.keyPairs, msg.limit ?? 50);
    case 'exec':
      return Q.execSql(context(), msg.sql ?? '');
    case 'export': {
      const ctx = context();
      const limit = msg.maxRows ?? 200_000;
      const { columns, rows } = Q.fetchRows(ctx, msg.table, msg.query ?? {}, limit);
      const payload = buildExport(msg.format, msg.table, columns, rows);
      return {
        filename: payload.filename,
        mime: payload.mime,
        data: payload.data,
        rowCount: rows.length,
      };
    }
    case 'statements':
      return Q.readStatements(context());
    case 'rawSql':
      return Q.readRawSql(context());
    case 'restoreSession':
      return await restoreSession(msg.sessionId);
    case 'deleteSession':
      return await deleteSession(msg.sessionId);
    case 'exportZip': {
      const ctx = context();
      const payload = buildPackage(ctx, fileInfo!, tables);
      return {
        filename: payload.filename,
        mime: payload.mime,
        data: payload.data,
      };
    }
    case 'close':
      await closeCurrent();
      return { closed: true };
    default:
      throw new Error(`Unknown request: ${(msg as any).type}`);
  }
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    const result = await handle(msg);
    post({ kind: 'result', id: msg.id, ok: true, result });
  } catch (err) {
    post({ kind: 'result', id: msg.id, ok: false, error: errorMessage(err) });
  }
};
