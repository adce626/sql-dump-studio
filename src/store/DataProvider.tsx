import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { client, type ProgressInfo } from '../lib/client';
import { loadSessions, registerSession, unregisterSession } from '../lib/sessions';
import type {
  FileInfo,
  GlobalStats,
  OpenOptions,
  SessionInfo,
  StatementInfo,
  TableMeta,
} from '../worker/protocol';
import { DataContext, type DataStatus, type DataValue } from './dataContext';

export function DataProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<FileInfo | null>(null);
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<DataStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>(() => loadSessions());
  const mounted = useRef(true);
  const autoRestored = useRef(false);

  useEffect(() => {
    mounted.current = true;
    client.onProgress((info) => {
      if (mounted.current) setProgress(info);
    });
    return () => {
      mounted.current = false;
      client.onProgress(null);
    };
  }, []);

  const applyOpenResult = useCallback((result: {
    file: FileInfo;
    tables: TableMeta[];
    stats: GlobalStats;
    statements: StatementInfo[];
    warnings: string[];
  }) => {
    setFile(result.file);
    setTables(result.tables);
    setStats(result.stats);
    setStatements(result.statements);
    setWarnings(result.warnings);
    setStatus('ready');
    setProgress(null);

    if (result.file.mode === 'opfs') {
      setSessions(
        registerSession({
          id: result.file.sessionId,
          name: result.file.name,
          size: result.file.size,
          dialect: result.file.dialect,
          importedAt: result.file.importedAt,
          kind: result.file.isNativeSqlite ? 'native' : 'dump',
          mode: result.file.mode,
          tableCount: result.tables.length,
          rowCount: result.tables.reduce((sum, table) => sum + table.rowCount, 0),
        }),
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [listed, globalStats, stmts] = await Promise.all([
        client.tables(),
        client.stats(),
        client.statements(),
      ]);
      if (!mounted.current) return;
      setTables(listed);
      setStats(globalStats);
      setStatements(stmts);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openFile = useCallback(
    async (nextFile: File, options: OpenOptions) => {
      setStatus('loading');
      setError(null);
      setProgress({ phase: 'reading', pct: 0 });
      try {
        const result = await client.open(nextFile, options);
        if (!mounted.current) return;
        applyOpenResult(result);
      } catch (err) {
        if (!mounted.current) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        setProgress(null);
      }
    },
    [applyOpenResult],
  );

  const restoreSession = useCallback(
    async (id: string) => {
      setStatus('loading');
      setError(null);
      setProgress({ phase: 'restoring', pct: 10 });
      try {
        const result = await client.restoreSession(id);
        if (!mounted.current) return;
        applyOpenResult(result);
      } catch (err) {
        if (!mounted.current) return;
        setStatus('idle');
        setError(err instanceof Error ? err.message : String(err));
        setProgress(null);
        // The session may still be intact (for example when the database file
        // is locked by another tab), so keep it in the list and let the user
        // retry or delete it from the "recent files" card.
      }
    },
    [applyOpenResult],
  );

  const deleteSession = useCallback(async (id: string) => {
    try {
      await client.deleteSession(id);
    } catch {
      /* ignore */
    }
    if (mounted.current) setSessions(unregisterSession(id));
  }, []);

  /* Restore the most recent session automatically on the first load. */
  useEffect(() => {
    if (autoRestored.current) return;
    autoRestored.current = true;
    const list = loadSessions();
    if (!list.length) return;
    if (list[0].mode !== 'opfs') return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('sds.autoRestore') === 'off') {
      return;
    }
    void restoreSession(list[0].id);
  }, [restoreSession]);

  const closeFile = useCallback(async () => {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    setFile(null);
    setTables([]);
    setStats(null);
    setStatements([]);
    setWarnings([]);
    setStatus('idle');
    setError(null);
  }, []);

  const value = useMemo<DataValue>(
    () => ({
      file,
      tables,
      stats,
      statements,
      warnings,
      status,
      error,
      progress,
      openFile,
      closeFile,
      refresh,
      isReady: status === 'ready' && !!file,
      sessions,
      restoreSession,
      deleteSession,
    }),
    [
      file,
      tables,
      stats,
      statements,
      warnings,
      status,
      error,
      progress,
      openFile,
      closeFile,
      refresh,
      sessions,
      restoreSession,
      deleteSession,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
