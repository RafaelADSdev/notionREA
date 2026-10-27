import Link from "next/link";
import { getTranslations } from "@/lib/i18n/server";
export default async function NotFound() {
  const t = await getTranslations();

  return (
    <main id="main" className="workspace-main">
      <h1>{t("errors.unavailable")}</h1>
      <p className="notice">{t("errors.addressOrAccess")}</p>
      <Link className="button" href="/" style={{ marginTop: 24 }}>
        {t("common.backHome")}
      </Link>
    </main>
  );
}
