import { getTranslations } from "@/lib/i18n/server";
export default async function Loading() {
  const t = await getTranslations();

  return (
    <main id="main" className="loading-sheet" role="status">
      {t("app.opening")}
    </main>
  );
}
