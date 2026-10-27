import type { DateValue, PropertyDefinition, PropertyValue, ViewType } from "../model";
import type { DatabaseData, DatabaseRow } from "../types";

export const PROPERTY_LABELS: Record<PropertyDefinition["type"], string> = {
  title: "Título",
  text: "Texto",
  number: "Número",
  select: "Seleção",
  multiSelect: "Seleção múltipla",
  date: "Data",
  checkbox: "Checkbox",
  url: "URL",
  person: "Pessoa",
  relation: "Relação",
  createdTime: "Criado em",
  editedTime: "Editado em",
};
export const VIEW_LABELS: Record<ViewType, string> = {
  table: "Tabela",
  board: "Board",
  list: "Lista",
  calendar: "Calendário",
  gallery: "Galeria",
};
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
): string {
  if (value === null) return "Sem valor";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
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
              : "Referência indisponível"
            : "Referência indisponível";
        })
        .join(", ") || "Sem valor"
    );
  }
  if (typeof value === "object") {
    const format = (instant: string) =>
      value.kind === "civil"
        ? instant.split("-").reverse().join("/")
        : new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: value.timeZone,
          }).format(new Date(instant));
    return `${format(value.start)}${value.end ? ` – ${format(value.end)}` : ""}${value.kind === "instant" ? ` · ${value.timeZone}` : ""}`;
  }
  if (property.type === "select")
    return property.config.options.find((option) => option.id === value)?.label ?? "Opção indisponível";
  if (property.type === "createdTime" || property.type === "editedTime")
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
      new Date(value),
    );
  return value === "" ? "Vazio" : value;
}
