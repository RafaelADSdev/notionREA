"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon } from "./icon";
import { saveTheme } from "@/features/auth/actions";

export function ThemeToggle({
  initialTheme = "system",
  scope = "anon",
}: {
  initialTheme?: "system" | "light" | "dark";
  scope?: string;
}) {
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
          ? "Não foi possível salvar o tema. Tentar novamente"
          : `Tema: ${theme === "system" ? "automático" : theme === "light" ? "claro" : "escuro"}. Alterar tema`
      }
      title="Alterar tema"
    >
      <Icon name={theme === "dark" ? "moon" : "sun"} />
    </button>
  );
}
