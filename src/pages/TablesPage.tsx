import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { formatBytes, formatNumber } from '../lib/format';
import { IconArrowRight, IconSearch, IconTable } from '../components/Icons';

export function TablesPage() {
  const { t, locale } = useI18n();
  const { tables, isReady } = useData();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((table) => table.name.toLowerCase().includes(needle));
  }, [tables, filter]);

  if (!isReady) {
    return (
      <div className="card p-10 text-center text-sm text-muted">{t('errors.noDatabase')}</div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-extrabold text-text">{t('tables.title')}</h1>
          <p className="mt-1 text-sm text-text-soft">{t('tables.subtitle')}</p>
        </div>
        <div className="relative w-full sm:w-72">
          <IconSearch
            size={15}
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted start-3"
          />
          <input
            className="input-base w-full ps-9"
            placeholder={t('tables.searchPlaceholder')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">{t('tables.empty')}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((table, index) => (
            <Link
              key={table.name}
              to={`/tables/${encodeURIComponent(table.name)}`}
              className="card group flex flex-col gap-3 p-4 transition hover:border-accent/60 hover:shadow-[var(--shadow-pop)] animate-fade-up"
              style={{ animationDelay: `${Math.min(index, 12) * 20}ms` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <IconTable size={16} />
                  </span>
                  <span className="truncate text-sm font-bold text-text" dir="auto">
                    {table.name}
                  </span>
                </div>
                <IconArrowRight
                  size={16}
                  className="shrink-0 text-muted transition group-hover:text-accent rtl:rotate-180"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {table.type === 'view' && <span className="chip">{t('tables.view')}</span>}
                <span className="chip">
                  {formatNumber(table.columns.length, locale)} {t('common.columns')}
                </span>
                <span className="chip">
                  {formatNumber(table.rowCount, locale)} {t('common.rows')}
                </span>
                {table.indexes.length > 0 && (
                  <span className="chip">
                    {formatNumber(table.indexes.length, locale)} {t('tables.indexesCount')}
                  </span>
                )}
                {table.foreignKeys.length > 0 && (
                  <span className="chip">
                    {formatNumber(table.foreignKeys.length, locale)} {t('tables.relationsCount')}
                  </span>
                )}
                <span className="chip">{formatBytes(table.bytes, locale)}</span>
              </div>

              <ul className="flex flex-wrap gap-1 text-[11px] text-muted">
                {table.columns.slice(0, 5).map((column) => (
                  <li key={column.name} className="mono rounded bg-surface-2 px-1.5 py-0.5">
                    {column.name}
                  </li>
                ))}
                {table.columns.length > 5 && <li>+{table.columns.length - 5}</li>}
              </ul>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
