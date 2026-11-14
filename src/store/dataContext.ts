import { createContext } from 'react';
import type {
  FileInfo,
  GlobalStats,
  OpenOptions,
  SessionInfo,
  StatementInfo,
  TableMeta,
} from '../worker/protocol';

export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DataValue {
  file: FileInfo | null;
  tables: TableMeta[];
  stats: GlobalStats | null;
  statements: StatementInfo[];
  warnings: string[];
  status: DataStatus;
  error: string | null;
  progress: { phase: string; pct: number; detail?: string } | null;
  openFile: (file: File, options: OpenOptions) => Promise<void>;
  closeFile: () => Promise<void>;
  refresh: () => Promise<void>;
  isReady: boolean;
  /** Files that were opened before and can be restored without uploading them. */
  sessions: SessionInfo[];
  restoreSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

export const DataContext = createContext<DataValue | null>(null);
