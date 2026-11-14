import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';

export type Sqlite3 = any;

let sqlite3: Sqlite3 | null = null;

/** The shipped type definitions predate the runtime config argument. */
const initModule = sqlite3InitModule as unknown as (config: {
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  locateFile?: (file: string) => string;
}) => Promise<Sqlite3>;

export async function initSqlite(): Promise<Sqlite3> {
  if (sqlite3) return sqlite3;
  sqlite3 = await initModule({
    print: () => {},
    printErr: (msg: unknown) => console.warn('[sqlite]', msg),
    locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file),
  });
  return sqlite3;
}

export interface DbHandle {
  db: any;
  mode: 'opfs' | 'memory';
  fileName: string;
}

/** Removes a leftover OPFS file from a previous session. */
export async function removeOpfsFile(name: string) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
  } catch {
    /* ignore */
  }
}

/**
 * Opens a database in OPFS (persistent, survives reloads) and falls back to an
 * in-memory database when SharedArrayBuffer / OPFS are unavailable.
 */
export async function createDb(fileName: string): Promise<DbHandle> {
  const sqlite3 = await initSqlite();
  await removeOpfsFile(fileName);
  try {
    const db = new sqlite3.oo1.OpfsDb('/' + fileName);
    db.exec('SELECT 1');
    return { db, mode: 'opfs', fileName };
  } catch (err) {
    console.warn('OPFS unavailable, falling back to in-memory database', err);
    const db = new sqlite3.oo1.DB(':memory:', 'ct');
    return { db, mode: 'memory', fileName };
  }
}

/** Writes a byte source into OPFS so it can be opened as a native SQLite file. */
export async function writeOpfsFile(name: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      const CHUNK = 4 * 1024 * 1024;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        access.write(bytes.subarray(offset, offset + CHUNK), { at: offset });
      }
      access.flush();
    } finally {
      access.close();
    }
    return true;
  } catch (err) {
    console.warn('Could not write OPFS file', err);
    return false;
  }
}

/** Streams a file into OPFS without loading it fully into memory. */
export async function writeOpfsStream(name: string, file: File): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      const reader = file.stream().getReader();
      let offset = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        access.write(value, { at: offset });
        offset += value.byteLength;
      }
      access.flush();
    } finally {
      access.close();
    }
    return true;
  } catch (err) {
    console.warn('Could not write OPFS stream', err);
    return false;
  }
}

/** Quotes an identifier for SQLite. */
export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Makes a table name safe for SQLite while keeping it recognisable. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^\w$]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'table';
}
