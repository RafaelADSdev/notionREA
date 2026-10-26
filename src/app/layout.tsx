import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Bloco", template: "%s · Bloco" },
  description: "Um espaço próprio para organizar ideias e trabalhar em conjunto.",
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const scope = user?.id ?? "anon";
  const saved = (await cookies()).get(`bloco-theme-${scope}`)?.value;
  const theme = saved === "light" || saved === "dark" ? saved : "system";
  return (
    <html lang="pt-BR" data-theme={theme} suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main">
          Ir para o conteúdo
        </a>
        {children}
        <div className="theme-control">
          <ThemeToggle key={scope} initialTheme={theme} scope={scope} />
        </div>
      </body>
    </html>
  );
}
