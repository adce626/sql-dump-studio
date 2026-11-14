import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import type { ColumnMeta } from '../worker/protocol';
import { cellClass, hexBytes, valueToText } from '../lib/format';
import {
  imageDownloadUrl,
  imageFileName,
  imageFromValue,
  imageSrc,
  isDataUriImage,
} from '../lib/images';
import { IconClose, IconCode, IconCopy, IconDownload } from './Icons';

interface RowDrawerProps {
  open: boolean;
  columns: string[];
  row: unknown[] | null;
  meta?: ColumnMeta[];
  /** Table name - used to build the INSERT statement. */
  tableName?: string;
  onClose: () => void;
}

export function RowDrawer({ open, columns, row, meta, tableName, onClose }: RowDrawerProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  const payload = JSON.stringify(
    columns.reduce<Record<string, unknown>>((acc, column, index) => {
      acc[column] = row[index] ?? null;
      return acc;
    }, {}),
    (_key, value) => {
      // Binary columns are exported as hex so the copied JSON stays readable.
      if (value instanceof Uint8Array) {
        let hex = '0x';
        for (const byte of value) hex += byte.toString(16).padStart(2, '0');
        return hex;
      }
      return value;
    },
    2,
  );

  const quote = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (value instanceof Uint8Array) return `X'${hexBytes(value)}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  };

  const sqlPayload = tableName
    ? `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${row
        .map(quote)
        .join(', ')});`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-s border-border bg-surface shadow-[var(--shadow-pop)] animate-fade-up">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-bold text-text">{t('table.rowDetails')}</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(payload);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              <IconCopy size={15} />
              {copied ? t('common.copied') : t('table.copyRowJson')}
            </button>
            {sqlPayload && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sqlPayload);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 1500);
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
              >
                <IconCode size={15} />
                {copiedSql ? t('common.copied') : t('table.copyRow')}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label={t('common.close')}>
              <IconClose size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          <dl className="space-y-2">
            {columns.map((column, index) => {
              const value = row[index];
              const isNull = value === null || value === undefined;
              const columnMeta = meta?.find((m) => m.name === column);
              const image = isNull ? null : imageFromValue(value);
              const preview = image ? imageSrc(value, image) : '';
              const size =
                value instanceof Uint8Array
                  ? `${value.length} B`
                  : isDataUriImage(value)
                    ? 'data-URI'
                    : '';
              return (
                <div key={column} className="rounded-xl border border-border bg-surface-2 p-3">
                  <dt className="mb-1 flex items-center gap-2 text-[12px] font-bold text-text-soft">
                    {column}
                    {columnMeta?.isPrimaryKey && <span className="chip">{t('table.pk')}</span>}
                    {columnMeta?.isAutoIncrement && <span className="chip">{t('table.auto')}</span>}
                    <span className="chip mono">{columnMeta?.originalType ?? 'TEXT'}</span>
                    {image && (
                      <span className="chip" title={image.mime}>
                        {image.mime.replace('image/', '').toUpperCase()}
                        {image.width ? ` · ${image.width}×${image.height}` : ''}
                        {size ? ` · ${size}` : ''}
                      </span>
                    )}
                  </dt>
                  {image ? (
                    <dd className="flex flex-col items-start gap-2">
                      <img
                        src={preview}
                        alt={column}
                        className="max-h-40 max-w-full rounded-lg border border-border bg-surface object-contain"
                      />
                      <a
                        className="btn btn-ghost text-[11.5px]"
                        href={imageDownloadUrl(preview, image.mime)}
                        download={imageFileName(column, image)}
                      >
                        <IconDownload size={14} />
                        {t('table.downloadImage')}
                        <span className="rounded bg-surface-3 px-1 text-[10px] font-black">
                          {image.ext.toUpperCase()}
                        </span>
                      </a>
                    </dd>
                  ) : (
                  <dd
                    className={[
                      'mono break-all text-[12.5px]',
                      cellClass(value, columnMeta?.affinity),
                    ].join(' ')}
                    dir="auto"
                  >
                    {isNull ? 'NULL' : valueToText(value)}
                  </dd>
                  )}
                </div>
              );
            })}
          </dl>
        </div>
      </aside>
    </div>
  );
}
