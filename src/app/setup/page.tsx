import { redirect } from "next/navigation";
import Link from "next/link";
import { Brand } from "@/components/icon";
import { getTranslations } from "@/lib/i18n/server";
import { isSetupMode } from "@/lib/setup-mode";

export default async function SetupPage() {
  if (!isSetupMode()) redirect("/");
  const t = await getTranslations();
  return (
    <main id="main" className="setup-page">
      <div className="setup-content">
        <Brand />
        <span className="setup-status">{t("setup.status")}</span>
        <h1>{t("setup.title")}</h1>
        <p>{t("setup.description")}</p>
        <Link href="/">{t("setup.retry")}</Link>
      </div>
    </main>
  );
}
