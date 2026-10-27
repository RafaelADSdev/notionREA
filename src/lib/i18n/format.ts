import type { Locale } from "./core";
export function formatNumber(
  value: number | bigint,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
/** Canonical decimals keep all their digits; formatting never passes them through Number. */
export function formatDecimal(value: string, locale: Locale): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match?.[2]) return value;
  const formatter = new Intl.NumberFormat(locale);
  const grouped = formatter.format(BigInt(match[2]));
  const decimal = formatter.formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  const minus = formatter.formatToParts(-1).find((part) => part.type === "minusSign")?.value ?? "-";
  return `${match[1] ? minus : ""}${grouped}${match[3] ? decimal + match[3] : ""}`;
}
export function formatDate(
  value: string | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const civil = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = civil ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat(locale, civil ? { ...options, timeZone: "UTC" } : options).format(date);
}
