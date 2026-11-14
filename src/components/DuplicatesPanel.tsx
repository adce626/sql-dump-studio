import { useI18n } from '../i18n/useI18n';
import { formatNumber, hexPreview } from '../lib/format';
import type { DuplicateResult } from '../worker/protocol';

interface DuplicatesPanelProps {
  result: DuplicateResult | null;
  loading?: boolean;
  /** Shows the rows behind a duplicate group inside the table. */
  onShowRows?: (values: unknown[]) => void;
}

function preview(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return hexPreview(value, 4);
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export function DuplicatesPanel({ result, loading, onShowRows }: DuplicatesPanelProps) {
  const { t, locale } = useI18n();

  if (loading) {
    return <div className="card p-10 text-center text-sm text-muted">…</div>;
  }

  if (!result) {
    return (
      <div className="card p-10 text-center text-sm text-muted">{t('table.analysisEmpty')}</div>
    );
  }

  if (!result.groupCount) {
    return (
      <div className="card p-10 text-center text-sm text-muted">
        <span className="text-success">✓</span> {t('table.noDuplicates')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-[13px]">
        <div>
          <span className="text-muted">{t('table.duplicateGroups')}: </span>
          <span className="font-extrabold text-accent tabular-nums">
            {formatNumber(result.groupCount, locale)}
          </span>
        </div>
        <div>
          <span className="text-muted">{t('table.duplicateRows')}: </span>
          <span className="font-extrabold text-warn tabular-nums">
            {formatNumber(result.rowCount, locale)}
          </span>
        </div>
        <div className="text-[11.5px] text-muted">
          {result.columns.map((column) => (
            <span key={column} className="chip ms-1">
              {column}
            </span>
          ))}
        </div>
      </div>

      <div className="card divide-y divide-border overflow-hidden">
        {result.groups.map((group, index) => (
          <div
            key={`${group.key}-${index}`}
            className="flex flex-wrap items-center gap-2 p-3 text-[12.5px]"
          >
            <span className="grid-badge grid-badge-fk">×{group.count}</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {group.values[0]?.map((value, columnIndex) => (
                <span
                  key={columnIndex}
                  className="chip max-w-[220px] truncate font-mono text-[11px]"
                  dir="auto"
                  title={`${result.columns[columnIndex] ?? ''} = ${preview(value)}`}
                >
                  <span className="text-muted">{result.columns[columnIndex]}:</span> {preview(value)}
                </span>
              ))}
            </span>
            {onShowRows && (
              <button
                type="button"
                className="btn btn-ghost text-[11.5px]"
                onClick={() => onShowRows(group.values[0] ?? [])}
              >
                {t('table.showRows')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
