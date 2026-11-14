import type { Affinity } from '../worker/protocol';

export function formatBytes(bytes: number, locale = 'en-US'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${units[index]}`;
}

export function formatNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDateTime(timestamp: number, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

/** Maps a value to the CSS class used to colourise grid cells. */
export function cellClass(value: unknown, affinity: Affinity | undefined): string {
  if (value === null || value === undefined) return 'cell-null';
  if (value instanceof Uint8Array) return 'cell-blob';
  if (typeof value === 'number') return Number.isInteger(value) ? 'cell-int' : 'cell-real';
  if (typeof value === 'boolean') return 'cell-int';
  if (affinity === 'TEXT' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return 'cell-date';
  }
  return 'cell-text';
}

export function valueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Uint8Array) {
    let hex = '0x';
    const step = Math.min(value.length, 32);
    for (let i = 0; i < step; i++) hex += value[i].toString(16).padStart(2, '0');
    if (value.length > step) hex += `…${value.length}B`;
    return hex;
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export function classNames(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

/** Short hex preview of a binary value, e.g. `0x89504e47…694B`. */
export function hexPreview(value: Uint8Array, bytes = 6): string {
  let hex = '0x';
  const step = Math.min(value.length, bytes);
  for (let i = 0; i < step; i++) hex += value[i].toString(16).padStart(2, '0');
  if (value.length > step) hex += `…${value.length}B`;
  return hex;
}

/** Full hex representation of a binary value (no prefix), e.g. `89504e47`. */
export function hexBytes(value: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < value.length; i++) hex += value[i].toString(16).padStart(2, '0');
  return hex;
}
