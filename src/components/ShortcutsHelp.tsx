import { useEffect } from 'react';
import { useI18n } from '../i18n/useI18n';
import { NAV_SHORTCUT_LABELS } from '../lib/shortcuts';
import { IconKeyboard } from './Icons';

export interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

interface Row {
  keys: string;
  label: string;
}

export function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rows: Row[] = [
    { keys: '/', label: t('shortcuts.search') },
    { keys: 'Ctrl + K', label: t('shortcuts.search') },
    { keys: '?', label: t('shortcuts.help') },
    { keys: 'Ctrl + Shift + C', label: t('shortcuts.copy') },
    { keys: '↑ / ↓', label: t('shortcuts.nextRow') },
    { keys: 'Esc', label: t('shortcuts.closePanel') },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card w-full max-w-md overflow-hidden p-0"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-text">
            <IconKeyboard size={16} className="text-accent" />
            {t('shortcuts.title')}
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('shortcuts.close')}
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto px-4 py-3">
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <li key={row.keys + row.label} className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-text-soft">{row.label}</span>
                <kbd className="mono shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-text">
                  {row.keys}
                </kbd>
              </li>
            ))}
          </ul>

          <h3 className="mt-4 mb-2 text-[11px] font-black tracking-wide text-muted uppercase">
            {t('shortcuts.pages')}
          </h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {NAV_SHORTCUT_LABELS.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2">
                <kbd className="mono shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-text">
                  {item.key}
                </kbd>
                <span className="truncate text-[12px] text-text-soft" dir="auto">
                  {item.path}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
