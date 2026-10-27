import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleProvider } from "@/lib/i18n/client";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";
import { isSetupMode } from "@/lib/setup-mode";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: { default: "Bloco", template: "%s · Bloco" }, description: t("app.description") };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  const setup = isSetupMode();
  const user = setup ? null : await currentUser();
  const scope = user?.id ?? "anon";
  const saved = (await cookies()).get(`bloco-theme-${scope}`)?.value;
  const theme = saved === "light" || saved === "dark" ? saved : "system";
  return (
    <html lang={t.locale} data-theme={theme} suppressHydrationWarning>
      <body>
        <LocaleProvider locale={t.locale}>
          <a className="skip-link" href="#main">
            {t("common.skipContent")}
          </a>
          {children}
          {!setup && (
            <div className="theme-control">
              <ThemeToggle key={scope} initialTheme={theme} scope={scope} />
            </div>
          )}
          {!setup && <LanguageToggle />}
        </LocaleProvider>
      </body>
    </html>
  );
}
