import { useMemo } from 'react';
import { useI18n } from '../i18n/useI18n';
import { formatNumber, hexPreview } from '../lib/format';
import type { ColumnMeta, ColumnProfile } from '../worker/protocol';

interface ColumnAnalysisProps {
  profiles: ColumnProfile[];
  columns: ColumnMeta[];
  totalRows: number;
  loading?: boolean;
  /** Columns that take part in a foreign key. */
  foreignKeyColumns?: string[];
}

function percent(value: number, total: number): string {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(value / total < 0.01 ? 2 : 1)}%`;
}

function typeChipClass(column: ColumnMeta | undefined): string {
  if (!column) return 'type-text';
  if (column.affinity === 'INTEGER') return 'type-int';
  if (column.affinity === 'REAL' || column.affinity === 'NUMERIC') return 'type-real';
  if (column.affinity === 'BLOB') return 'type-blob';
  if (/date|time|year/i.test(column.originalType)) return 'type-date';
  return 'type-text';
}

function isNumeric(profile: ColumnProfile): boolean {
  if (profile.avg !== null && profile.sum !== null) return true;
  if (typeof profile.min === 'number' && typeof profile.max === 'number') return true;
  return false;
}

/** Renders a short value preview (truncated) for the profile cards. */
function preview(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return hexPreview(value, 6);
  const text = String(value);
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

export function ColumnAnalysis({
  profiles,
  columns,
  totalRows,
  loading,
  foreignKeyColumns,
}: ColumnAnalysisProps) {
  const { t, locale } = useI18n();

  const metaByName = useMemo(() => {
    const map = new Map<string, ColumnMeta>();
    for (const column of columns) map.set(column.name.toLowerCase(), column);
    return map;
  }, [columns]);

  const fkColumns = useMemo(
    () => new Set((foreignKeyColumns ?? []).map((name) => name.toLowerCase())),
    [foreignKeyColumns],
  );

  if (loading) {
    return <div className="card p-10 text-center text-sm text-muted">…</div>;
  }

  if (!profiles.length) {
    return (
      <div className="card p-10 text-center text-sm text-muted">{t('table.analysisEmpty')}</div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {profiles.map((profile) => {
        const meta = metaByName.get(profile.column.toLowerCase());
        const numeric = isNumeric(profile);
        const maxCount = profile.topValues.reduce((max, item) => Math.max(max, item.count), 0);
        const nullRatio = totalRows ? profile.nullCount / totalRows : 0;

        return (
          <article key={profile.column} className="card p-4">
            <header className="mb-3 flex items-center gap-2">
              <span className="truncate text-[13px] font-extrabold" dir="auto">
                {profile.column}
              </span>
              {meta && (
                <span className={`type-chip shrink-0 ${typeChipClass(meta)}`}>
                  {meta.originalType}
                </span>
              )}
              {meta?.isPrimaryKey && <span className="grid-badge grid-badge-pk">PK</span>}
              {fkColumns.has(profile.column.toLowerCase()) && (
                <span className="grid-badge grid-badge-fk">FK</span>
              )}
            </header>

            <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              <div>
                <div className="text-muted">{t('table.rowsCount')}</div>
                <div className="font-bold tabular-nums">
                  {formatNumber(totalRows, locale)}
                </div>
              </div>
              <div>
                <div className="text-muted">{t('table.distinctValues')}</div>
                <div className="font-bold tabular-nums">
                  {formatNumber(profile.distinctCount, locale)}
                  <span className="ms-1 text-[11px] font-normal text-muted">
                    ({percent(profile.distinctCount, totalRows)})
                  </span>
                </div>
              </div>
              <div>
                <div className="text-muted">{t('table.nullValues')}</div>
                <div
                  className={[
                    'font-bold tabular-nums',
                    nullRatio > 0.3 ? 'text-danger' : nullRatio > 0 ? 'text-warn' : 'text-success',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {formatNumber(profile.nullCount, locale)}
                  <span className="ms-1 text-[11px] font-normal text-muted">
                    ({percent(profile.nullCount, totalRows)})
                  </span>
                </div>
              </div>
              <div>
                <div className="text-muted">{t('table.length')}</div>
                <div className="font-bold tabular-nums">
                  {profile.minLength === null ? '—' : profile.minLength}
                  <span className="mx-1 text-muted">–</span>
                  {profile.maxLength === null ? '—' : profile.maxLength}
                </div>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              <div>
                <div className="text-muted">min</div>
                <div className="truncate font-mono text-[11.5px]" dir="auto">
                  {preview(profile.min)}
                </div>
              </div>
              <div>
                <div className="text-muted">max</div>
                <div className="truncate font-mono text-[11.5px]" dir="auto">
                  {preview(profile.max)}
                </div>
              </div>
              {numeric && (
                <>
                  <div>
                    <div className="text-muted">{t('table.average')}</div>
                    <div className="font-mono text-[11.5px] tabular-nums">
                      {profile.avg === null
                        ? '—'
                        : formatNumber(Number(profile.avg.toFixed(4)), locale)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted">{t('table.total')}</div>
                    <div className="font-mono text-[11.5px] tabular-nums">
                      {profile.sum === null
                        ? '—'
                        : formatNumber(Number(profile.sum.toFixed(4)), locale)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div>
              <div className="mb-1 text-[11px] font-semibold text-muted">
                {t('table.topValues')}
              </div>
              {profile.topValues.length === 0 ? (
                <div className="text-[11.5px] text-muted">—</div>
              ) : (
                <ul className="space-y-1">
                  {profile.topValues.map((item) => (
                    <li key={item.value} className="flex items-center gap-2">
                      <span
                        className="w-24 shrink-0 truncate font-mono text-[11px]"
                        dir="auto"
                        title={item.value}
                      >
                        {item.value || '—'}
                      </span>
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span
                          className="block h-full rounded-full bg-accent/70"
                          style={{ width: `${maxCount ? (item.count / maxCount) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-end text-[11px] tabular-nums text-muted">
                        {formatNumber(item.count, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
