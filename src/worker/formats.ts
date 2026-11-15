/**
 * Detects the format of an uploaded file and extracts the SQL text or the
 * SQLite database it carries.
 *
 * Supported "open directly" formats:
 *   - `.sql` / `.txt`          plain SQL dump
 *   - `.sql.gz` / `.gz`        gzip compressed SQL dump (or a gzip compressed
 *                              tar archive)
 *   - `.tar` / `.tgz`          tar archive holding a `.sql` or a `.sqlite` file
 *   - `.sqlite` / `.db`        native SQLite database
 *
 * Everything else (`.bak`, `.dump`, `.backup`, `.ibd`, `.frm`, `.mdf`, `.ldf`)
 * is a proprietary binary format. Those are detected as well so the UI can
 * explain exactly how to convert them.
 */

export type FormatKind =
  | 'sql'
  | 'sqlite'
  | 'gzip'
  | 'tar'
  | 'sqlserver-backup'
  | 'postgres-custom'
  | 'custom-dump'
  | 'mysql-table-file'
  | 'mssql-data-file'
  | 'binary';

export interface FormatInfo {
  kind: FormatKind;
  /** The extension that was used for the detection (may be empty). */
  extension: string;
}

export interface Extraction {
  kind: 'sql' | 'sqlite' | 'error';
  /** Stream with the SQL bytes (only for `kind === 'sql'`). */
  stream?: ReadableStream<Uint8Array>;
  /** The database bytes (only for `kind === 'sqlite'`). */
  bytes?: Uint8Array;
  /** First bytes of the payload, used for the encoding / dialect detection. */
  sample?: Uint8Array;
  /** Size of the payload in bytes (best effort). */
  totalSize?: number;
  /** Display name of the extracted member. */
  name?: string;
  /** Error code when `kind === 'error'`. */
  code?: 'unsupported-archive' | 'binary-file' | 'corrupt-archive';
  /** English fallback message when `kind === 'error'`. */
  message?: string;
  /** Members found inside an archive. */
  members?: string[];
}

const SQLITE_MAGIC = 'SQLite format 3\u0000';
const BLOCK = 512;

/** Reads the extension of a file name (lower case, compound extensions kept). */
export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.sql.gz')) return '.sql.gz';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return '.tar.gz';
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

export function isSqliteMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

export function isGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function isTarMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 262) return false;
  const magic = String.fromCharCode(bytes[257], bytes[258], bytes[259], bytes[260], bytes[261]);
  return magic === 'ustar';
}

/** Heuristic: does the buffer look like human readable text (a SQL dump)? */
export function looksLikeText(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192);
  if (!limit) return false;
  let printable = 0;
  let nul = 0;
  for (let i = 0; i < limit; i++) {
    const byte = bytes[i];
    if (byte === 0) {
      nul++;
      continue;
    }
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 0x80) {
      printable++;
    }
  }
  return nul === 0 && printable / limit > 0.9;
}

/** Detects the format of a file from its name and its first bytes. */
export function detectFormat(name: string, head: Uint8Array): FormatInfo {
  const extension = extensionOf(name);
  if (isGzipMagic(head)) return { kind: 'gzip', extension: extension || '.gz' };
  if (isTarMagic(head)) return { kind: 'tar', extension: extension || '.tar' };
  if (isSqliteMagic(head)) return { kind: 'sqlite', extension: extension || '.sqlite' };

  switch (extension) {
    case '.sqlite':
    case '.sqlite3':
    case '.db':
    case '.db3':
      return { kind: 'sqlite', extension };
    case '.sql':
    case '.txt':
    case '.ddl':
    case '.dump.sql':
      return { kind: 'sql', extension };
    case '.tar':
    case '.tgz':
      return { kind: 'tar', extension };
    case '.gz':
    case '.gzip':
      return { kind: 'gzip', extension };
    case '.bak':
      return { kind: 'sqlserver-backup', extension };
    case '.backup':
      return { kind: 'postgres-custom', extension };
    case '.dump':
      return { kind: 'custom-dump', extension };
    case '.ibd':
    case '.frm':
    case '.myi':
    case '.myd':
      return { kind: 'mysql-table-file', extension };
    case '.mdf':
    case '.ldf':
    case '.ndf':
      return { kind: 'mssql-data-file', extension };
    default:
      return { kind: 'binary', extension };
  }
}

/** The format kind is used as the key of the localized guidance in the UI. */
export function guidanceKey(kind: FormatKind): string {
  switch (kind) {
    case 'sqlserver-backup':
      return 'sqlserver';
    case 'postgres-custom':
      return 'postgres';
    case 'custom-dump':
      return 'customdump';
    case 'mysql-table-file':
      return 'mysql';
    case 'mssql-data-file':
      return 'mssql';
    default:
      return 'binary';
  }
}

/* ------------------------------------------------------------------ *
 * Stream helpers
 * ------------------------------------------------------------------ */

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Reads the first `size` bytes of a stream and returns a new stream that
 * still contains them (nothing is lost).
 */
export async function peek(
  stream: ReadableStream<Uint8Array>,
  size: number,
): Promise<{ head: Uint8Array; rest: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  const collected: Uint8Array[] = [];
  let have = 0;
  while (have < size) {
    const { done, value } = await reader.read();
    if (done) break;
    collected.push(value);
    have += value.length;
  }
  const head = concat(collected).slice(0, size);
  const rest = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of collected) controller.enqueue(chunk);
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      })();
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
  return { head, rest };
}

/** Reads a whole stream into memory. */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(chunks);
}

