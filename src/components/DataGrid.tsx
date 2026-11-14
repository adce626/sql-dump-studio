import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ColumnMeta, SortSpec } from '../worker/protocol';
import { cellClass, valueToText } from '../lib/format';
import { imageFromValue, type ImageInfo } from '../lib/images';
import { IconChevronDown, IconFilter, IconFit, IconPin, IconSort } from './Icons';
import { ImageThumb } from './ImageCell';

export type GridDensity = 'compact' | 'cozy' | 'comfortable';

export interface GridLabels {
  selectAll?: string;
  selectRow?: string;
  filterColumn?: string;
  autoFit?: string;
}

export interface DataGridProps {
  columns: string[];
  rows: unknown[][];
  meta?: ColumnMeta[];
  /** Columns that take part in a foreign key (declared or inferred). */
  foreignKeyColumns?: string[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (index: number) => void;
  /** Active sort list; the index in the array is the sort priority. */
  sorts?: SortSpec[];
  onSort?: (column: string, additive: boolean) => void;
  density?: GridDensity;
  showGridlines?: boolean;
  /** Column kept visible while scrolling horizontally. */
  pinnedColumn?: string | null;
  onTogglePin?: (column: string) => void;
  /** Absolute number of the first returned row (used for row numbering). */
  rowOffset?: number;
  pinLabel?: string;
  unpinLabel?: string;
  /** Per column widths in pixels (persisted per table). */
  columnWidths?: Record<string, number>;
  onResizeColumn?: (column: string, width: number) => void;
  onAutoFitColumn?: (column: string, width: number) => void;
  /** Search term highlighted inside every cell. */
  searchTerm?: string;
  /** Stable key per row (usually the rowid). */
  rowKeys?: string[];
  /** Keys of the selected rows. */
  selectedKeys?: Set<string>;
  onToggleRow?: (key: string, index: number, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
  /** Opens the quick filter popover for a column. */
  onQuickFilter?: (column: string) => void;
  /** Columns that currently carry a filter. */
  filteredColumns?: string[];
  /** Called when an image cell is clicked. */
  onOpenImage?: (payload: {
    src: string;
    info: ImageInfo;
    column: string;
    rowIndex: number;
  }) => void;
  labels?: GridLabels;
  className?: string;
}

const CHECK_W = 36;
const ROW_NO_WIDTH = 54;
const COLUMN_OVERSCAN = 3;
const MIN_COL_WIDTH = 70;
const MAX_COL_WIDTH = 620;

const DENSITY: Record<GridDensity, { row: number; cell: string; text: string }> = {
  compact: { row: 26, cell: 'py-[3px]', text: 'text-[12px]' },
  cozy: { row: 30, cell: 'py-1', text: 'text-[12.5px]' },
  comfortable: { row: 36, cell: 'py-2', text: 'text-[13px]' },
};

function widthFor(name: string, type?: string): number {
  const length = name.length;
  const typeLength = Math.min((type ?? '').length, 14);
  return Math.min(Math.max(length * 11 + 40 + typeLength * 3, 130), 340);
}

/** Colour of the type chip in the column header, driven by the column affinity. */
function typeChipClass(column: ColumnMeta | undefined): string {
  if (!column) return 'type-text';
  if (column.affinity === 'INTEGER') return 'type-int';
  if (column.affinity === 'REAL' || column.affinity === 'NUMERIC') return 'type-real';
  if (column.affinity === 'BLOB') return 'type-blob';
  if (/date|time|year/i.test(column.originalType)) return 'type-date';
  return 'type-text';
}

/* ------------------------------------------------------------------ *
 * Text measurement (auto fit)
 * ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | null | undefined;

function measure(text: string, font: string): number {
  if (typeof document === 'undefined') return text.length * 7;
  if (measureCtx === undefined) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Width that fits the header, the type chip and a sample of the values. */
function autoFitWidth(
  column: string,
  meta: ColumnMeta | undefined,
  values: unknown[],
): number {
  const headFont = '700 12.5px system-ui, -apple-system, sans-serif';
  const monoFont = '700 9.5px ui-monospace, SFMono-Regular, monospace';
  let widest = measure(column, headFont);
  widest = Math.max(widest, measure(meta?.originalType ?? '', monoFont));
  for (const value of values.slice(0, 80)) {
    if (value === null || value === undefined) continue;
    widest = Math.max(widest, measure(valueToText(value), headFont));
  }
  return Math.round(Math.min(Math.max(widest + 36, 90), 420));
}

/* ------------------------------------------------------------------ *
 * Mini distribution (header sparkline)
 * ------------------------------------------------------------------ */

interface DistBucket {
  ratio: number;
  nullish?: boolean;
}

function buildDistribution(values: unknown[], meta: ColumnMeta | undefined): DistBucket[] {
  if (!values.length) return [];
  const affinity = meta?.affinity ?? 'TEXT';
  const numeric = affinity === 'INTEGER' || affinity === 'REAL' || affinity === 'NUMERIC';
  const temporal = /date|time|year/i.test(meta?.originalType ?? '');

  if (numeric || temporal) {
    const points: number[] = [];
    let nulls = 0;
    for (const value of values) {
      if (value === null || value === undefined) {
        nulls++;
        continue;
      }
      const point =
        typeof value === 'number' ? value : Date.parse(String(value));
      if (Number.isFinite(point)) points.push(point);
    }
    if (!points.length) return [];
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      if (point < min) min = point;
      if (point > max) max = point;
    }
    if (min === max) return [{ ratio: 1 }];
    const bins = 12;
    const counts = new Array<number>(bins).fill(0);
    for (const point of points) {
      const index = Math.min(
        bins - 1,
        Math.max(0, Math.floor(((point - min) / (max - min)) * bins)),
      );
      counts[index]++;
    }
    const peak = Math.max(...counts);
    const out: DistBucket[] = counts.map((count) => ({ ratio: count / peak }));
    if (nulls) out.push({ ratio: nulls / values.length, nullish: true });
    return out;
  }

  const counts = new Map<string, number>();
  let nulls = 0;
  for (const value of values) {
    if (value === null || value === undefined) {
      nulls++;
      continue;
    }
    const text = String(value);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) return [];
  const peak = top[0][1];
  const out: DistBucket[] = top.map(([, count]) => ({ ratio: count / peak }));
  if (nulls) out.push({ ratio: nulls / values.length, nullish: true });
  return out;
}

/* ------------------------------------------------------------------ *
 * Search highlighting
 * ------------------------------------------------------------------ */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text: string, term: string | undefined): ReactNode {
  if (!term || term.trim().length < 2) return text;
  const pattern = new RegExp(escapeRegExp(term.trim()), 'gi');
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<mark key={nodes.length}>{match[0]}</mark>);
    last = match.index + match[0].length;
  }
  if (!nodes.length) return text;
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

