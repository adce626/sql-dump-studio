import { NavLink } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useData } from '../store/useData';
import { formatBytes, formatNumber } from '../lib/format';
import {
  IconChart,
  IconCode,
  IconCompare,
  IconDatabase,
  IconHome,
  IconRelations,
  IconSearch,
  IconTable,
} from './Icons';

const ITEMS: { to: string; key: 'nav.home' | 'nav.tables' | 'nav.search' | 'nav.relations' | 'nav.editor' | 'nav.stats' | 'nav.compare'; Icon: typeof IconHome; end?: boolean }[] = [
  { to: '/', key: 'nav.home', Icon: IconHome, end: true },
  { to: '/tables', key: 'nav.tables', Icon: IconTable },
  { to: '/search', key: 'nav.search', Icon: IconSearch },
  { to: '/relations', key: 'nav.relations', Icon: IconRelations },
  { to: '/editor', key: 'nav.editor', Icon: IconCode },
  { to: '/compare', key: 'nav.compare', Icon: IconCompare },
  { to: '/stats', key: 'nav.stats', Icon: IconChart },
];

export function Sidebar() {
  const { t } = useI18n();
  const { file, tables, stats } = useData();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-e border-border bg-surface/80 backdrop-blur lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
          <IconDatabase size={19} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-text">{t('app.name')}</p>
          <p className="truncate text-[11px] text-muted">{t('app.tagline')}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {ITEMS.map(({ to, key, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-semibold transition',
                isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-soft hover:bg-surface-2 hover:text-text',
              ].join(' ')
            }
          >
            <Icon size={17} />
            <span>{t(key)}</span>
          </NavLink>
        ))}
      </nav>

      {file && (
        <div className="m-3 rounded-xl border border-border bg-surface-2 p-3">
          <p className="mb-1 truncate text-[12px] font-bold text-text" title={file.name}>
            {file.name}
          </p>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted">
            <span className="chip">{file.dialect}</span>
            <span className="chip">{file.encoding}</span>
            <span className="chip">{file.mode === 'opfs' ? 'OPFS' : 'RAM'}</span>
          </div>
          <dl className="mt-2.5 space-y-1 text-[11px] text-text-soft">
            <div className="flex justify-between">
              <dt>{t('stats.tables')}</dt>
              <dd className="font-bold">{formatNumber(tables.length)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('stats.rows')}</dt>
              <dd className="font-bold">{formatNumber(stats?.totalRows ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('stats.size')}</dt>
              <dd className="font-bold">{formatBytes(stats?.totalBytes ?? 0)}</dd>
            </div>
          </dl>
        </div>
      )}
    </aside>
  );
}