/** Builds a stream that emits the given chunks in order. */
export function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/* ------------------------------------------------------------------ *
 * gzip
 * ------------------------------------------------------------------ */

function hasDecompressionStream(): boolean {
  return typeof DecompressionStream !== 'undefined';
}

/** Inflates gzip content and returns the plain bytes. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasDecompressionStream()) {
    throw new Error('This browser cannot decompress gzip files.');
  }
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return readAll(stream);
}

/* ------------------------------------------------------------------ *
 * tar
 * ------------------------------------------------------------------ */

class ByteReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private leftover: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  /** Reads exactly `size` bytes, or fewer at the end of the stream. */
  async readExactly(size: number): Promise<Uint8Array | null> {
    if (size <= 0) return new Uint8Array(0);
    const out = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      if (this.leftover.length === 0) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.leftover = value;
      }
      const take = Math.min(size - filled, this.leftover.length);
      out.set(this.leftover.subarray(0, take), filled);
      filled += take;
      this.leftover = this.leftover.slice(take);
    }
    if (filled === 0) return null;
    return filled < size ? out.slice(0, filled) : out;
  }

  /** Skips `size` bytes. */
  async skip(size: number): Promise<boolean> {
    let left = size;
    while (left > 0) {
      if (this.leftover.length === 0) {
        const { done, value } = await this.reader.read();
        if (done) return false;
        this.leftover = value;
      }
      const take = Math.min(left, this.leftover.length);
      this.leftover = this.leftover.slice(take);
      left -= take;
    }
    return true;
  }
}

function readString(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end++;
  let text = '';
  for (let i = offset; i < end; i++) text += String.fromCharCode(block[i]);
  return text.trim();
}

/** Parses an octal (or base 256) number from a tar header field. */
function readNumber(block: Uint8Array, offset: number, length: number): number {
  if (block[offset] & 0x80) {
    // GNU base 256 encoding
    let value = 0;
    for (let i = offset + 1; i < offset + length; i++) {
      value = value * 256 + block[i];
    }
    return value;
  }
  const text = readString(block, offset, length);
  if (!text) return 0;
  const parsed = parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Scans a tar archive and extracts the first SQLite database and every SQL
 * script it contains.
 */
export async function extractTarStream(
  stream: ReadableStream<Uint8Array>,
  displayName: string,
): Promise<Extraction> {
  const reader = new ByteReader(stream);
  const members: string[] = [];
  const sqlChunks: Uint8Array[] = [];
  let sqlName = '';
  let sqliteBytes: Uint8Array | null = null;
  let sqliteName = '';

  for (;;) {
    const header = await reader.readExactly(BLOCK);
    if (!header || header.length < BLOCK) break;

    let empty = true;
    for (let i = 0; i < BLOCK; i++) {
      if (header[i] !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break; // end of archive marker

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = readNumber(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const padded = Math.ceil(size / BLOCK) * BLOCK;

    if (type === '0' || type === '\u0000') {
      const data = await reader.readExactly(size);
      if (data && data.length) {
        members.push(fullName);
        const lower = fullName.toLowerCase();
        if (lower.endsWith('.sqlite') || lower.endsWith('.sqlite3') || lower.endsWith('.db')) {
          if (!sqliteBytes) {
            sqliteBytes = data;
            sqliteName = baseName(fullName);
          }
        } else if (lower.endsWith('.sql.gz')) {
          try {
            sqlChunks.push(await gunzip(data));
            if (!sqlName) sqlName = baseName(fullName).replace(/\.gz$/i, '');
          } catch {
            /* ignore a broken member */
          }
        } else if (lower.endsWith('.sql') || lower.endsWith('.ddl') || lower.endsWith('.txt')) {
          sqlChunks.push(data);
          if (!sqlName) sqlName = baseName(fullName);
        }
      }
      await reader.skip(padded - size);
    } else {
      members.push(fullName);
      await reader.skip(padded);
    }
  }

  if (sqliteBytes) {
    return { kind: 'sqlite', bytes: sqliteBytes, name: sqliteName, sample: sqliteBytes.slice(0, 1024) };
  }

  if (sqlChunks.length) {
    const total = sqlChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const sample = concat(sqlChunks.slice(0, 1)).slice(0, 128 * 1024);
    return {
      kind: 'sql',
      stream: streamFromChunks(sqlChunks),
      sample,
      totalSize: total,
      name: sqlName || displayName,
    };
  }

  return {
    kind: 'error',
    code: 'unsupported-archive',
    message: 'The archive does not contain a .sql or .sqlite file.',
    members,
  };
}

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

/** Extracts the content of a gzip file (SQL dump, tar archive or database). */
export async function extractGzip(file: File): Promise<Extraction> {
  if (!hasDecompressionStream()) {
    return {
      kind: 'error',
      code: 'binary-file',
      message: 'This browser cannot decompress gzip files. Please unzip the file first.',
    };
  }
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  } catch (err) {
    return {
      kind: 'error',
      code: 'corrupt-archive',
      message: `The gzip file could not be read: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { head, rest } = await peek(stream, 128 * 1024);
  if (isSqliteMagic(head)) {
    const bytes = await readAll(rest);
    return { kind: 'sqlite', bytes, name: file.name, sample: head };
  }
  if (isTarMagic(head)) {
    return await extractTarStream(rest, file.name);
  }
  return {
    kind: 'sql',
    stream: rest,
    sample: head,
    totalSize: file.size,
    name: file.name,
  };
}

/** Extracts the content of a tar archive. */
export async function extractTar(file: File): Promise<Extraction> {
  return await extractTarStream(file.stream(), file.name);
}
