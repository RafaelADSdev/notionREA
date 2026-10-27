"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setLocale } from "@/lib/i18n/actions";
import { useLocale, useTranslations } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/core";
export function LanguageToggle() {
  const locale = useLocale();
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <div style={{ position: "fixed", right: 76, bottom: 18, zIndex: 10, maxWidth: "calc(100vw - 100px)" }}>
      <select
        aria-label={t("common.language")}
        aria-busy={pending}
        disabled={pending}
        value={locale}
        style={{ width: 128, minHeight: 44, fontSize: 13, boxShadow: "var(--shadow)" }}
        onChange={(event) => {
          const next = event.currentTarget.value as Locale;
          start(async () => {
            try {
              await setLocale(next);
              setError(false);
              router.refresh();
            } catch {
              setError(true);
            }
          });
        }}
      >
        <option value="pt-BR">Português</option>
        <option value="en">English</option>
      </select>
      {error && (
        <p role="alert" className="form-feedback error">
          {t("common.languageChangeFailed")}
        </p>
      )}
    </div>
  );
}
