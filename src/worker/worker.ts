/// <reference lib="webworker" />
import { initSqlite, createDb, writeOpfsFile, writeOpfsStream, removeOpfsFile } from './sqlite';
import { importDump } from './importer';
import { detectDialect, guessEncoding } from './sql/dialect';
import {
  detectFormat,
  extractGzip,
  extractTar,
  guidanceKey,
  looksLikeText,
  type Extraction,
} from './formats';
import * as Q from './queries';
import { buildExport } from './export';
import { buildPackage } from './package';
import type {
  FileInfo,
  OpenErrorPayload,
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

/** Error that carries structured details so the UI can localize the message. */
class FormatError extends Error {
  payload: OpenErrorPayload;

  constructor(payload: OpenErrorPayload) {
    super(payload.message ?? 'This file cannot be opened.');
    this.name = 'FormatError';
    this.payload = payload;
  }
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

/** Opens a plain SQL dump (optionally from an unpacked archive). */
async function openDump(
  file: File,
  options: OpenOptions,
  stamp: number,
  source?: ReadableStream<Uint8Array>,
  totalSize?: number,
  sampleOverride?: Uint8Array,
  displayName?: string,
): Promise<OpenResult> {
  const label = displayName ?? file.name;
  const size = totalSize ?? file.size;
  progress('reading', 2, label);
  const sample =
    sampleOverride ?? new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
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
      source,
      totalSize: size,
    },
    progress,
  );

  tables = outcome.tables;
  statements = outcome.statements;
  warnings = outcome.warnings;

  fileInfo = {
    name: label,
    size,
    encoding,
    dialect,
    importedAt: stamp,
    mode: dbMode,
    isNativeSqlite: false,
    sessionId: id,
  };

  writeMeta(db, {
    sessionId: id,
    name: label,
    size: String(size),
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

  return finalizeNative(file.name, file.size, stamp);
}

/** Opens a native SQLite database that was extracted from an archive. */
async function openNativeSqliteBytes(bytes: Uint8Array, name: string, stamp: number): Promise<OpenResult> {
  const id = newSessionId();
  const fileName = sessionFileName(id);
  sessionId = id;

  const wrote = await writeOpfsFile(fileName, bytes);
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
    db = new sqlite3.oo1.DB(':memory:', 'ct');
    try {
      const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
      const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', ptr, bytes.length, bytes.length, 1);
      if (rc !== 0) throw new Error('sqlite3_deserialize failed');
    } catch (err) {
      throw new Error(`This database could not be opened: ${errorMessage(err)}`);
    }
    dbMode = 'memory';
  }

  return finalizeNative(name, bytes.length, stamp);
}

/** Shared tail of both native SQLite open paths. */
function finalizeNative(name: string, size: number, stamp: number): OpenResult {
  tables = Q.inspectSqliteSchema(db);
  statements = [];
  warnings = [];

  fileInfo = {
    name,
    size,
    encoding: 'binary',
    dialect: 'sqlite',
    importedAt: stamp,
    mode: dbMode,
    isNativeSqlite: true,
    sessionId: sessionId!,
  };

  if (dbMode === 'opfs') {
    writeMeta(db, {
      sessionId: sessionId!,
      name,
      size: String(size),
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
      const file = msg.file;
      const options = msg.options ?? {};
      const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
      const format = detectFormat(file.name, head);

      // A native SQLite database: open it directly.
      if (format.kind === 'sqlite') {
        return await openNativeSqlite(file, stamp);
      }

      // gzip / tar archives: unpack them first.
      if (format.kind === 'gzip' || format.kind === 'tar') {
        progress('reading', 4, file.name);
        const extracted: Extraction =
          format.kind === 'gzip' ? await extractGzip(file) : await extractTar(file);
        if (extracted.kind === 'error') {
          throw new FormatError({
            code: extracted.code ?? 'unsupported-archive',
            format: guidanceKey(format.kind),
            extension: format.extension,
            message: extracted.message,
            members: extracted.members,
          });
        }
        if (extracted.kind === 'sqlite') {
          return await openNativeSqliteBytes(
            extracted.bytes!,
            extracted.name ?? file.name,
            stamp,
          );
        }
        return await openDump(
          file,
          options,
          stamp,
          extracted.stream,
          extracted.totalSize,
          extracted.sample,
          extracted.name ?? file.name,
        );
      }

      // Plain SQL dump.
      if (format.kind === 'sql') {
        return await openDump(file, options, stamp);
      }

      // Proprietary formats (.bak, .dump, .backup, .ibd, .frm, .mdf, .ldf):
      // they can still be opened when they really contain plain SQL text.
      if (looksLikeText(head)) {
        return await openDump(file, options, stamp);
      }

      throw new FormatError({
        code: 'unsupported-format',
        format: guidanceKey(format.kind),
        extension: format.extension,
        message: `A ${format.extension || 'binary'} file cannot be opened directly in the browser.`,
      });
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
    if (err instanceof FormatError) {
      post({ kind: 'result', id: msg.id, ok: false, error: err.message, payload: err.payload });
      return;
    }
    post({ kind: 'result', id: msg.id, ok: false, error: errorMessage(err) });
  }
};
