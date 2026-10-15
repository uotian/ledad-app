'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  languageChanged,
  languageStorageKey,
  locales,
  parseLanguage,
  translate,
  type AppLanguage,
} from '@/lib/i18n';
const LanguageContext = createContext({
  language: 'ja' as AppLanguage,
  locale: 'ja-JP' as string,
  setLanguage: (() => {}) as (language: AppLanguage) => void,
  t: (key: string, values?: Record<string, string | number>) => translate('ja', key, values),
});
export function useI18n() {
  return useContext(LanguageContext);
}
export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, updateLanguage] = useState<AppLanguage>('ja');
  useEffect(() => {
    const sync = () => {
      try {
        updateLanguage(parseLanguage(localStorage.getItem(languageStorageKey)));
      } catch {
        /* Keep Japanese when storage is unavailable. */
      }
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(languageChanged, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(languageChanged, sync);
    };
  }, []);
  const setLanguage = useCallback((next: AppLanguage) => {
    try {
      localStorage.setItem(languageStorageKey, next);
    } catch {
      /* Apply for this window even when persistence is unavailable. */
    }
    updateLanguage(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locales[language];
    document.title = translate(language, 'ledad — あなたの言葉を、あなたのペースで。');
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      locale: locales[language],
      setLanguage,
      t: (key: string, values?: Record<string, string | number>) =>
        translate(language, key, values),
    }),
    [language, setLanguage],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
