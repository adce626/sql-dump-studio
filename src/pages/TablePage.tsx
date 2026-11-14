import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { client, downloadPayload } from '../lib/client';
import { DataGrid, type GridDensity } from '../components/DataGrid';
import { QuickFilter } from '../components/QuickFilter';
import { RowDrawer } from '../components/RowDrawer';
import { ImageViewer } from '../components/ImageCell';
import { ColumnAnalysis } from '../components/ColumnAnalysis';
import { DuplicatesPanel } from '../components/DuplicatesPanel';
import { SqlViewer } from '../components/SqlViewer';
import {
  IconCode,
  IconCopy,
  IconDownload,
  IconFilter,
  IconGrid,
  IconRefresh,
  IconRows,
  IconSearch,
  IconShare,
  IconSort,
  IconTable,
} from '../components/Icons';
import { formatNumber } from '../lib/format';
import type { ImageInfo } from '../lib/images';
import type { ColumnFilter, ColumnProfile, DuplicateResult, RowsResult, SortSpec } from '../worker/protocol';
import { decodeState, shareUrl } from '../lib/share';
import { EV_COPY_SELECTION, EV_ROW_STEP } from '../lib/shortcuts';
import type { TranslationKey } from '../i18n/en';

type Tab =
  | 'data'
  | 'structure'
  | 'ddl'
  | 'indexes'
  | 'relations'
  | 'analysis'
  | 'duplicates';

const PAGE_SIZES = [50, 100, 250, 500, 1000];

const DENSITIES: GridDensity[] = ['compact', 'cozy', 'comfortable'];

/** Stable key for a row: the rowid when available, the index otherwise. */
function rowKey(result: RowsResult, index: number): string {
  const id = result.rowids?.[index];
  return id === undefined || id === null ? `i${index}` : `r${id}`;
}

/** Per table view state (sorting, filters, density, gridlines, pinned column). */
interface SavedView {
  sorts: SortSpec[];
  filters: ColumnFilter[];
  search: string;
  density: GridDensity;
  showGridlines: boolean;
  pinnedColumn: string | null;
  columnWidths: Record<string, number>;
}

const VIEW_KEY = (table: string) => `sds.view.${table}`;

function loadView(table: string): SavedView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY(table));
    if (!raw) return null;
    return sanitizeView(JSON.parse(raw) as Partial<SavedView>);
  } catch {
    return null;
  }
}

/** Normalises any (possibly shared or hand edited) view payload. */
function sanitizeView(parsed: Partial<SavedView> | null | undefined): SavedView | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const density = parsed.density;
  return {
    sorts: Array.isArray(parsed.sorts) ? parsed.sorts : [],
    filters: Array.isArray(parsed.filters) ? parsed.filters : [],
    search: typeof parsed.search === 'string' ? parsed.search : '',
    density:
      density === 'compact' || density === 'cozy' || density === 'comfortable'
        ? density
        : 'cozy',
    showGridlines: parsed.showGridlines ?? true,
    pinnedColumn: parsed.pinnedColumn ?? null,
    columnWidths:
      parsed.columnWidths && typeof parsed.columnWidths === 'object'
        ? parsed.columnWidths
        : {},
  };
}

function saveView(table: string, view: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY(table), JSON.stringify(view));
  } catch {
    /* private mode or storage full - the view simply is not remembered */
  }
}

/** Small language neutral glyph showing the row density level. */
function DensityGlyph({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="flex flex-col items-center justify-center gap-[2px]">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={[
            'w-3 rounded-[1px] bg-current',
            index < level ? 'h-[2px]' : 'h-[1px] opacity-30',
          ].join(' ')}
        />
      ))}
    </span>
  );
}

const OPS: { value: ColumnFilter['op']; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'starts', label: 'starts with' },
  { value: 'ends', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'isnull', label: 'is NULL' },
  { value: 'notnull', label: 'is not NULL' },
];

