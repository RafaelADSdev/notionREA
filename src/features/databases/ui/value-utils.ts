import type { MessageKey } from "@/lib/i18n/catalog";
import { createTranslator, DEFAULT_LOCALE, type Translator } from "@/lib/i18n/core";
import { formatDate, formatDecimal } from "@/lib/i18n/format";
import type { DateValue, PropertyDefinition, PropertyValue, ViewType } from "../model";
import type { DatabaseData, DatabaseRow } from "../types";

const propertyKeys: Record<PropertyDefinition["type"], MessageKey> = {
  title: "database.titleType",
  text: "editor.text",
  number: "database.numberType",
  select: "database.selectType",
  multiSelect: "database.multiSelectType",
  date: "database.dateType",
  checkbox: "database.checkboxType",
  url: "database.urlType",
  person: "common.person",
  relation: "database.relationType",
  createdTime: "database.createdType",
  editedTime: "database.editedType",
};
const viewKeys: Record<ViewType, MessageKey> = {
  table: "database.tableView",
  board: "database.boardView",
  list: "database.listView",
  calendar: "database.calendarView",
  gallery: "database.galleryView",
};
export function propertyLabels(t: Translator): Record<PropertyDefinition["type"], string> {
  return Object.fromEntries(Object.entries(propertyKeys).map(([type, key]) => [type, t(key)])) as Record<
    PropertyDefinition["type"],
    string
  >;
}
export function viewLabels(t: Translator): Record<ViewType, string> {
  return Object.fromEntries(Object.entries(viewKeys).map(([type, key]) => [type, t(key)])) as Record<
    ViewType,
    string
  >;
}
export function rowValue(row: DatabaseRow, property: PropertyDefinition): PropertyValue {
  if (property.type === "title") return row.title;
  if (property.type === "createdTime") return row.createdAt;
  if (property.type === "editedTime") return row.editedAt;
  return row.values[property.id] ?? (property.type === "checkbox" ? false : null);
}
function parts(instant: string, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
}
export function calendarDay(value: DateValue): string {
  if (value.kind === "civil") return value.start;
  const local = parts(value.start, value.timeZone);
  return `${local.year}-${local.month}-${local.day}`;
}
export function addCivilDays(day: string, count: number): string {
  const instant = new Date(`${day}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + count);
  return instant.toISOString().slice(0, 10);
}
function shiftedInstant(instant: string, timeZone: string, days: number): string {
  const local = parts(instant, timeZone);
  const day = addCivilDays(`${local.year}-${local.month}-${local.day}`, days);
  const wall = `${day}T${local.hour}:${local.minute}:${local.second}`;
  const milliseconds = new Date(instant).getUTCMilliseconds();
  const desired = Date.parse(`${wall}Z`) + milliseconds;
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const check = parts(new Date(candidate).toISOString(), timeZone);
    const represented =
      Date.parse(`${check.year}-${check.month}-${check.day}T${check.hour}:${check.minute}:${check.second}Z`) +
      milliseconds;
    if (represented === desired) return new Date(candidate).toISOString();
    candidate += desired - represented;
  }
  throw new Error("This local time is unavailable on the selected day");
}
export function moveDateToDay(value: DateValue, day: string): DateValue {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
    throw new Error("Invalid civil day");
  const days = Math.round(
    (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${calendarDay(value)}T12:00:00Z`)) / 86400000,
  );
  return value.kind === "civil"
    ? { kind: "civil", start: day, end: value.end ? addCivilDays(value.end, days) : null }
    : {
        ...value,
        start: shiftedInstant(value.start, value.timeZone, days),
        end: value.end ? shiftedInstant(value.end, value.timeZone, days) : null,
      };
}
export function displayValue(
  property: PropertyDefinition,
  value: PropertyValue,
  data: Pick<DatabaseData, "people" | "references">,
  t: Translator = createTranslator(DEFAULT_LOCALE),
): string {
  if (value === null) return t("database.noValue");
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (Array.isArray(value)) {
    const choices =
      property.type === "multiSelect"
        ? property.config.options
        : property.type === "person"
          ? data.people
          : data.references;
    return (
      value
        .map((id) => {
          const choice = choices.find((item) => item.id === id);
          return choice
            ? "label" in choice
              ? choice.label
              : t("editor.referenceUnavailable")
            : t("editor.referenceUnavailable");
        })
        .join(", ") || t("database.noValue")
    );
  }
  if (typeof value === "object") {
    const format = (instant: string) =>
      value.kind === "civil"
        ? formatDate(instant, t.locale, { dateStyle: "short" })
        : new Intl.DateTimeFormat(t.locale, {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: value.timeZone,
          }).format(new Date(instant));
    return `${format(value.start)}${value.end ? ` – ${format(value.end)}` : ""}${value.kind === "instant" ? ` · ${value.timeZone}` : ""}`;
  }
  if (property.type === "select")
    return (
      property.config.options.find((option) => option.id === value)?.label ?? t("database.optionUnavailable")
    );
  if (property.type === "createdTime" || property.type === "editedTime")
    return new Intl.DateTimeFormat(t.locale, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(value),
    );
  if (property.type === "number") return formatDecimal(value, t.locale);
  return value === "" ? t("database.emptyValue") : value;
}