type FlowItem = { kind: 'col'; index: number } | { kind: 'spacer'; width: number };

export function DataGrid({
  columns,
  rows,
  meta,
  foreignKeyColumns,
  loading,
  emptyMessage,
  onRowClick,
  sorts,
  onSort,
  density = 'cozy',
  showGridlines = true,
  pinnedColumn,
  onTogglePin,
  rowOffset = 0,
  pinLabel = 'Pin column',
  unpinLabel = 'Unpin column',
  columnWidths,
  onResizeColumn,
  onAutoFitColumn,
  searchTerm,
  rowKeys,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  onQuickFilter,
  filteredColumns,
  onOpenImage,
  labels,
  className,
}: DataGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const cfg = DENSITY[density] ?? DENSITY.cozy;
  const isRtl =
    typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  const [viewport, setViewport] = useState({ left: 0, width: 0, scrollWidth: 0 });
  const [resizing, setResizing] = useState<string | null>(null);

  /* ---------------------------------------------------------------- *
   * Column widths
   * ---------------------------------------------------------------- */
  const metaByName = useMemo(() => {
    const map = new Map<string, ColumnMeta>();
    for (const item of meta ?? []) map.set(item.name.toLowerCase(), item);
    return map;
  }, [meta]);

  const widths = useMemo(
    () =>
      columns.map((column) => {
        const custom = columnWidths?.[column];
        if (custom && custom >= MIN_COL_WIDTH) return custom;
        return widthFor(column, metaByName.get(column.toLowerCase())?.originalType);
      }),
    [columns, columnWidths, metaByName],
  );

  const offsets = useMemo(() => {
    const result: number[] = [];
    let acc = 0;
    for (const width of widths) {
      result.push(acc);
      acc += width;
    }
    return result;
  }, [widths]);

  const contentWidth = useMemo(
    () => widths.reduce((sum, width) => sum + width, 0),
    [widths],
  );
  const totalWidth = contentWidth + ROW_NO_WIDTH + CHECK_W;

  /* ---------------------------------------------------------------- *
   * Virtualisation: rows (vertical) and columns (horizontal)
   * ---------------------------------------------------------------- */
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => cfg.row,
    overscan: 12,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  const syncViewport = useCallback(() => {
    const element = parentRef.current;
    if (!element) return;
    const next = {
      left: element.scrollLeft,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
    setViewport((previous) =>
      previous.left === next.left &&
      previous.width === next.width &&
      previous.scrollWidth === next.scrollWidth
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    // Scroll events are already aligned to one per frame, so the state can be
    // updated directly. Using requestAnimationFrame here would stall in
    // background tabs, where rAF callbacks are throttled.
    const onScroll = () => syncViewport();
    element.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => syncViewport());
    observer.observe(element);
    syncViewport();
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [syncViewport]);

  const pinnedIndex = useMemo(() => {
    if (!pinnedColumn) return -1;
    return columns.findIndex(
      (column) => column.toLowerCase() === pinnedColumn.toLowerCase(),
    );
  }, [columns, pinnedColumn]);

  const { first, last } = useMemo(() => {
    if (!columns.length) return { first: 0, last: 0 };
    if (viewport.width === 0) {
      return { first: 0, last: Math.min(columns.length - 1, 14) };
    }
    // Distance from the *start* edge of the content (left in LTR, right in RTL).
    // Modern browsers report a negative scrollLeft in RTL, so abs() gives the
    // distance travelled from the start edge in both directions.
    const offset = isRtl ? Math.abs(viewport.left) : viewport.left;
    const base = CHECK_W + ROW_NO_WIDTH;
    const viewEnd = offset + viewport.width;

    let start = 0;
    for (let index = 0; index < columns.length; index++) {
      const startX = base + offsets[index];
      if (startX + widths[index] > offset) {
        start = index;
        break;
      }
    }
    let end = columns.length - 1;
    for (let index = columns.length - 1; index >= 0; index--) {
      if (base + offsets[index] < viewEnd) {
        end = index;
        break;
      }
    }
    return {
      first: Math.max(0, start - COLUMN_OVERSCAN),
      last: Math.min(columns.length - 1, end + COLUMN_OVERSCAN),
    };
  }, [columns.length, viewport, offsets, widths, isRtl]);

  const flow = useMemo<FlowItem[]>(() => {
    if (!columns.length) return [];
    const rendered = new Set<number>();
    for (let index = first; index <= last; index++) rendered.add(index);
    if (pinnedIndex >= 0) rendered.add(pinnedIndex);

    const items: FlowItem[] = [];
    let index = 0;
    while (index < columns.length) {
      if (rendered.has(index)) {
        items.push({ kind: 'col', index });
        index++;
        continue;
      }
      let cursor = index;
      let width = 0;
      while (cursor < columns.length && !rendered.has(cursor)) {
        width += widths[cursor];
        cursor++;
      }
      items.push({ kind: 'spacer', width });
      index = cursor;
    }
    return items;
  }, [columns.length, first, last, pinnedIndex, widths]);

  /* ---------------------------------------------------------------- *
   * Derived header state
   * ---------------------------------------------------------------- */
  const fkColumns = useMemo(
    () => new Set((foreignKeyColumns ?? []).map((name) => name.toLowerCase())),
    [foreignKeyColumns],
  );

  const sortPriority = useMemo(() => {
    const map = new Map<string, number>();
    (sorts ?? []).forEach((sort, index) =>
      map.set(sort.column.toLowerCase(), index),
    );
    return map;
  }, [sorts]);

  const filtered = useMemo(
    () => new Set((filteredColumns ?? []).map((name) => name.toLowerCase())),
    [filteredColumns],
  );

  const lineClass = showGridlines ? 'border-e border-border/60' : '';

  /* ---------------------------------------------------------------- *
   * Distribution bars for the visible columns
   * ---------------------------------------------------------------- */
  const distributions = useMemo(() => {
    const map = new Map<number, DistBucket[]>();
    for (const item of flow) {
      if (item.kind !== 'col') continue;
      const values = rows.map((row) => row[item.index]);
      map.set(
        item.index,
        buildDistribution(values, metaByName.get(columns[item.index].toLowerCase())),
      );
    }
    return map;
  }, [flow, rows, columns, metaByName]);

  /* ---------------------------------------------------------------- *
   * Column resizing
   * ---------------------------------------------------------------- */
  const resizeRef = useRef<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const onResizeStart = (
    event: ReactPointerEvent<HTMLDivElement>,
    column: string,
    width: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    resizeRef.current = { column, startX: event.clientX, startWidth: width };
    setResizing(column);
  };

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state) return;
    const delta = isRtl ? state.startX - event.clientX : event.clientX - state.startX;
    const next = Math.round(
      Math.min(Math.max(state.startWidth + delta, MIN_COL_WIDTH), MAX_COL_WIDTH),
    );
    onResizeColumn?.(state.column, next);
  };

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current) {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    }
    resizeRef.current = null;
    setResizing(null);
  };

  const onAutoFit = (column: string, index: number) => {
    const values = rows.map((row) => row[index]);
    const width = autoFitWidth(
      column,
      metaByName.get(column.toLowerCase()),
      values,
    );
    onAutoFitColumn?.(column, width);
  };

  /* ---------------------------------------------------------------- *
   * Selection helpers
   * ---------------------------------------------------------------- */
  const allSelected =
    rows.length > 0 &&
    (selectedKeys?.size ?? 0) > 0 &&
    rows.every((_, index) => selectedKeys!.has(rowKeys?.[index] ?? String(index)));

  const keyOf = (index: number) => rowKeys?.[index] ?? String(index);

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  return (
    <div
      ref={parentRef}
      className={[
        'relative h-full overflow-auto rounded-xl border border-border bg-surface',
        className ?? '',
      ].join(' ')}
      style={
        {
          '--grid-rowno-w': `${ROW_NO_WIDTH}px`,
          '--grid-check-w': `${CHECK_W}px`,
        } as CSSProperties
      }
    >
      <div style={{ minWidth: totalWidth }}>
        {/* ---------------------------------------------------------- *
         * Column headers
         * ---------------------------------------------------------- */}
        <div className="sticky top-0 z-30 flex border-b border-border bg-surface-2">
          <div
            className="grid-check sticky start-0 z-[40] flex shrink-0 items-center justify-center border-e border-border bg-surface-2"
            style={{ width: CHECK_W }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => onToggleAll?.(event.target.checked)}
              title={labels?.selectAll ?? 'Select all rows'}
              aria-label={labels?.selectAll ?? 'Select all rows'}
            />
          </div>

          <div
            className="sticky z-[40] flex shrink-0 items-center justify-center border-e border-border bg-surface-2 px-2 text-[11px] font-bold text-muted grid-sticky-num"
            style={{ width: ROW_NO_WIDTH }}
            title="#"
          >
            #
          </div>

          {flow.map((item) => {
            if (item.kind === 'spacer') {
              return (
                <div
                  key={`spacer-${item.width}`}
                  className="shrink-0"
                  style={{ width: item.width }}
                  aria-hidden
                />
              );
            }

            const index = item.index;
            const column = columns[index];
            const columnMeta = metaByName.get(column.toLowerCase());
            const priority = sortPriority.get(column.toLowerCase());
            const sortSpec = priority !== undefined ? sorts?.[priority] : undefined;
            const isSorted = Boolean(sortSpec);
            const isPk = columnMeta?.isPrimaryKey ?? false;
            const isFk = fkColumns.has(column.toLowerCase());
            const isPinned = index === pinnedIndex;
            const hasFilter = filtered.has(column.toLowerCase());
            const width = widths[index];

            return (
              <div
                key={column}
                data-grid-column={column}
                className={[
                  'group relative flex shrink-0 flex-col justify-center border-e border-border',
                  isPinned
                    ? 'grid-head-pinned sticky grid-sticky-col z-[35] border-e-border-strong'
                    : '',
                  isSorted ? 'grid-head-sorted' : '',
                ].join(' ')}
                style={{ width }}
              >
                {isSorted && (
                  <span className="absolute inset-y-0 start-0 w-[3px] rounded-full bg-accent" />
                )}

                <button
                  type="button"
                  onClick={(event) => onSort?.(column, event.shiftKey)}
                  aria-sort={
                    isSorted
                      ? sortSpec?.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className={[
                    'flex items-center gap-1.5 px-3 pt-2 text-start transition',
                    isSorted ? 'text-accent' : 'text-text hover:text-accent',
                  ].join(' ')}
                  title={`${column} — ${columnMeta?.originalType ?? 'TEXT'}`}
                >
                  {isPinned && <IconPin size={11} className="shrink-0 text-accent-2" />}
                  <span className="truncate text-[12.5px] font-extrabold" dir="auto">
                    {column}
                  </span>
                  {isSorted ? (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <span className="grid h-[15px] min-w-[15px] place-items-center rounded-full bg-accent px-1 text-[9.5px] font-black text-white">
                        {priority !== undefined ? priority + 1 : ''}
                      </span>
                      <IconChevronDown
                        size={12}
                        className={sortSpec?.dir === 'asc' ? 'rotate-180' : ''}
                      />
                    </span>
                  ) : (
                    <IconSort size={12} className="shrink-0 opacity-30" />
                  )}
                </button>

                <div className="flex items-center gap-1 overflow-hidden px-3 pb-1.5 pt-0.5">
                  {columnMeta && (
                    <span
                      className={`type-chip shrink-0 ${typeChipClass(columnMeta)}`}
                      title={columnMeta.originalType}
                    >
                      {columnMeta.originalType}
                    </span>
                  )}
                  {isPk && <span className="grid-badge grid-badge-pk">PK</span>}
                  {isFk && <span className="grid-badge grid-badge-fk">FK</span>}

                  {onQuickFilter && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onQuickFilter(column);
                      }}
                      title={labels?.filterColumn ?? 'Filter values'}
                      aria-label={labels?.filterColumn ?? 'Filter values'}
                      className={`hdr-action ${hasFilter ? 'on' : ''}`}
                    >
                      <IconFilter size={11} />
                    </button>
                  )}
                  {onAutoFitColumn && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAutoFit(column, index);
                      }}
                      title={labels?.autoFit ?? 'Auto fit'}
                      aria-label={labels?.autoFit ?? 'Auto fit'}
                      className="hdr-action"
                    >
                      <IconFit size={11} />
                    </button>
                  )}
                  {onTogglePin && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePin(column);
                      }}
                      title={isPinned ? unpinLabel : pinLabel}
                      aria-label={isPinned ? unpinLabel : pinLabel}
                      className={[
                        'ms-auto rounded p-0.5 transition',
                        isPinned
                          ? 'text-accent-2 opacity-100'
                          : 'text-muted opacity-0 group-hover:opacity-100 hover:text-accent-2',
                      ].join(' ')}
                    >
                      <IconPin size={11} />
                    </button>
                  )}
                </div>

                {/* Mini distribution of the column values */}
                {(() => {
                  const buckets = distributions.get(index);
                  if (!buckets || !buckets.length) return null;
                  return (
                    <div className="px-3 pb-1.5">
                      <div className="dist-bar" aria-hidden>
                        {buckets.map((bucket, bucketIndex) => (
                          <i
                            key={bucketIndex}
                            className={bucket.nullish ? 'null' : bucket.ratio > 0.66 ? 'hot' : ''}
                            style={{
                              height: `${Math.max(8, Math.round(bucket.ratio * 100))}%`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Resize handle */}
                <div
                  className={`col-resizer ${resizing === column ? 'active' : ''}`}
                  onPointerDown={(event) => onResizeStart(event, column, width)}
                  onPointerMove={onResizeMove}
                  onPointerUp={onResizeEnd}
                  onPointerCancel={onResizeEnd}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onAutoFit(column, index);
                  }}
                  title={labels?.autoFit ?? 'Auto fit'}
                />
              </div>
            );
          })}
        </div>

        {/* ---------------------------------------------------------- *
         * Rows
         * ---------------------------------------------------------- */}
        {rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted">
            {loading ? '…' : (emptyMessage ?? '')}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const alt = item.index % 2 === 1;
              const key = keyOf(item.index);
              const selected = selectedKeys?.has(key) ?? false;

              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={[
                    'absolute top-0 flex w-full text-[12.5px]',
                    showGridlines ? 'border-b border-border/40' : '',
                    alt ? 'grid-row-alt' : 'grid-row',
                    selected ? 'selected' : '',
                    onRowClick ? 'cursor-pointer' : '',
                  ].join(' ')}
                  style={{ transform: `translateY(${item.start}px)` }}
                  onClick={() => onRowClick?.(item.index)}
                >
                  <div
                    className="grid-check sticky start-0 z-20 flex shrink-0 items-center justify-center border-e border-border px-1"
                    style={{ width: CHECK_W }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) =>
                        onToggleRow?.(key, item.index, event.target.checked)
                      }
                      title={labels?.selectRow ?? 'Select row'}
                      aria-label={labels?.selectRow ?? 'Select row'}
                    />
                  </div>

                  <div
                    className="grid-sticky sticky z-20 flex shrink-0 items-center justify-center border-e border-border px-2 text-[11px] text-muted grid-sticky-num"
                    style={{ width: ROW_NO_WIDTH }}
                  >
                    {rowOffset + item.index + 1}
                  </div>

                  {flow.map((flowItem) => {
                    if (flowItem.kind === 'spacer') {
                      return (
                        <div
                          key={`spacer-${flowItem.width}`}
                          className="shrink-0"
                          style={{ width: flowItem.width }}
                          aria-hidden
                        />
                      );
                    }

                    const index = flowItem.index;
                    const value = row[index];
                    const isNull = value === null || value === undefined;
                    const text = isNull ? '' : valueToText(value);
                    const isDateLike =
                      typeof value === 'string' &&
                      /^\d{4}-\d{2}-\d{2}[ T]/.test(value);
                    const isNumber = typeof value === 'number';
                    const columnMeta = metaByName.get(columns[index].toLowerCase());
                    const isPk = columnMeta?.isPrimaryKey ?? false;
                    const isPinned = index === pinnedIndex;
                    const image = isNull ? null : imageFromValue(value);

                    return (
                      <div
                        key={columns[index]}
                        style={{ width: widths[index] }}
                        dir={isDateLike ? 'ltr' : 'auto'}
                        className={[
                          'shrink-0 truncate px-3',
                          cfg.cell,
                          cfg.text,
                          lineClass,
                          isPinned
                            ? 'grid-sticky sticky grid-sticky-col z-10 border-e-border-strong'
                            : '',
                          isPk ? 'cell-pk' : '',
                          cellClass(value, columnMeta?.affinity),
                          isNumber ? 'text-end tabular-nums' : '',
                        ].join(' ')}
                        title={isNull ? 'NULL' : text}
                      >
                        {isNull ? (
                          'NULL'
                        ) : image ? (
                          <ImageThumb
                            value={value}
                            column={columns[index]}
                            rowIndex={rowOffset + item.index}
                            onOpen={onOpenImage}
                          />
                        ) : (
                          highlight(text, searchTerm)
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
