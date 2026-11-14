import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { client } from '../lib/client';
import { ErDiagram } from '../components/ErDiagram';
import type { RelationEdge } from '../worker/protocol';

export function RelationsPage() {
  const { t } = useI18n();
  const { tables, isReady } = useData();
  const [edges, setEdges] = useState<RelationEdge[]>([]);
  const [showDeclared, setShowDeclared] = useState(true);
  const [showInferred, setShowInferred] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!isReady) return;
    client
      .relations()
      .then((result) => {
        if (!cancelled) setEdges(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isReady, tables]);

  if (!isReady) {
    return <div className="card p-10 text-center text-sm text-muted">{t('errors.noDatabase')}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-extrabold text-text">{t('relations.title')}</h1>
          <p className="mt-1 text-sm text-text-soft">{t('relations.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[12.5px] text-text-soft">
            <input
              type="checkbox"
              checked={showDeclared}
              onChange={(event) => setShowDeclared(event.target.checked)}
              className="size-4 accent-[var(--c-accent)]"
            />
            {t('relations.showDeclared')}
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-text-soft">
            <input
              type="checkbox"
              checked={showInferred}
              onChange={(event) => setShowInferred(event.target.checked)}
              className="size-4 accent-[var(--c-accent)]"
            />
            {t('relations.showInferred')}
          </label>
        </div>
      </header>

      {edges.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">{t('relations.noRelations')}</div>
      ) : (
        <>
          <ErDiagram
            tables={tables}
            edges={edges}
            showDeclared={showDeclared}
            showInferred={showInferred}
          />

          <div className="card overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-start font-bold">{t('common.table')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('relations.columns')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('table.references')}</th>
                  <th className="px-3 py-2 text-start font-bold">{t('common.type')}</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((edge) => (
                  <tr key={edge.id} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      <Link
                        to={`/tables/${encodeURIComponent(edge.fromTable)}`}
                        className="font-semibold text-accent hover:underline"
                        dir="auto"
                      >
                        {edge.fromTable}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {edge.fromColumns.map((column) => (
                          <span key={column} className="chip mono">
                            {column}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/tables/${encodeURIComponent(edge.toTable)}`}
                        className="text-accent hover:underline"
                        dir="auto"
                      >
                        {edge.toTable}
                      </Link>
                      <span className="ms-1 text-muted">({edge.toColumns.join(', ')})</span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={[
                          'chip',
                          edge.source === 'declared' ? 'text-accent' : 'text-muted',
                        ].join(' ')}
                      >
                        {edge.source === 'declared' ? t('relations.declared') : t('relations.inferred')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
