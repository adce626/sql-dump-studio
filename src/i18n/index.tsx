import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ar } from './ar';
import { en, type TranslationKey } from './en';
import { I18nContext, type I18nValue, type Language } from './context';

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { ar, en };

const STORAGE_KEY = 'sds.lang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
    // English is the default; Arabic is opt-in from the language switcher.
    return 'en';
  });

  useEffect(() => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const setLang = useCallback((next: Language) => setLangState(next), []);
  const toggleLang = useCallback(() => setLangState((prev) => (prev === 'ar' ? 'en' : 'ar')), []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      locale: lang === 'ar' ? 'ar-SA' : 'en-US',
      t: (key) => DICTIONARIES[lang][key] ?? en[key] ?? key,
      setLang,
      toggleLang,
    }),
    [lang, setLang, toggleLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
