import Link from "next/link";
import { Brand, Icon } from "@/components/icon";
import { getTranslations } from "@/lib/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link href="/" aria-label={t("navigation.brandStart")}>
          <Brand />
        </Link>
        <div className="auth-statement">
          <div className="paper-symbol">
            <Icon name="layers" size={76} />
          </div>
          <h2>
            {t("auth.yourSpace")}
            <br />
            {t("auth.yourPace")}
          </h2>
          <p>{t("auth.tagline")}</p>
        </div>
        <p className="auth-foot">{t("auth.oneIdea")}</p>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-content">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
