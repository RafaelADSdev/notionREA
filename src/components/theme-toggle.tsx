"use client";

import { useEffect, useState, useTransition } from "react";
import { saveTheme } from "@/features/auth/actions";
import { useTranslations } from "@/lib/i18n/client";
import { Icon } from "./icon";

export function ThemeToggle({
  initialTheme = "system",
  scope = "anon",
}: {
  initialTheme?: "system" | "light" | "dark";
  scope?: string;
}) {
  const t = useTranslations();

  const [theme, setTheme] = useState(initialTheme);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (preference.matches ? "dark" : "light") : theme;
    };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [theme]);
  function cycle() {
    const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    startTransition(async () => {
      try {
        await saveTheme(next);
        setError(false);
      } catch {
        setError(true);
      }
    });
  }
  return (
    <button
      data-theme-scope={scope}
      type="button"
      className="icon-button"
      onClick={cycle}
      disabled={pending}
      aria-busy={pending}
      aria-label={
        error
          ? t("theme.saveFailed")
          : t("theme.current", {
              theme:
                theme === "system"
                  ? t("theme.system")
                  : theme === "light"
                    ? t("theme.light")
                    : t("theme.dark"),
            })
      }
      title={t("theme.change")}
    >
      <Icon name={theme === "dark" ? "moon" : "sun"} />
    </button>
  );
}
