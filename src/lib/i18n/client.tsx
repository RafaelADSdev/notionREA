"use client";
import { createContext, useContext, useMemo } from "react";
import { createTranslator, DEFAULT_LOCALE, type Locale } from "./core";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);
export function LocaleProvider({ locale, children }: { locale: Locale; children?: React.ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}
export function useLocale(): Locale {
  return useContext(LocaleContext);
}
export function useTranslations() {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
