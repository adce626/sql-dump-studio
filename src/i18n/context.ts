import { createContext } from 'react';
import type { TranslationKey } from './en';

export type Language = 'ar' | 'en';

export interface I18nValue {
  lang: Language;
  dir: 'rtl' | 'ltr';
  locale: string;
  t: (key: TranslationKey) => string;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
}

export const I18nContext = createContext<I18nValue | null>(null);
