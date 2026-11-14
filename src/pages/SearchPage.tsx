import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { client } from '../lib/client';
import { IconSearch } from '../components/Icons';
import { valueToText } from '../lib/format';
import { EV_FOCUS_SEARCH } from '../lib/shortcuts';
import type { SearchResult } from '../worker/protocol';

function Snippet({ text }: { text: string }) {
  const parts = useMemo(() => {
    const raw = text.split(/(«|»)/);
    const out: { text: string; highlight: boolean }[] = [];
    let highlight = false;
    for (const part of raw) {
      if (part === '«') {
        highlight = true;
        continue;
      }
      if (part === '»') {
        highlight = false;
        continue;
      }
      if (!part) continue;
      out.push({ text: part, highlight });
    }
    return out;
  }, [text]);

  return (
    <p className="mono text-[12px] leading-6 text-text-soft" dir="auto">
      {parts.map((part, index) =>
        part.highlight ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function SearchPage() {
  const { t } = useI18n();
  const { tables, isReady } = useData();
  const [term, setTerm] = useState('');
  const [scope, setScope] = useState<string>('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The `/` shortcut jumps here and asks the page to focus its input.
  useEffect(() => {
    function onFocusRequest() {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener(EV_FOCUS_SEARCH, onFocusRequest);
    return () => window.removeEventListener(EV_FOCUS_SEARCH, onFocusRequest);
  }, []);

  useEffect(() => {
    const trimmed = term.trim();
    if (!trimmed) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const found = await client.search(trimmed, scope || null, 200);
        if (!cancelled) setResult(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, scope]);

  return (
    <div className="flex flex-col gap-4">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold text-text">{t('search.title')}</h1>
        <p className="mt-1 text-sm text-text-soft">{t('search.subtitle')}</p>
      </header>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-64 flex-1">
          <IconSearch
            size={15}
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted start-3"
          />
          <input
            ref={inputRef}
            className="input-base w-full ps-9"
            placeholder={t('search.placeholder')}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            disabled={!isReady}
          />
        </div>
        <select
          className="input-base"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          disabled={!isReady}
        >
          <option value="">{t('search.inTable')}</option>
          {tables.map((table) => (
            <option key={table.name} value={table.name}>
              {table.name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="card border-danger/40 bg-danger/10 p-3 text-[13px] text-danger">{error}</div>}

      {loading && <p className="text-xs text-muted">{t('common.loading')}</p>}

      {result && (
        <p className="text-[12.5px] text-text-soft">
          {result.hits.length} {t('search.results')}
          {result.truncated ? ` · ${t('search.truncated')}` : ''}
        </p>
      )}

      {result && result.hits.length === 0 && (
        <div className="card p-10 text-center text-sm text-muted">{t('search.noResults')}</div>
      )}

      <div className="flex flex-col gap-2">
        {result?.hits.map((hit, index) => (
          <div key={`${hit.table}-${hit.rowid}-${index}`} className="card p-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <Link
                to={`/tables/${encodeURIComponent(hit.table)}`}
                className="text-[13px] font-bold text-accent hover:underline"
                dir="auto"
              >
                {hit.table}
              </Link>
              <Link
                to={`/tables/${encodeURIComponent(hit.table)}`}
                className="text-[11.5px] font-semibold text-muted hover:text-accent"
              >
                {t('search.openRow')} →
              </Link>
            </div>
            {hit.snippet && <Snippet text={hit.snippet} />}
            <dl className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(hit.values).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-surface-2 px-2 py-1 text-[11px]">
                  <span className="text-muted">{key}:</span>{' '}
                  <span className="mono text-text" dir="auto">
                    {value === null ? 'NULL' : valueToText(value).slice(0, 60)}
                  </span>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
