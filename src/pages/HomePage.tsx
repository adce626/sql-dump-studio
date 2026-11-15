import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/en';
import { useData } from '../store/useData';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import { IconPackage, IconTrash, IconWarning } from '../components/Icons';
import { formatBytes, formatDateTime, formatNumber } from '../lib/format';
import { client, downloadPayload } from '../lib/client';
import type { Dialect } from '../worker/protocol';

const ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'latin1'];
const DIALECTS: Dialect[] = ['mysql', 'postgres', 'mssql', 'sqlite', 'generic'];

/** Formats that are opened directly by the worker. */
const DIRECT_FORMATS = ['.sql', '.sql.gz', '.gz', '.tar', '.tar.gz', '.sqlite', '.sqlite3', '.db', '.txt'];

/** Formats that need a conversion first (the app shows the exact command). */
const CONVERT_FORMATS = ['.dump', '.bak', '.backup', '.ibd', '.frm', '.mdf', '.ldf'];

export function HomePage() {
  const { t, locale } = useI18n();
  const {
    openFile,
    status,
    progress,
    error,
    errorPayload,
    file,
    tables,
    stats,
    warnings,
    sessions,
    restoreSession,
    deleteSession,
  } = useData();
  const navigate = useNavigate();

  const [encoding, setEncoding] = useState<string>('auto');
  const [dialect, setDialect] = useState<string>('auto');
  const [buildIndex, setBuildIndex] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [packaging, setPackaging] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const busy = status === 'loading';

  /** Translates a dynamic key (the format guidance). */
  function tk(key: string): string {
    return t(key as TranslationKey);
  }

  function handleFile(next: File) {
    setPendingFile(next);
    setCopied(false);
    void openFile(next, {
      encoding: encoding === 'auto' ? null : encoding,
      dialect: dialect === 'auto' ? 'auto' : (dialect as Dialect),
      buildSearchIndex: buildIndex,
      onlyTables: null,
    });
  }

  async function handlePackage() {
    setPackaging(true);
    setPackageError(null);
    try {
      const payload = await client.exportZip();
      downloadPayload({ ...payload, rowCount: 0 });
    } catch (err) {
      setPackageError(err instanceof Error ? err.message : String(err));
    } finally {
      setPackaging(false);
    }
  }

  async function copyCommand() {
    if (!errorPayload) return;
    const key = errorPayload.format ?? 'binary';
    const command = tk(`format.${key}.command`);
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold text-text">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-text-soft">{t('home.subtitle')}</p>
      </header>

      {progress && status === 'loading' && <ProgressBar progress={progress} />}

      {error && (
        <div className="card flex items-start gap-3 border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          <IconWarning size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{t('errors.openFailed')}</p>
            {errorPayload ? (
              <>
                <p className="mt-1 text-[13px] font-bold">
                  {tk(`format.${errorPayload.format ?? 'binary'}.title`)}
                </p>
                <p className="mt-0.5 text-[12.5px] opacity-90">
                  {tk(`format.${errorPayload.format ?? 'binary'}.hint`)}
                </p>
                {errorPayload.format !== 'binary' && (
                  <>
                    <p className="mt-3 text-[11px] font-bold uppercase tracking-wide opacity-80">
                      {t('errors.formatCommand')}
                    </p>
                    <pre
                      dir="ltr"
                      className="mt-1 overflow-x-auto rounded-lg border border-danger/30 bg-surface p-3 text-[11.5px] leading-relaxed text-text"
                    >
                      {tk(`format.${errorPayload.format}.command`)}
                    </pre>
                    <button type="button" className="btn btn-ghost mt-2" onClick={() => void copyCommand()}>
                      {copied ? t('errors.formatCopied') : t('errors.formatCopy')}
                    </button>
                  </>
                )}
                {errorPayload.members && errorPayload.members.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12px] font-bold opacity-90">
                      {t('errors.archiveMembers')}
                    </summary>
                    <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[11.5px] opacity-80">
                      {errorPayload.members.slice(0, 30).map((member) => (
                        <li key={member} dir="ltr">
                          {member}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="mt-0.5 text-[12.5px] opacity-90">{error}</p>
            )}
          </div>
        </div>
      )}

      {file && status === 'ready' && (
        <div className="card animate-fade-up p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-lg font-extrabold text-text" dir="auto">
                {file.name}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip">{file.dialect}</span>
                <span className="chip">{file.encoding}</span>
                <span className="chip">{file.mode === 'opfs' ? 'OPFS' : 'RAM'}</span>
                <span className="chip">{formatBytes(file.size)}</span>
                <span className="chip">{formatDateTime(file.importedAt, locale)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" onClick={() => navigate('/tables')}>
                {t('tables.title')}
              </button>
              <button type="button" className="btn" onClick={() => navigate('/editor')}>
                {t('nav.editor')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handlePackage()}
                disabled={packaging}
                title={t('home.packageHint')}
              >
                <IconPackage size={14} />
                {packaging ? t('home.packaging') : t('home.package')}
              </button>
            </div>
          </div>

          {packageError && (
            <p className="mt-3 text-[12.5px] text-danger">{packageError}</p>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t('stats.tables'), value: formatNumber(stats?.tableCount ?? 0, locale) },
              { label: t('stats.views'), value: formatNumber(stats?.viewCount ?? 0, locale) },
              { label: t('stats.rows'), value: formatNumber(stats?.totalRows ?? 0, locale) },
              { label: t('stats.size'), value: formatBytes(stats?.totalBytes ?? 0, locale) },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-surface-2 p-3">
                <dt className="text-[11px] font-semibold text-muted">{item.label}</dt>
                <dd className="mt-1 text-lg font-extrabold text-text">{item.value}</dd>
              </div>
            ))}
          </dl>

          {warnings.length > 0 && (
            <details className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-[12.5px] text-text-soft">
              <summary className="cursor-pointer font-bold text-warn">
                {warnings.length} warning{warnings.length > 1 ? 's' : ''}
              </summary>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {warnings.slice(0, 20).map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-text-soft">{t('home.encoding')}</span>
            <select
              className="input-base"
              value={encoding}
              onChange={(event) => setEncoding(event.target.value)}
            >
              <option value="auto">{t('home.encodingAuto')}</option>
              {ENCODINGS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-text-soft">{t('home.dialect')}</span>
            <select
              className="input-base"
              value={dialect}
              onChange={(event) => setDialect(event.target.value)}
            >
              <option value="auto">{t('home.dialectAuto')}</option>
              {DIALECTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-end gap-2 pb-1 text-[12.5px] text-text-soft">
            <input
              type="checkbox"
              checked={buildIndex}
              onChange={(event) => setBuildIndex(event.target.checked)}
              className="size-4 accent-[var(--c-accent)]"
            />
            <span>{t('home.buildIndex')}</span>
          </label>
        </div>
      </div>

      <DropZone onFile={handleFile} busy={busy} />

      <section className="card p-4">
        <h2 className="text-sm font-extrabold text-text">{t('home.formats')}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t('home.formatsHint')}</p>
        <p className="mt-3 text-[11px] font-bold text-muted">{t('home.directFormats')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DIRECT_FORMATS.map((ext) => (
            <span key={ext} className="chip" dir="ltr">
              {ext}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] font-bold text-muted">{t('home.convertFormats')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 opacity-70">
          {CONVERT_FORMATS.map((ext) => (
            <span key={ext} className="chip" dir="ltr">
              {ext}
            </span>
          ))}
        </div>
      </section>

      {sessions.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-extrabold text-text">{t('home.recent')}</h2>
          <p className="mt-0.5 text-[12px] text-muted">{t('home.recentHint')}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-text" dir="auto">
                    {session.name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-muted">
                    <span className="chip">{session.dialect}</span>
                    <span className="chip">
                      {formatNumber(session.tableCount, locale)} {t('common.table')}
                    </span>
                    <span className="chip">
                      {formatNumber(session.rowCount, locale)} {t('stats.rows')}
                    </span>
                    <span className="chip">{formatBytes(session.size, locale)}</span>
                    <span className="chip">{formatDateTime(session.importedAt, locale)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void restoreSession(session.id)}
                    disabled={busy}
                  >
                    {t('home.restore')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    title={t('home.deleteSession')}
                    aria-label={t('home.deleteSession')}
                    onClick={() => void deleteSession(session.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingFile && status === 'ready' && (
        <p className="text-center text-xs text-muted">
          {formatNumber(tables.length, locale)} {t('common.table')} · {t('home.privacy')}
        </p>
      )}
    </div>
  );
}
