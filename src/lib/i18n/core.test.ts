// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en, ptBR } from "./catalog";
import { LocaleProvider, useTranslations } from "./client";
import { createTranslator, resolveLocale } from "./core";
import { formatDate, formatDecimal, formatNumber } from "./format";

const placeholders = (value: string) =>
  [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort();

function TranslatedText() {
  const t = useTranslations();
  return createElement("p", null, t("auth.signIn"));
}
describe("locale contract", () => {
  it("defaults unsupported and missing preferences to Portuguese", () => {
    expect(resolveLocale(undefined)).toBe("pt-BR");
    expect(resolveLocale("<script>")).toBe("pt-BR");
    expect(resolveLocale("en")).toBe("en");
    expect(createTranslator(resolveLocale(null))("auth.signIn")).toBe("Entrar");
  });
  it("keeps complete catalog and parameter parity", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort());
    for (const key of Object.keys(ptBR) as (keyof typeof ptBR)[]) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/);
      expect(en[key].trim(), key).not.toBe("");
      expect(placeholders(en[key]), key).toEqual(placeholders(ptBR[key]));
    }
  });
  it("keeps simultaneous provider renders and default consumers independent", () => {
    const english = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "en" }, createElement(TranslatedText)),
    );
    const portuguese = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "pt-BR" }, createElement(TranslatedText)),
    );
    expect(english).toBe("<p>Sign in</p>");
    expect(portuguese).toBe("<p>Entrar</p>");
    expect(renderToStaticMarkup(createElement(TranslatedText))).toBe(portuguese);
  });
  it("interpolates content as plain text without treating it as markup", () => {
    const t = createTranslator("en");
    const label = t("pages.moveNamed", { name: "<script>alert(1)</script>" });
    const html = renderToStaticMarkup(createElement("button", { type: "button" }, label));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("formats numbers by locale while preserving civil dates across time zones", () => {
    expect(formatNumber(1234.5, "pt-BR")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    expect(formatDecimal("12345678901234567890.12345", "en")).toBe("12,345,678,901,234,567,890.12345");
    expect(formatDecimal("-0.5", "pt-BR")).toBe("-0,5");
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Los_Angeles",
    };
    expect(formatDate("2026-10-26", "pt-BR", options)).toBe("26/10/2026");
    expect(formatDate("2026-10-26", "en", options)).toBe("10/26/2026");
    expect(formatDate("2026-10-26T00:00:00Z", "en", options)).toBe("10/25/2026");
  });
});
