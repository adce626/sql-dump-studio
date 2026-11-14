import type { SessionInfo } from '../worker/protocol';

const KEY = 'sds.sessions';

/**
 * The registry of previously opened files. The heavy lifting happens in the
 * worker (the database file itself lives in the browser storage), this list
 * only keeps the small details needed to show the "recent files" card.
 */
export function loadSessions(): SessionInfo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SessionInfo =>
        !!item && typeof item.id === 'string' && typeof item.name === 'string',
    );
  } catch {
    return [];
  }
}

export function saveSessions(sessions: SessionInfo[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, 12)));
  } catch {
    /* storage is full or blocked */
  }
}

/** Adds (or refreshes) a session and returns the new list, newest first. */
export function registerSession(session: SessionInfo): SessionInfo[] {
  const list = loadSessions().filter((item) => item.id !== session.id);
  list.unshift(session);
  const next = list.slice(0, 12);
  saveSessions(next);
  return next;
}

/** Removes a session from the registry. */
export function unregisterSession(id: string): SessionInfo[] {
  const next = loadSessions().filter((item) => item.id !== id);
  saveSessions(next);
  return next;
}
