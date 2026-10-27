import { createTranslator, DEFAULT_LOCALE, type Translator } from "@/lib/i18n/core";
export function contentToneLabels(t: Translator = createTranslator(DEFAULT_LOCALE)) {
  return {
    default: t("colors.default"),
    indigo: t("colors.indigo"),
    copper: t("colors.copper"),
    green: t("colors.green"),
    red: t("colors.red"),
    yellow: t("colors.yellow"),
  };
}
export const CONTENT_TONE_LABELS = contentToneLabels();
