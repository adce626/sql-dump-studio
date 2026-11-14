import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { client } from '../lib/client';
import { DataGrid } from '../components/DataGrid';
import { SqlViewer } from '../components/SqlViewer';
import { IconPlay, IconSpark } from '../components/Icons';
import { formatNumber } from '../lib/format';
import { currentWord, formatSql, suggestFor, type SqlSuggestion } from '../lib/sqlformat';
import type { ExecResult } from '../worker/protocol';

export function EditorPage() {
  const { t, locale } = useI18n();
  const { statements, isReady, tables } = useData();
  const [tab, setTab] = useState<'query' | 'statements'>('query');
  const [sql, setSql] = useState('SELECT name, type FROM sqlite_master LIMIT 50;');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SqlSuggestion[]>([]);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const schema = useMemo(
    () => ({
      tables: tables.map((table) => ({
        name: table.name,
        columns: table.columns.map((column) => column.name),
      })),
    }),
    [tables],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, number>();
    for (const statement of statements) {
      map.set(statement.kind, (map.get(statement.kind) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [statements]);

  function refreshSuggestions(value: string, cursor: number) {
    const { word } = currentWord(value, cursor);
    if (!word) {
      setSuggestions([]);
      return;
    }
    const list = suggestFor(value, cursor, schema);
    setSuggestions(list);
    setSuggestIndex(0);
  }

  function acceptSuggestion(suggestion: SqlSuggestion) {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? sql.length;
    const { start } = currentWord(sql, cursor);
    const next = sql.slice(0, start) + suggestion.label + sql.slice(cursor);
    setSql(next);
    setSuggestions([]);
    requestAnimationFrame(() => {
      const position = start + suggestion.label.length;
      textarea?.focus();
      textarea?.setSelectionRange(position, position);
    });
  }

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const output = await client.exec(sql);
      if (output.error) setError(output.error);
      setResult(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold text-text">{t('editor.title')}</h1>
        <p className="mt-1 text-sm text-text-soft">{t('editor.subtitle')}</p>
      </header>

      {!isReady && (
        <div className="card p-6 text-center text-sm text-muted">{t('errors.noDatabase')}</div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-b border-border">
        {(
          [
            ['query', t('editor.customSql')],
            ['statements', `${t('editor.dumpStatements')} (${formatNumber(statements.length, locale)})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              'relative px-3.5 py-2 text-[13px] font-semibold transition',
              tab === id ? 'text-accent' : 'text-muted hover:text-text',
            ].join(' ')}
          >
            {label}
            {tab === id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
          </button>
        ))}
      </div>

      {tab === 'query' && (
        <div className="flex flex-col gap-3">
          <div className="card p-3">
            <textarea
              ref={textareaRef}
              dir="ltr"
              spellCheck={false}
              className="input-base mono min-h-40 w-full resize-y text-start text-[13px]"
              placeholder={t('editor.placeholder')}
              value={sql}
              onChange={(event) => {
                setSql(event.target.value);
                refreshSuggestions(event.target.value, event.target.selectionStart ?? 0);
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
                  event.preventDefault();
                  setSql(formatSql(sql));
                  setSuggestions([]);
                  return;
                }
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void run();
                  return;
                }
                if (suggestions.length > 0) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSuggestIndex((index) => (index + 1) % suggestions.length);
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSuggestIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (event.key === 'Tab' || (event.key === 'Enter' && !event.ctrlKey && !event.metaKey)) {
                    event.preventDefault();
                    acceptSuggestion(suggestions[suggestIndex]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setSuggestions([]);
                    return;
                  }
                }
              }}
            />

            {suggestions.length > 0 && (
              <ul className="qf-panel qf-panel-inline mt-2 p-1">
                {suggestions.slice(0, 12).map((suggestion, index) => (
                  <li key={`${suggestion.kind}-${suggestion.label}-${index}`}>
                    <button
                      type="button"
                      className={['qf-item w-full', index === suggestIndex ? 'on' : ''].join(' ')}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        acceptSuggestion(suggestion);
                      }}
                    >
                      <span className="mono truncate">{suggestion.label}</span>
                      <span className="ms-auto flex items-center gap-2">
                        {suggestion.detail && (
                          <span className="text-[10.5px] text-muted">{suggestion.detail}</span>
                        )}
                        <span className="chip">{suggestion.kind}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={running}>
                <IconPlay size={15} />
                {running ? t('editor.running') : t('editor.run')}
              </button>
              <button type="button" className="btn" onClick={() => setSql('')}>
                {t('editor.clear')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSql(formatSql(sql));
                  setSuggestions([]);
                }}
                title={t('editor.formatHint')}
              >
                <IconSpark size={14} />
                {t('editor.format')}
              </button>
              <span className="text-[11.5px] text-muted">Ctrl + Enter</span>
              <span className="text-[11.5px] text-muted">Ctrl + Shift + F</span>
            </div>
          </div>

          {error && (
            <div className="card border-danger/40 bg-danger/10 p-3">
              <p className="text-[12px] font-bold text-danger">{t('editor.error')}</p>
              <pre className="mono mt-1 whitespace-pre-wrap text-[12px] text-text" dir="ltr">
                {error}
              </pre>
            </div>
          )}

          {result && !error && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-soft">
                <span>
                  {formatNumber(result.rowCount, locale)} {t('editor.rows')}
                </span>
                <span>
                  {t('editor.duration')}: {formatNumber(result.durationMs, locale)} ms
                </span>
              </div>
              {result.columns.length === 0 || result.rowCount === 0 ? (
                <div className="card p-6 text-center text-sm text-muted">{t('editor.noResult')}</div>
              ) : (
                <div className="h-[50vh]">
                  <DataGrid columns={result.columns} rows={result.rows} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'statements' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {grouped.map(([kind, count]) => (
              <span key={kind} className="chip">
                {kind} · {formatNumber(count, locale)}
              </span>
            ))}
          </div>

          {statements.length === 0 ? (
            <div className="card p-8 text-center text-sm text-muted">{t('common.empty')}</div>
          ) : (
            <div className="card divide-y divide-border overflow-hidden">
              {statements.map((statement) => (
                <div key={statement.index}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-surface-2"
                    onClick={() => setExpanded(expanded === statement.index ? null : statement.index)}
                  >
                    <span className="chip mono">{statement.kind}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-text" dir="ltr">
                      {statement.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">L{statement.line}</span>
                  </button>
                  {expanded === statement.index && (
                    <div className="border-t border-border bg-surface-2/50">
                      <SqlViewer code={statement.text} maxHeight="420px" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
