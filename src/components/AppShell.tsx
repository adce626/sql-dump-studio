import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useShortcuts } from '../hooks/useShortcuts';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ShortcutsHelp } from './ShortcutsHelp';
import {
  IconChart,
  IconCode,
  IconCompare,
  IconHome,
  IconRelations,
  IconSearch,
  IconTable,
} from './Icons';

const MOBILE_ITEMS: {
  to: string;
  key:
    | 'nav.home'
    | 'nav.tables'
    | 'nav.search'
    | 'nav.relations'
    | 'nav.editor'
    | 'nav.compare'
    | 'nav.stats';
  Icon: typeof IconHome;
  end?: boolean;
}[] = [
  { to: '/', key: 'nav.home', Icon: IconHome, end: true },
  { to: '/tables', key: 'nav.tables', Icon: IconTable },
  { to: '/search', key: 'nav.search', Icon: IconSearch },
  { to: '/relations', key: 'nav.relations', Icon: IconRelations },
  { to: '/editor', key: 'nav.editor', Icon: IconCode },
  { to: '/compare', key: 'nav.compare', Icon: IconCompare },
  { to: '/stats', key: 'nav.stats', Icon: IconChart },
];

export function AppShell() {
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  useShortcuts(() => setHelpOpen((open) => !open));

  return (
    <div className="app-bg flex h-full min-h-screen w-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />

        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface/60 px-3 py-2 lg:hidden">
          {MOBILE_ITEMS.map(({ to, key, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={MOBILE_ITEMS.find((item) => item.to === to)?.end}
              className={({ isActive }) =>
                [
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold',
                  isActive ? 'bg-accent-soft text-accent' : 'text-text-soft',
                ].join(' ')
              }
            >
              <Icon size={15} />
              {t(key)}
            </NavLink>
          ))}
        </nav>

        <main className="min-h-0 flex-1 px-4 pb-12 pt-5">
          <Outlet />
        </main>
      </div>

      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
