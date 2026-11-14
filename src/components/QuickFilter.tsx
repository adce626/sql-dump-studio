import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconFilter } from './Icons';

export interface QuickFilterLabels {
  title?: string;
  all?: string;
  nullValue?: string;
  empty?: string;
  loading?: string;
  close?: string;
  apply?: string;
}

export interface QuickFilterProps {
  /** Element the panel is anchored to. */
  anchor: HTMLElement | null;
  column: string;
  values: { value: string | null; count: number }[];
  loading?: boolean;
  /** Currently applied value for this column (null = no filter). */
  activeValue?: string | null;
  onSelect: (value: string | null) => void;
  onClose: () => void;
  labels?: QuickFilterLabels;
}

const PANEL_WIDTH = 260;

/**
 * A small popover that lists the most frequent values of a column so a filter
 * can be applied without typing. Rendered in a portal to escape the grid's
 * scroll container.
 */
export function QuickFilter({
  anchor,
  column,
  values,
  loading,
  activeValue,
  onSelect,
  onClose,
  labels,
}: QuickFilterProps) {
  const [term, setTerm] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const height = Math.min(340, 120 + values.length * 26);
    const top = spaceBelow > height + 12 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
    let left = rect.left;
    if (left + PANEL_WIDTH > window.innerWidth - 8) left = window.innerWidth - PANEL_WIDTH - 8;
    if (left < 8) left = 8;
    setPosition({ top, left });
  }, [anchor, values.length]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor, onClose]);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return values;
    return values.filter((entry) =>
      entry.value === null ? false : entry.value.toLowerCase().includes(needle),
    );
  }, [values, term]);

  if (!anchor) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="qf-panel"
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label={labels?.title ?? `Filter ${column}`}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconFilter size={13} className="text-accent" />
        <span className="truncate text-[12.5px] font-bold text-text" dir="auto">
          {column}
        </span>
      </div>

      <div className="border-b border-border p-2">
        <input
          autoFocus
          className="input-base w-full py-1 text-[12px]"
          placeholder={labels?.title ?? 'Search values…'}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <div className="overflow-y-auto">
        <button
          type="button"
          className={`qf-item ${activeValue === null || activeValue === undefined ? 'on' : ''}`}
          onClick={() => {
            onSelect(null);
            onClose();
          }}
        >
          <span className="truncate">{labels?.all ?? 'All values'}</span>
        </button>

        {loading && (
          <p className="px-3 py-2 text-[12px] text-muted">
            {labels?.loading ?? 'Loading…'}
          </p>
        )}

        {!loading &&
          filtered.map((entry) => {
            const isActive = activeValue === entry.value;
            return (
              <button
                key={entry.value ?? '__null__'}
                type="button"
                className={`qf-item ${isActive ? 'on' : ''}`}
                onClick={() => {
                  onSelect(entry.value);
                  onClose();
                }}
              >
                <span className="truncate" dir="auto">
                  {entry.value === null ? (labels?.nullValue ?? 'NULL') : entry.value}
                </span>
                <span className="qf-count">{entry.count}</span>
              </button>
            );
          })}

        {!loading && !filtered.length && (
          <p className="px-3 py-2 text-[12px] text-muted">
            {labels?.empty ?? 'No values'}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
