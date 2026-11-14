import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/useTheme';
import { useData } from '../store/useData';
import { IconDatabase, IconGlobe, IconMoon, IconSearch, IconSun } from './Icons';

export function TopBar() {
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { file } = useData();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/85 px-4 py-3 backdrop-blur">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-white lg:hidden">
        <IconDatabase size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-text">
          {file ? file.name : t('app.name')}
        </p>
        <p className="truncate text-[11px] text-muted">{t('app.tagline')}</p>
      </div>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => navigate('/search')}
        title={t('nav.search')}
      >
        <IconSearch size={16} />
        <span className="hidden sm:inline">{t('nav.search')}</span>
      </button>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={toggleLang}
        title={t('lang.toggle')}
        aria-label={t('lang.toggle')}
      >
        <IconGlobe size={16} />
        <span className="text-xs font-bold uppercase">{lang === 'ar' ? 'EN' : 'ع'}</span>
      </button>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={toggleTheme}
        title={t('theme.toggle')}
        aria-label={t('theme.toggle')}
      >
        {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
      </button>
    </header>
  );
}
