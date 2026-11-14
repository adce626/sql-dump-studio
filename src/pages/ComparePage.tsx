import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { client } from '../lib/client';
import { formatNumber, hexPreview } from '../lib/format';
import { IconRefresh } from '../components/Icons';
import type { DiffResult } from '../worker/protocol';

function preview(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return hexPreview(value, 4);
  const text = String(value);
  return text.length > 46 ? `${text.slice(0, 46)}…` : text;
}

interface ChangedRow {
  key: string;
  left: unknown[];
  right: unknown[];
  changedColumns: string[];
}

/**
 * Shows every changed key twice: the value before (left table) and the value
 * after (right table), with the differing cells highlighted.
 */
function ChangedRowsTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: ChangedRow[];
}) {
  const { t, locale } = useI18n();

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-extrabold text-accent">{title}</h3>
        <span className="chip">{formatNumber(rows.length, locale)}</span>
      </header>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-surface-2">
              <th className="px-3 py-1.5 text-start font-semibold text-muted">
                {t('compare.changed')}
              </th>
              {columns.map((column) => (
                <th
                  key={column}
                  className="px-3 py-1.5 text-start font-semibold text-muted"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row, rowIndex) => {
              const changed = new Set(row.changedColumns.map((c) => c.toLowerCase()));
              const sides = [
                { side: 'left' as const, values: row.left },
                { side: 'right' as const, values: row.right },
              ];
              return sides.map(({ side, values }) => (
                <tr
                  key={`${rowIndex}-${side}`}
                  className={[
                    'border-t border-border/50',
                    side === 'left' ? 'bg-danger/5' : 'bg-success/5',
                  ].join(' ')}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-muted">
                    <span
                      className={
                        side === 'left'
                          ? 'me-1 font-bold text-danger'
                          : 'me-1 font-bold text-success'
                      }
                    >
                      {side === 'left' ? '◀' : '▶'}
                    </span>
                    {side === 'left' ? t('compare.before') : t('compare.after')}
                  </td>
                  {columns.map((column, columnIndex) => {
                    const isChanged = changed.has(column.toLowerCase());
                    const value = values[columnIndex];
                    return (
                      <td
                        key={column}
                        className={[
                          'max-w-[240px] truncate px-3 py-1.5 font-mono text-[11.5px]',
                          isChanged
                            ? side === 'left'
                              ? 'bg-danger/12 font-semibold text-danger line-through'
                              : 'bg-success/12 font-semibold text-success'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={isChanged ? preview(value) : undefined}
                      >
                        {preview(value)}
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface DiffRowTableProps {
  title: string;
  tone: 'warn' | 'danger' | 'accent';
  columns: string[];
  rows: unknown[][];
  changedColumns?: string[];
  emptyLabel: string;
}

function DiffRowTable({
  title,
  tone,
  columns,
  rows,
  changedColumns,
  emptyLabel,
}: DiffRowTableProps) {
  const { t, locale } = useI18n();
  const changed = useMemo(
    () => new Set((changedColumns ?? []).map((column) => column.toLowerCase())),
    [changedColumns],
  );

  const toneClass =
    tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-accent';

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className={`text-[13px] font-extrabold ${toneClass}`}>{title}</h3>
        <span className="chip">{formatNumber(rows.length, locale)}</span>
      </header>
      {rows.length === 0 ? (
        <p className="p-4 text-[12.5px] text-muted">{emptyLabel}</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-2 text-start">
                {columns.map((column) => (
                  <th
                    key={column}
                    className={[
                      'px-3 py-1.5 text-start font-semibold text-muted',
                      changed.has(column.toLowerCase()) ? 'text-warn' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-border/50">
                  {row.map((value, columnIndex) => (
                    <td
                      key={columnIndex}
                      className={[
                        'max-w-[260px] truncate px-3 py-1.5 font-mono text-[11.5px]',
                        changed.has((columns[columnIndex] ?? '').toLowerCase())
                          ? 'bg-warn/10 text-warn'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      dir="auto"
                      title={preview(value)}
                    >
                      {preview(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="border-t border-border px-4 py-2 text-[11px] text-muted">
        {t('compare.sample')}
      </footer>
    </section>
  );
}

export function ComparePage() {
  const { t, locale } = useI18n();
  const { tables, isReady } = useData();
  const [params, setParams] = useSearchParams();

  const leftName = params.get('a') ?? '';
  const rightName = params.get('b') ?? '';

  const [left, setLeft] = useState(leftName);
  const [right, setRight] = useState(rightName);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLeft(leftName);
    setRight(rightName);
  }, [leftName, rightName]);

  const run = useCallback(async () => {
    if (!left || !right || left === right) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const diff = await client.diff(left, right, undefined, 50);
      setResult(diff);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [left, right]);

  useEffect(() => {
    void run();
  }, [run]);

  function updatePair(nextLeft: string, nextRight: string) {
    setLeft(nextLeft);
    setRight(nextRight);
    const next = new URLSearchParams(params);
    if (nextLeft) next.set('a', nextLeft);
    else next.delete('a');
    if (nextRight) next.set('b', nextRight);
    else next.delete('b');
    setParams(next, { replace: true });
  }

  if (!isReady) {
    return <div className="card p-10 text-center text-sm text-muted">{t('errors.noDatabase')}</div>;
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-extrabold">{t('compare.title')}</h1>
        <p className="text-[12.5px] text-muted">{t('compare.subtitle')}</p>
      </header>

      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-muted">
            {t('compare.left')}
          </span>
          <select
            className="input-base w-full"
            value={left}
            onChange={(event) => updatePair(event.target.value, right)}
          >
            <option value="">—</option>
            {tables.map((table) => (
              <option key={table.name} value={table.name}>
                {table.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-muted">
            {t('compare.right')}
          </span>
          <select
            className="input-base w-full"
            value={right}
            onChange={(event) => updatePair(left, event.target.value)}
          >
            <option value="">—</option>
            {tables.map((table) => (
              <option key={table.name} value={table.name}>
                {table.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <button type="button" className="btn btn-primary w-full" onClick={() => void run()}>
            <IconRefresh size={14} />
            {loading ? t('compare.running') : t('compare.run')}
          </button>
        </div>
      </div>

      {error && <p className="text-[12.5px] text-danger">{error}</p>}

      {!left || !right ? (
        <p className="card p-8 text-center text-sm text-muted">{t('compare.selectTwo')}</p>
      ) : left === right ? (
        <p className="card p-8 text-center text-sm text-muted">{t('compare.selectTwo')}</p>
      ) : !result ? (
        <p className="card p-8 text-center text-sm text-muted">…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="card p-4">
              <div className="text-[12px] text-muted">{t('compare.left')}</div>
              <div className="text-2xl font-extrabold tabular-nums">
                {formatNumber(result.counts.leftRows, locale)}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-[12px] text-muted">{t('compare.right')}</div>
              <div className="text-2xl font-extrabold tabular-nums">
                {formatNumber(result.counts.rightRows, locale)}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-[12px] text-muted">{t('compare.changed')}</div>
              <div className="text-2xl font-extrabold tabular-nums text-warn">
                {formatNumber(result.counts.changed, locale)}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-[12px] text-muted">{t('compare.identical')}</div>
              <div className="text-2xl font-extrabold tabular-nums text-success">
                {formatNumber(result.counts.identical, locale)}
              </div>
            </div>
          </div>

          <div className="card space-y-3 p-4 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-semibold text-muted">
                {t('compare.keys')}:
              </span>
              {result.keyPairs.length ? (
                result.keyPairs.map((pair) => (
                  <span key={`${pair.left}-${pair.right}`} className="chip font-mono text-[11px]">
                    {pair.left} → {pair.right}
                  </span>
                ))
              ) : (
                <span className="text-warn">{t('compare.noKey')}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-semibold text-muted">
                {t('compare.commonColumns')}:
              </span>
              {result.commonColumns.map((column) => (
                <span key={column} className="chip text-[11px]">
                  {column}
                </span>
              ))}
            </div>

            {result.onlyLeftColumns.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold text-muted">
                  {t('compare.onlyLeftColumns')}:
                </span>
                {result.onlyLeftColumns.map((column) => (
                  <span key={column} className="chip text-[11px] text-warn">
                    {column}
                  </span>
                ))}
              </div>
            )}

            {result.onlyRightColumns.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold text-muted">
                  {t('compare.onlyRightColumns')}:
                </span>
                {result.onlyRightColumns.map((column) => (
                  <span key={column} className="chip text-[11px] text-danger">
                    {column}
                  </span>
                ))}
              </div>
            )}
          </div>

          {result.truncated && (
            <p className="text-[12px] text-muted">{t('compare.truncated')}</p>
          )}

          <div className="grid gap-3 xl:grid-cols-2">
            <DiffRowTable
              title={`${t('compare.onlyLeft')} — ${result.left}`}
              tone="warn"
              columns={result.leftColumns}
              rows={result.onlyLeftRows}
              emptyLabel="—"
            />
            <DiffRowTable
              title={`${t('compare.onlyRight')} — ${result.right}`}
              tone="danger"
              columns={result.rightColumns}
              rows={result.onlyRightRows}
              emptyLabel="—"
            />
          </div>

          {result.changedRows.length > 0 && (
            <ChangedRowsTable
              title={t('compare.changed')}
              columns={result.leftColumns}
              rows={result.changedRows}
            />
          )}

          <p className="text-[12px] text-muted">
            <Link className="text-accent underline" to="/tables">
              {t('tables.title')}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