const TABS: { id: Tab; key: TranslationKey }[] = [
  { id: 'data', key: 'table.data' },
  { id: 'structure', key: 'table.structure' },
  { id: 'ddl', key: 'table.ddl' },
  { id: 'indexes', key: 'table.indexes' },
  { id: 'relations', key: 'table.relations' },
  { id: 'analysis', key: 'table.analysis' },
  { id: 'duplicates', key: 'table.duplicates' },
];

export function TablePage() {
  const { t, locale } = useI18n();
  const { tables, isReady } = useData();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const tableName = params.tableId ? decodeURIComponent(params.tableId) : '';

  const table = useMemo(
    () => tables.find((item) => item.name.toLowerCase() === tableName.toLowerCase()),
    [tables, tableName],
  );

  /** Columns that belong to a foreign key - marked with an FK badge. */
  const foreignKeyColumns = useMemo(() => {
    const set = new Set<string>();
    for (const fk of table?.foreignKeys ?? []) {
      for (const column of fk.columns) set.add(column.toLowerCase());
    }
    return [...set];
  }, [table]);

  const [tab, setTab] = useState<Tab>('data');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [density, setDensity] = useState<GridDensity>('cozy');
  const [showGridlines, setShowGridlines] = useState(true);
  const [pinnedColumn, setPinnedColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [quickFilter, setQuickFilter] = useState<{
    column: string;
    anchor: HTMLElement;
  } | null>(null);
  const [distinctValues, setDistinctValues] = useState<
    { value: string | null; count: number }[]
  >([]);
  const [distinctLoading, setDistinctLoading] = useState(false);
  const [copied, setCopied] = useState<'tsv' | 'sql' | null>(null);
  const [result, setResult] = useState<RowsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [imageViewer, setImageViewer] = useState<{
    src: string;
    info: ImageInfo;
    column: string;
    rowIndex: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateResult | null>(null);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [shared, setShared] = useState(false);
  const viewRef = useRef<SavedView>({
    sorts: [],
    filters: [],
    search: '',
    density: 'cozy',
    showGridlines: true,
    pinnedColumn: null,
    columnWidths: {},
  });

  /* Restore the saved view (or a sensible default) whenever the table changes.
     A `?v=` payload in the URL wins over the locally saved view. */
  useEffect(() => {
    if (!table) return;
    const shared = sanitizeView(
      decodeState<Partial<SavedView>>(searchParams.get('v')),
    );
    const saved = loadView(table.name);
    const primary =
      table.columns.find((column) => column.isPrimaryKey)?.name ??
      table.columns.find((column) => column.name.toLowerCase() === 'id')?.name ??
      null;

    const defaults: SavedView = {
      sorts: primary ? [{ column: primary, dir: 'asc' }] : [],
      filters: [],
      search: '',
      density: 'cozy',
      showGridlines: true,
      pinnedColumn: primary,
      columnWidths: {},
    };

    const view: SavedView = shared ?? saved ?? defaults;

    viewRef.current = view;
    setSorts(view.sorts);
    setFilters(view.filters);
    setSearchInput(view.search);
    setSearch(view.search);
    setDensity(view.density);
    setShowGridlines(view.showGridlines);
    setPinnedColumn(view.pinnedColumn);
    setColumnWidths(view.columnWidths);
    setSelectedKeys(new Set());
    setOffset(0);
    if (!saved && !shared) saveView(table.name, view);
  }, [table, searchParams]);

  /** Persists the current view so it is restored the next time the table opens. */
  const updateView = useCallback(
    (patch: Partial<SavedView>) => {
      const next = { ...viewRef.current, ...patch };
      viewRef.current = next;
      if (table) saveView(table.name, next);
    },
    [table],
  );

  // Debounce the search box so we do not query on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
      // Only persist when the value really changed since the last save, so a
      // restored (or shared) view is never written back over the saved one.
      if (searchInput !== viewRef.current.search) {
        updateView({ search: searchInput });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput, updateView]);

  const load = useCallback(async () => {
    if (!table) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await client.rows(table.name, {
        offset,
        limit,
        sorts,
        filters,
        search: search || null,
      });
      setResult(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [table, offset, limit, sorts, filters, search]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Click cycles a single column through asc -> desc -> off.
   * Shift + click adds the column to the sort list (multi column sorting).
   */
  function handleSort(column: string, additive: boolean) {
    const previous = sorts;
    const index = previous.findIndex(
      (item) => item.column.toLowerCase() === column.toLowerCase(),
    );

    let next: SortSpec[];
    if (index === -1) {
      next = additive
        ? [...previous, { column, dir: 'asc' }]
        : [{ column, dir: 'asc' }];
    } else {
      next = [...previous];
      if (next[index].dir === 'asc') {
        next[index] = { column: next[index].column, dir: 'desc' };
      } else {
        next.splice(index, 1);
      }
    }

    setSorts(next);
    updateView({ sorts: next });
    setOffset(0);
  }

  function resetView() {
    setSorts([]);
    setFilters([]);
    setSearchInput('');
    setSearch('');
    setOffset(0);
    updateView({ sorts: [], filters: [], search: '' });
  }

  function togglePin(column: string) {
    const current = pinnedColumn;
    const next =
      current && current.toLowerCase() === column.toLowerCase() ? null : column;
    setPinnedColumn(next);
    updateView({ pinnedColumn: next });
  }

  function removeSort(column: string) {
    const next = sorts.filter(
      (item) => item.column.toLowerCase() !== column.toLowerCase(),
    );
    setSorts(next);
    updateView({ sorts: next });
    setOffset(0);
  }

  function changeDensity(next: GridDensity) {
    setDensity(next);
    updateView({ density: next });
  }

  function toggleGridlines() {
    const next = !showGridlines;
    setShowGridlines(next);
    updateView({ showGridlines: next });
  }

  function changeFilters(next: ColumnFilter[]) {
    setFilters(next);
    updateView({ filters: next });
    setOffset(0);
  }

  /* ---------------------------------------------------------------- *
   * Column widths
   * ---------------------------------------------------------------- */
  function applyColumnWidth(column: string, width: number) {
    setColumnWidths((previous) => {
      const next = { ...previous, [column]: width };
      updateView({ columnWidths: next });
      return next;
    });
  }

  /* ---------------------------------------------------------------- *
   * Row selection
   * ---------------------------------------------------------------- */
  function toggleRow(key: string, _index: number, selected: boolean) {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAllRows(selected: boolean) {
    if (!result) return;
    const keys = result.rows.map((_, index) => rowKey(result, index));
    setSelectedKeys(selected ? new Set(keys) : new Set());
  }

  const selectedRows = useMemo(() => {
    if (!result) return [] as { key: string; values: unknown[] }[];
    const out: { key: string; values: unknown[] }[] = [];
    result.rows.forEach((values, index) => {
      const key = rowKey(result, index);
      if (selectedKeys.has(key)) out.push({ key, values });
    });
    return out;
  }, [result, selectedKeys]);

  const copySelection = useCallback(async (asSql: boolean) => {
    if (!result || !selectedRows.length) return;
    const columns = result.columns;
    let text: string;
    if (asSql) {
      const quote = (value: unknown) => {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'number') return String(value);
        return `'${String(value).replace(/'/g, "''")}'`;
      };
      text = selectedRows
        .map(
          (row) =>
            `INSERT INTO ${table?.name} (${columns.join(', ')}) VALUES (${row.values
              .map(quote)
              .join(', ')});`,
        )
        .join('\n');
    } else {
      text = [columns.join('\t')]
        .concat(
          selectedRows.map((row) =>
            row.values
              .map((value) =>
                value === null || value === undefined
                  ? ''
                  : String(value).replace(/[\t\r\n]/g, ' '),
              )
              .join('\t'),
          ),
        )
        .join('\n');
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(asSql ? 'sql' : 'tsv');
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError(t('table.copyFailed'));
    }
  }, [result, selectedRows, table?.name, t]);

  /* ---------------------------------------------------------------- *
   * Keyboard shortcuts (Ctrl+Shift+C copies, ↑/↓ moves the drawer)
   * ---------------------------------------------------------------- */
  useEffect(() => {
    function onCopyRequest() {
      void copySelection(false);
    }
    function onRowStep(event: Event) {
      const delta = (event as CustomEvent<number>).detail ?? 1;
      setSelectedRow((current) => {
        const total = result?.rows.length ?? 0;
        if (!total) return current;
        if (current === null) return delta > 0 ? 0 : total - 1;
        const next = current + delta;
        if (next < 0) return 0;
        if (next >= total) return total - 1;
        return next;
      });
    }
    window.addEventListener(EV_COPY_SELECTION, onCopyRequest);
    window.addEventListener(EV_ROW_STEP, onRowStep);
    return () => {
      window.removeEventListener(EV_COPY_SELECTION, onCopyRequest);
      window.removeEventListener(EV_ROW_STEP, onRowStep);
    };
  }, [result, copySelection]);

  /* ---------------------------------------------------------------- *
   * Quick filter (distinct values)
   * ---------------------------------------------------------------- */
  async function openQuickFilter(column: string, anchor: HTMLElement) {
    setQuickFilter({ column, anchor });
    setDistinctLoading(true);
    setDistinctValues([]);
    try {
      const values = await client.distinct(table?.name ?? '', column, 60);
      setDistinctValues(values);
    } catch {
      setDistinctValues([]);
    } finally {
      setDistinctLoading(false);
    }
  }

  function applyQuickFilter(column: string, value: string | null) {
    const rest = filters.filter(
      (filter) => filter.column.toLowerCase() !== column.toLowerCase(),
    );
    const next =
      value === null
        ? rest
        : [...rest, { column, op: 'equals' as const, value }];
    changeFilters(next);
  }

  /* ---------------------------------------------------------------- *
   * Share the current view as a link
   * ---------------------------------------------------------------- */
  async function shareView() {
    const url = shareUrl(viewRef.current);
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      setError(t('table.copyFailed'));
    }
  }

  /* ---------------------------------------------------------------- *
   * Column analysis / duplicate detection (loaded on demand)
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (tab !== 'analysis' || !table) return;
    let cancelled = false;
    setProfilesLoading(true);
    client
      .columnProfiles(table.name)
      .then((items) => {
        if (!cancelled) setProfiles(items);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      })
      .finally(() => {
        if (!cancelled) setProfilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, table]);

  useEffect(() => {
    if (tab !== 'duplicates' || !table) return;
    let cancelled = false;
    setDuplicatesLoading(true);
    client
      .duplicates(table.name, undefined, 100)
      .then((res) => {
        if (!cancelled) setDuplicates(res);
      })
      .catch(() => {
        if (!cancelled) setDuplicates(null);
      })
      .finally(() => {
        if (!cancelled) setDuplicatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, table]);

  async function handleExport(format: 'csv' | 'json' | 'xlsx' | 'sql') {
    if (!table) return;
    setExporting(true);
    try {
      const payload = await client.export(
        table.name,
        format,
        { offset: 0, limit: 200000, sorts, filters, search: search || null },
        200000,
      );
      downloadPayload(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  if (!isReady) {
    return <div className="card p-10 text-center text-sm text-muted">{t('errors.noDatabase')}</div>;
  }

  if (!table) {
    return (
      <div className="card p-10 text-center text-sm text-muted">
        {t('errors.noDatabase')}{' '}
        <Link className="text-accent underline" to="/tables">
          {t('tables.title')}
        </Link>
      </div>
    );
  }

  const total = result?.total ?? 0;
  const page = Math.floor(offset / Math.max(limit, 1)) + 1;
  const pages = Math.max(1, Math.ceil(total / Math.max(limit, 1)));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3 animate-fade-up">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Link to="/tables" className="hover:text-accent">
              {t('tables.title')}
            </Link>
            <span>/</span>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-text" dir="auto">
            <IconTable size={22} className="text-accent" />
            {table.name}
          </h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="chip">
              {formatNumber(table.rowCount, locale)} {t('common.rows')}
            </span>
            <span className="chip">
              {formatNumber(table.columns.length, locale)} {t('common.columns')}
            </span>
            {table.comment && <span className="chip">{table.comment}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <IconSearch
              size={15}
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted start-3"
            />
            <input
              className="input-base w-64 ps-9"
              placeholder={t('table.searchPlaceholder')}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <button type="button" className="btn" onClick={() => void load()} title={t('common.actions')}>
            <IconRefresh size={15} />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map(({ id, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              'relative px-3.5 py-2 text-[13px] font-semibold transition',
              tab === id ? 'text-accent' : 'text-muted hover:text-text',
            ].join(' ')}
          >
            {t(key)}
            {tab === id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
          </button>
        ))}
      </div>

      {error && (
        <div className="card border-danger/40 bg-danger/10 p-3 text-[13px] text-danger">{error}</div>
      )}

      {tab === 'data' && (
        <div className="flex flex-col gap-3">
          {/* ---------------- view options ---------------- */}
          <div className="card flex flex-wrap items-center gap-2 p-2.5">
            <span className="flex items-center gap-1.5 text-[12px] font-bold text-text-soft">
              <IconSort size={14} />
              {t('table.sortedBy')}
            </span>

            {sorts.length === 0 ? (
              <span className="text-[12px] text-muted">{t('table.noSort')}</span>
            ) : (
              sorts.map((sort, index) => (
                <button
                  key={sort.column}
                  type="button"
                  onClick={() => removeSort(sort.column)}
                  title={t('table.multiSortHint')}
                  className="chip transition hover:border-danger/50 hover:text-danger"
                >
                  <span className="grid h-[15px] min-w-[15px] place-items-center rounded-full bg-accent px-1 text-[9.5px] font-black text-white">
                    {index + 1}
                  </span>
                  <span className="mono" dir="auto">
                    {sort.column}
                  </span>
                  <span className="text-[13px] leading-none">
                    {sort.dir === 'asc' ? '▲' : '▼'}
                  </span>
                  <span className="text-[13px] leading-none opacity-60">×</span>
                </button>
              ))
            )}

            <div className="ms-auto flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[12px] text-text-soft">
                <IconRows size={14} />
                <span className="hidden sm:inline">{t('table.density')}</span>
              </div>
              <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
                {DENSITIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => changeDensity(item)}
                    title={t(
                      `table.density${
                        item.charAt(0).toUpperCase()}${item.slice(1)
                      }` as TranslationKey,
                    )}
                    className={[
                      'rounded-md px-1.5 py-1 transition',
                      density === item
                        ? 'bg-surface text-accent shadow-sm'
                        : 'text-muted hover:text-text',
                    ].join(' ')}
                  >
                    <DensityGlyph level={item === 'compact' ? 1 : item === 'cozy' ? 2 : 3} />
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={showGridlines ? 'btn btn-primary' : 'btn'}
                onClick={toggleGridlines}
                title={t('table.gridlines')}
                aria-pressed={showGridlines}
              >
                <IconGrid size={15} />
              </button>

              <button
                type="button"
                className="btn"
                onClick={resetView}
                title={t('table.resetView')}
              >
                <IconRefresh size={15} />
                <span className="hidden sm:inline">{t('table.resetView')}</span>
              </button>

              <button
                type="button"
                className={shared ? 'btn btn-primary' : 'btn'}
                onClick={() => void shareView()}
                title={t('table.share')}
              >
                <IconShare size={15} />
                <span className="hidden sm:inline">
                  {shared ? t('table.shareCopied') : t('table.share')}
                </span>
              </button>
            </div>
          </div>

          <div className="card flex flex-wrap items-center gap-2 p-3">
            <span className="flex items-center gap-1.5 text-[12px] font-bold text-text-soft">
              <IconFilter size={14} />
              {t('common.filter')}
            </span>

            {filters.map((filter, index) => (
              <div key={index} className="flex items-center gap-1.5 rounded-lg bg-surface-2 p-1">
                <select
                  className="input-base !py-1 text-[12px]"
                  value={filter.column}
                  onChange={(event) => {
                    const next = [...filters];
                    next[index] = { ...filter, column: event.target.value };
                    changeFilters(next);
                  }}
                >
                  {table.columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input-base !py-1 text-[12px]"
                  value={filter.op}
                  onChange={(event) => {
                    const next = [...filters];
                    next[index] = { ...filter, op: event.target.value as ColumnFilter['op'] };
                    changeFilters(next);
                  }}
                >
                  {OPS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
                {filter.op !== 'isnull' && filter.op !== 'notnull' && (
                  <input
                    className="input-base !py-1 text-[12px]"
                    placeholder={t('table.filterValue')}
                    value={filter.value}
                    onChange={(event) => {
                      const next = [...filters];
                      next[index] = { ...filter, value: event.target.value };
                      changeFilters(next);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        changeFilters([...filters]);
                      }
                    }}
                  />
                )}
                <button
                  type="button"
                  className="btn btn-ghost !px-1.5"
                  onClick={() => {
                    changeFilters(filters.filter((_, i) => i !== index));
                  }}
                >
                  ×
                </button>
              </div>
            ))}

            <button
              type="button"
              className="btn"
              onClick={() => {
                changeFilters([
                  ...filters,
                  { column: table.columns[0]?.name ?? '', op: 'contains', value: '' },
                ]);
              }}
            >
              + {t('table.addFilter')}
            </button>

            {filters.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => changeFilters([])}>
                {t('table.clearFilters')}
              </button>
            )}

            <div className="ms-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-text-soft">
                {t('common.rowsPerPage')}
                <select
                  className="input-base !py-1 text-[12px]"
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number(event.target.value));
                    setOffset(0);
                  }}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <div className="relative">
                <details className="relative">
                  <summary className="btn btn-primary list-none cursor-pointer">
                    <IconDownload size={15} />
                    {t('table.export')}
                  </summary>
                  <div className="absolute end-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-[var(--shadow-pop)]">
                    {(
                      [
                        ['csv', t('table.exportCsv')],
                        ['json', t('table.exportJson')],
                        ['xlsx', t('table.exportXlsx')],
                        ['sql', t('table.exportSql')],
                      ] as const
                    ).map(([format, label]) => (
                      <button
                        key={format}
                        type="button"
                        className="block w-full px-3 py-2 text-start text-[12.5px] font-semibold text-text-soft hover:bg-surface-2 hover:text-text"
                        onClick={() => void handleExport(format)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>

          {exporting && <p className="text-xs text-muted">{t('table.exporting')}</p>}

          {selectedKeys.size > 0 && (
            <div className="card flex flex-wrap items-center gap-2 border-accent/40 bg-accent/10 p-2.5">
              <span className="text-[12px] font-bold text-accent">
                {formatNumber(selectedKeys.size, locale)} {t('table.selectedRows')}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => void copySelection(false)}
                title={t('table.copyRows')}
              >
                <IconCopy size={14} />
                {copied === 'tsv' ? t('table.copied') : t('table.copy')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void copySelection(true)}
                title={t('table.copyAsSql')}
              >
                <IconCode size={14} />
                {copied === 'sql' ? t('table.copied') : t('table.copyAsSql')}
              </button>
              <button
                type="button"
                className="btn btn-ghost ms-auto"
                onClick={() => setSelectedKeys(new Set())}
              >
                {t('table.clearSelection')}
              </button>
            </div>
          )}

          <div className="h-[58vh]">
            <DataGrid
              columns={result?.columns ?? table.columns.map((c) => c.name)}
              rows={result?.rows ?? []}
              meta={table.columns}
              foreignKeyColumns={foreignKeyColumns}
              loading={loading}
              emptyMessage={t('table.noRows')}
              sorts={sorts}
              onSort={handleSort}
              density={density}
              showGridlines={showGridlines}
              pinnedColumn={pinnedColumn}
              onTogglePin={togglePin}
              rowOffset={offset}
              pinLabel={t('table.pinColumn')}
              unpinLabel={t('table.unpinColumn')}
              columnWidths={columnWidths}
              onResizeColumn={applyColumnWidth}
              onAutoFitColumn={applyColumnWidth}
              onOpenImage={(payload) => setImageViewer(payload)}
              searchTerm={search}
              rowKeys={result ? result.rows.map((_, index) => rowKey(result, index)) : undefined}
              selectedKeys={selectedKeys}
              onToggleRow={toggleRow}
              onToggleAll={toggleAllRows}
              onQuickFilter={(column) => {
                const anchor = document.querySelector<HTMLElement>(
                  `[data-grid-column="${CSS.escape(column)}"]`,
                );
                if (anchor) void openQuickFilter(column, anchor);
              }}
              filteredColumns={filters.map((filter) => filter.column)}
              labels={{
                selectAll: t('table.selectAll'),
                selectRow: t('table.selectRow'),
                filterColumn: t('table.quickFilter'),
                autoFit: t('table.autoFit'),
              }}
              onRowClick={(index) => setSelectedRow(index)}
            />
          </div>

          <QuickFilter
            anchor={quickFilter?.anchor ?? null}
            column={quickFilter?.column ?? ''}
            values={distinctValues}
            loading={distinctLoading}
            activeValue={
              quickFilter
                ? filters.find(
                    (filter) =>
                      filter.column.toLowerCase() ===
                      quickFilter.column.toLowerCase(),
                  )?.value ?? null
                : null
            }
            onSelect={(value) => {
              if (quickFilter) applyQuickFilter(quickFilter.column, value);
            }}
            onClose={() => setQuickFilter(null)}
            labels={{
              title: t('table.quickFilter'),
              all: t('table.allValues'),
              nullValue: 'NULL',
              empty: t('table.noValues'),
              loading: t('common.loading'),
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-text-soft">
            <span>
              {t('table.rowsShown')} {formatNumber(offset + 1, locale)}–
              {formatNumber(Math.min(offset + limit, total), locale)} {t('common.of')}{' '}
              {formatNumber(total, locale)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={offset <= 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                {t('common.previous')}
              </button>
              <span className="mono">
                {t('common.page')} {formatNumber(page, locale)} {t('common.of')}{' '}
                {formatNumber(pages, locale)}
              </span>
              <button
                type="button"
                className="btn"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'structure' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-start text-[11.5px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-start font-bold">#</th>
                <th className="px-3 py-2 text-start font-bold">{t('common.name')}</th>
                <th className="px-3 py-2 text-start font-bold">{t('common.type')}</th>
                <th className="px-3 py-2 text-start font-bold">{t('table.nullable')}</th>
                <th className="px-3 py-2 text-start font-bold">{t('table.default')}</th>
                <th className="px-3 py-2 text-start font-bold">{t('table.pk')}</th>
                <th className="px-3 py-2 text-start font-bold">{t('table.auto')}</th>
                <th className="px-3 py-2 text-start font-bold">{t('table.comment')}</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((column, index) => (
                <tr key={column.name} className="border-b border-border/60 hover:bg-surface-2/60">
                  <td className="px-3 py-2 text-muted">{index + 1}</td>
                  <td className="mono px-3 py-2 font-bold text-text" dir="auto">
                    {column.name}
                  </td>
                  <td className="px-3 py-2">
                    <span className="chip mono">{column.originalType}</span>
                  </td>
                  <td className="px-3 py-2">
                    {column.nullable ? (
                      <span className="text-muted">{t('common.yes')}</span>
                    ) : (
                      <span className="text-success">{t('common.no')}</span>
                    )}
                  </td>
                  <td className="mono px-3 py-2 text-text-soft" dir="auto">
                    {column.defaultValue ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {column.isPrimaryKey && <span className="chip">{t('table.pk')}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {column.isAutoIncrement && <span className="chip">{t('table.auto')}</span>}
                  </td>
                  <td className="px-3 py-2 text-text-soft" dir="auto">
                    {column.comment ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ddl' && (
        <div className="card overflow-hidden">
          {table.ddl ? (
            <SqlViewer code={table.ddl} maxHeight="70vh" />
          ) : (
            <p className="p-8 text-center text-sm text-muted">{t('table.noDdl')}</p>
          )}
        </div>
      )}

      {tab === 'indexes' && (
        <div className="card overflow-x-auto">
          {table.indexes.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted">{t('common.none')}</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-start font-bold">{t('common.name')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('common.columns')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('table.unique')}</th>
                </tr>
              </thead>
              <tbody>
                {table.indexes.map((index) => (
                  <tr key={index.name} className="border-b border-border/60">
                    <td className="mono px-3 py-2 font-bold text-text" dir="auto">
                      {index.name}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {index.columns.map((column) => (
                          <span key={column} className="chip mono">
                            {column}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {index.unique ? (
                        <span className="chip">{t('common.yes')}</span>
                      ) : (
                        <span className="text-muted">{t('common.no')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'relations' && (
        <div className="card overflow-x-auto">
          {table.foreignKeys.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted">{t('relations.noRelations')}</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-start font-bold">{t('common.columns')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('table.references')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('table.onDelete')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('table.onUpdate')}</th>
                </tr>
              </thead>
              <tbody>
                {table.foreignKeys.map((fk, index) => (
                  <tr key={index} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {fk.columns.map((column) => (
                          <span key={column} className="chip mono">
                            {column}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/tables/${encodeURIComponent(fk.refTable)}`}
                        className="text-accent hover:underline"
                        dir="auto"
                      >
                        {fk.refTable}
                      </Link>
                      <span className="ms-1 text-muted">({fk.refColumns.join(', ')})</span>
                    </td>
                    <td className="px-3 py-2 text-text-soft">{fk.onDelete ?? '—'}</td>
                    <td className="px-3 py-2 text-text-soft">{fk.onUpdate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'analysis' && (
        <ColumnAnalysis
          profiles={profiles}
          columns={table.columns}
          totalRows={result?.total ?? table.rowCount}
          loading={profilesLoading}
          foreignKeyColumns={foreignKeyColumns}
        />
      )}

      {tab === 'duplicates' && (
        <DuplicatesPanel
          result={duplicates}
          loading={duplicatesLoading}
          onShowRows={(values) => {
            const next = values.map((value) =>
              value === null || value === undefined ? '' : String(value),
            );
            changeFilters(
              duplicates?.columns.map((column) => ({
                column,
                op: 'equals' as const,
                value: next[duplicates.columns.indexOf(column)] ?? '',
              })) ?? [],
            );
            setTab('data');
          }}
        />
      )}

      <RowDrawer
        open={selectedRow !== null}
        columns={result?.columns ?? []}
        row={selectedRow !== null ? (result?.rows[selectedRow] ?? null) : null}
        meta={table.columns}
        tableName={table.name}
        onClose={() => setSelectedRow(null)}
      />

      {imageViewer && (
        <ImageViewer
          src={imageViewer.src}
          info={imageViewer.info}
          column={imageViewer.column}
          rowIndex={imageViewer.rowIndex}
          onClose={() => setImageViewer(null)}
        />
      )}
    </div>
  );
}
