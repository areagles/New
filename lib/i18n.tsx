'use client';

/**
 * Translation and direction, driven by the dictionaries recovered from the old build so the
 * wording stays identical to what people already read on screen.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import addedAr from '@/locales/added.ar.json';
import addedEn from '@/locales/added.en.json';

export type Lang = 'ar' | 'en';

/**
 * The recovered dictionaries are left exactly as they came out of the old build, so it stays
 * obvious which wording is the system's own. The few strings this rebuild genuinely needed and
 * could not find there live in `added.*` and are layered on top.
 */
const DICTS: Record<Lang, Record<string, string>> = {
  ar: { ...ar, ...addedAr },
  en: { ...en, ...addedEn },
};
const LANG_KEY = 'ae.lang';

/** Values substituted into `{name}` placeholders carried by the strings themselves. */
type Vars = Record<string, string | number>;

type Ctx = {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (lang: Lang) => void;
  /** Returns the key itself when a string is missing, so gaps are visible rather than blank. */
  t: (key: string, fallbackOrVars?: string | Vars, vars?: Vars) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');

  useEffect(() => {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (stored === 'ar' || stored === 'en') setLangState(stored);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(LANG_KEY, next);
  }, []);

  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const t = useCallback(
    (key: string, fallbackOrVars?: string | Vars, vars?: Vars) => {
      const fallback = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined;
      const values = typeof fallbackOrVars === 'string' ? vars : fallbackOrVars;
      const text = DICTS[lang][key] ?? fallback ?? key;
      // Several strings carry their own placeholders — "{n} يحتاج انتباهك", "متأخر {days} يوم".
      // An unmatched one is left as written rather than blanked, so the gap is visible.
      return values
        ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole))
        : text;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, dir, setLang, t }), [lang, dir, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
