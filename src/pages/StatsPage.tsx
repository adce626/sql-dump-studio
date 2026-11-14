import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { client } from '../lib/client';
import { formatBytes, formatNumber } from '../lib/format';
import type { ColumnProfile } from '../worker/protocol';

export function StatsPage() {
  const { t, locale } = useI18n();
  const { tables, stats, isReady } = useData();
  const [selected, setSelected] = useState('');
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);

  useEffect(() => {
    if (!selected && tables.length) setSelected(tables[0].name);
  }, [tables, selected]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) return;
    client
      .columnProfiles(selected)
      .then((result) => {
        if (!cancelled) setProfiles(result);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (!isReady || !stats) {
    return <div className="card p-10 text-center text-sm text-muted">{t('errors.noDatabase')}</div>;
  }

  const maxRows = Math.max(1, ...stats.largest.map((item) => item.rows));
  const cards = [
    { label: t('stats.tables'), value: formatNumber(stats.tableCount, locale) },
    { label: t('stats.views'), value: formatNumber(stats.viewCount, locale) },
    { label: t('stats.rows'), value: formatNumber(stats.totalRows, locale) },
    { label: t('stats.size'), value: formatBytes(stats.totalBytes, locale) },
    { label: t('stats.indexes'), value: formatNumber(stats.indexCount, locale) },
    { label: t('stats.foreignKeys'), value: formatNumber(stats.foreignKeyCount, locale) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold text-text">{t('stats.title')}</h1>
        <p className="mt-1 text-sm text-text-soft">{t('stats.subtitle')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-[11.5px] font-semibold text-muted">{card.label}</p>
            <p className="mt-1.5 text-xl font-extrabold text-text">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-bold text-text">{t('stats.largest')}</h2>
        <ul className="space-y-2.5">
          {stats.largest.map((item) => (
            <li key={item.table} className="flex items-center gap-3">
              <Link
                to={`/tables/${encodeURIComponent(item.table)}`}
                className="w-40 shrink-0 truncate text-[12.5px] font-semibold text-text hover:text-accent"
                dir="auto"
              >
                {item.table}
              </Link>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(2, (item.rows / maxRows) * 100)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-end text-[11.5px] text-muted">
                {formatNumber(item.rows, locale)} · {formatBytes(item.bytes, locale)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-text">{t('stats.profiles')}</h2>
          <select
            className="input-base w-auto min-w-48"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {tables.map((table) => (
              <option key={table.name} value={table.name}>
                {table.name}
              </option>
            ))}
          </select>
        </div>

        {profiles.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{t('stats.noProfiles')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-start font-bold">{t('common.name')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('stats.nonNull')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('stats.nullCount')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('stats.distinct')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('stats.minLength')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('stats.maxLength')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('stats.topValues')}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.column} className="border-b border-border/60 align-top">
                    <td className="mono px-3 py-2 font-bold text-text" dir="auto">
                      {profile.column}
                    </td>
                    <td className="px-3 py-2">{formatNumber(profile.nonNullCount, locale)}</td>
                    <td className="px-3 py-2 text-muted">
                      {formatNumber(profile.nullCount, locale)}
                    </td>
                    <td className="px-3 py-2">{formatNumber(profile.distinctCount, locale)}</td>
                    <td className="px-3 py-2 text-text-soft">
                      {profile.minLength === null ? '—' : formatNumber(profile.minLength, locale)}
                    </td>
                    <td className="px-3 py-2 text-text-soft">
                      {profile.maxLength === null ? '—' : formatNumber(profile.maxLength, locale)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {profile.topValues.map((entry) => (
                          <span key={entry.value} className="chip mono">
                            {entry.value.slice(0, 24)} · {entry.count}
                          </span>
                        ))}
                        {profile.topValues.length === 0 && (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
