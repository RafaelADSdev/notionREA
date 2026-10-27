"use client";
import { useTranslations } from "@/lib/i18n/client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations();

  return (
    <main id="main" className="workspace-main">
      <h1>{t("errors.openFailed")}</h1>
      <p className="notice">{t("errors.tryAgainNotice")}</p>
      <button type="button" className="button" onClick={reset} style={{ marginTop: 24 }}>
        {t("common.tryAgain")}
      </button>
    </main>
  );
}
