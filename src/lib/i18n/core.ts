import { en, type MessageKey, ptBR } from "./catalog";
export const locales = ["pt-BR", "en"] as const;
export type Locale = (typeof locales)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";
export const LOCALE_COOKIE = "bloco-locale";
export function resolveLocale(value: unknown): Locale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}
export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translator = ((key: MessageKey, values?: TranslationValues) => string) & {
  readonly locale: Locale;
};
export function createTranslator(locale: Locale): Translator {
  return Object.assign(
    (key: MessageKey, values?: TranslationValues) => {
      const message = (locale === "en" ? en[key] : ptBR[key]) ?? ptBR[key];
      return message.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) => {
        const value = values?.[name];
        return typeof value === "number"
          ? new Intl.NumberFormat(locale).format(value)
          : (value ?? placeholder);
      });
    },
    { locale },
  );
}
