import type {
  ColumnProfile,
  DiffResult,
  DuplicateResult,
  ExecResult,
  FileInfo,
  GlobalStats,
  OpenErrorPayload,
  OpenOptions,
  OpenResult,
  RelationEdge,
  RowsQuery,
  RowsResult,
  SearchResult,
  StatementInfo,
  TableMeta,
  WorkerRequest,
  WorkerResponse,
} from '../worker/protocol';

export interface ProgressInfo {
  phase: string;
  pct: number;
  detail?: string;
}

export interface ExportPayload {
  filename: string;
  mime: string;
  data: Uint8Array;
  rowCount: number;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Error raised by the worker; it may carry details about the file format. */
export class WorkerError extends Error {
  payload?: OpenErrorPayload;

  constructor(message: string, payload?: OpenErrorPayload) {
    super(message);
    this.name = 'WorkerError';
    this.payload = payload;
  }
}

class WorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private progressListener: ((info: ProgressInfo) => void) | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.kind === 'progress') {
        this.progressListener?.({ phase: message.phase, pct: message.pct, detail: message.detail });
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new WorkerError(message.error, message.payload));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The database worker crashed.');
      for (const [, entry] of this.pending) entry.reject(error);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  onProgress(listener: ((info: ProgressInfo) => void) | null) {
    this.progressListener = listener;
  }

  private request<T>(payload: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> {
    const worker = this.ensureWorker();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...payload, id } as WorkerRequest);
    });
  }

  open(file: File, options: OpenOptions) {
    return this.request<OpenResult>({ type: 'open', file, options });
  }

  tables() {
    return this.request<TableMeta[]>({ type: 'tables' });
  }

  rows(table: string, query: RowsQuery) {
    return this.request<RowsResult>({ type: 'rows', table, query });
  }

  search(term: string, table: string | null, limit = 100) {
    return this.request<SearchResult>({ type: 'search', term, table, limit });
  }

  relations() {
    return this.request<RelationEdge[]>({ type: 'relations' });
  }

  stats() {
    return this.request<GlobalStats>({ type: 'stats' });
  }

  columnProfiles(table: string) {
    return this.request<ColumnProfile[]>({ type: 'columnProfiles', table });
  }

  distinct(table: string, column: string, limit = 40) {
    return this.request<{ value: string | null; count: number }[]>({
      type: 'distinct',
      table,
      column,
      limit,
    });
  }

  duplicates(table: string, columns?: string[], limit = 50) {
    return this.request<DuplicateResult>({ type: 'duplicates', table, columns, limit });
  }

  diff(
    left: string,
    right: string,
    keyPairs?: { left: string; right: string }[],
    limit = 50,
  ) {
    return this.request<DiffResult>({ type: 'diff', left, right, keyPairs, limit });
  }

  exec(sql: string) {
    return this.request<ExecResult>({ type: 'exec', sql });
  }

  export(table: string, format: 'csv' | 'json' | 'xlsx' | 'sql', query: RowsQuery, maxRows?: number) {
    return this.request<ExportPayload>({ type: 'export', table, format, query, maxRows });
  }

  statements() {
    return this.request<StatementInfo[]>({ type: 'statements' });
  }

  rawSql() {
    return this.request<{ table: string; sql: string }[]>({ type: 'rawSql' });
  }

  restoreSession(sessionId: string) {
    return this.request<OpenResult>({ type: 'restoreSession', sessionId });
  }

  deleteSession(sessionId: string) {
    return this.request<{ deleted: boolean }>({ type: 'deleteSession', sessionId });
  }

  exportZip() {
    return this.request<{ filename: string; mime: string; data: Uint8Array }>({
      type: 'exportZip',
    });
  }

  close() {
    return this.request<{ closed: boolean }>({ type: 'close' });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export const client = new WorkerClient();

/** Triggers a browser download for the given payload. */
export function downloadPayload(payload: ExportPayload) {
  const blob = new Blob([payload.data.slice().buffer as ArrayBuffer], { type: payload.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export type { FileInfo, GlobalStats, OpenResult, TableMeta };
