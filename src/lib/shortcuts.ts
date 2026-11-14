/**
 * Global keyboard-shortcut plumbing.
 *
 * The shell listens for key presses and broadcasts intents with custom DOM
 * events, so pages stay decoupled from each other.
 */

/** Focus the global search input (SearchPage listens for it). */
export const EV_FOCUS_SEARCH = 'sds:focus-search';

/** Copy the currently selected grid rows (TablePage listens for it). */
export const EV_COPY_SELECTION = 'sds:copy-selection';

/** Move the open row drawer up/down. Detail: +1 / -1. */
export const EV_ROW_STEP = 'sds:row-step';

/** `g` followed by one of these keys jumps to the matching page. */
export const NAV_SHORTCUTS: Record<string, string> = {
  h: '/',
  t: '/tables',
  s: '/search',
  r: '/relations',
  e: '/editor',
  c: '/compare',
  p: '/stats',
};

/** Labels for the navigation shortcut keys, used by the help modal. */
export const NAV_SHORTCUT_LABELS: { key: string; path: string }[] = [
  { key: 'g h', path: '/' },
  { key: 'g t', path: '/tables' },
  { key: 'g s', path: '/search' },
  { key: 'g r', path: '/relations' },
  { key: 'g e', path: '/editor' },
  { key: 'g c', path: '/compare' },
  { key: 'g p', path: '/stats' },
];
