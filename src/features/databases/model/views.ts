import { z } from "zod";
import { assertJsonBudget, DATABASE_MODEL_LIMITS } from "./limits";
import { parseFilter, type Filter, valueSortKey, compareDecimals, compareText } from "./filters";
import {
  type PropertyDefinition,
  type PropertyValue,
  uuidSchema,
  parsePropertyValue,
  decimalSchema,
  instantSchema,
} from "./properties";

export const viewTypes = ["table", "board", "list", "calendar", "gallery"] as const;
export type ViewType = (typeof viewTypes)[number];
export const sortSchema = z.strictObject({ propertyId: uuidSchema, direction: z.enum(["asc", "desc"]) });
export type DatabaseSort = z.infer<typeof sortSchema>;
const positionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[0-9A-Za-z]+$/);
const viewSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  type: z.enum(viewTypes),
  visibleProperties: z.array(uuidSchema).max(500),
  sorts: z.array(sortSchema).max(10),
  filter: z.unknown().nullable(),
  groupBy: uuidSchema.nullable(),
  datePropertyId: uuidSchema.nullable(),
});
export type DatabaseView = Omit<z.infer<typeof viewSchema>, "filter"> & { filter: Filter | null };
function requireProperty(properties: readonly PropertyDefinition[], id: string): PropertyDefinition {
  const property = properties.find((property) => property.id === id);
  if (!property) throw new Error("Unknown view property");
  return property;
}
export function parseView(input: unknown, properties: readonly PropertyDefinition[]): DatabaseView {
  assertJsonBudget(input, DATABASE_MODEL_LIMITS.viewBytes);
  const view = viewSchema.parse(input);
  for (const id of [...view.visibleProperties, ...view.sorts.map((sort) => sort.propertyId)])
    requireProperty(properties, id);
  if (
    new Set(view.visibleProperties).size !== view.visibleProperties.length ||
    new Set(view.sorts.map((sort) => sort.propertyId)).size !== view.sorts.length
  )
    throw new Error("Duplicate view property");
  if (view.groupBy !== null) {
    const property = requireProperty(properties, view.groupBy);
    const allowed =
      view.type === "board" ? ["select", "checkbox"] : ["select", "multiSelect", "checkbox", "person"];
    if (!allowed.includes(property.type) || view.type === "calendar") throw new Error("Unsupported grouping");
  } else if (view.type === "board") throw new Error("Board requires a singular grouping property");
  if (view.type === "calendar") {
    if (!view.datePropertyId || requireProperty(properties, view.datePropertyId).type !== "date")
      throw new Error("Calendar requires a date property");
  } else if (view.datePropertyId !== null) throw new Error("Unexpected calendar property");
  return { ...view, filter: view.filter === null ? null : parseFilter(view.filter, properties) };
}
export type DatabaseRecord = {
  id: string;
  position: string;
  values: Readonly<Record<string, PropertyValue>>;
};
/** Missing values always sort last; ties use UUID identity, independent of direction. */
export function compareRecords(
  a: DatabaseRecord,
  b: DatabaseRecord,
  properties: readonly PropertyDefinition[],
  sorts: readonly DatabaseSort[],
): number {
  for (const sort of sorts) {
    const property = requireProperty(properties, sort.propertyId);
    const left = valueSortKey(property, a.values[property.id]);
    const right = valueSortKey(property, b.values[property.id]);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
      continue;
    }
    const compared =
      property.type === "number"
        ? compareDecimals(String(left), String(right))
        : compareText(String(left), String(right));
    if (compared) return sort.direction === "asc" ? compared : -compared;
  }
  if (!sorts.length && a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
export const cursorSchema = z.strictObject({
  version: z.literal(1),
  viewId: uuidSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  queryKey: z.string().regex(/^[a-f0-9]{64}$/),
  recordId: uuidSchema,
  position: positionSchema,
  keys: z.array(z.union([z.string().max(32768), z.boolean(), z.null()])).max(10),
});
export type DatabaseCursor = z.infer<typeof cursorSchema>;
export function parseCursor(
  input: unknown,
  context: {
    viewId: string;
    revision: number;
    queryKey: string;
    sorts: readonly DatabaseSort[];
    properties: readonly PropertyDefinition[];
  },
): DatabaseCursor {
  assertJsonBudget(input, DATABASE_MODEL_LIMITS.viewBytes);
  const cursor = cursorSchema.parse(input);
  if (
    cursor.viewId !== context.viewId.toLowerCase() ||
    cursor.revision !== context.revision ||
    cursor.queryKey !== context.queryKey ||
    cursor.keys.length !== context.sorts.length
  )
    throw new Error("Stale or mismatched cursor");
  cursor.keys.forEach((key, index) => {
    const sort = context.sorts[index];
    if (!sort) throw new Error("Invalid cursor key");
    const property = requireProperty(context.properties, sort.propertyId);
    if (key !== null && (property.type === "checkbox" ? typeof key !== "boolean" : typeof key !== "string"))
      throw new Error("Invalid cursor key type");
    if (typeof key !== "string") return;
    if (property.type === "number" && decimalSchema.parse(key) !== key)
      throw new Error("Noncanonical number key");
    if (property.type === "select" && (!/^\d{4}$/.test(key) || Number(key) >= property.config.options.length))
      throw new Error("Invalid option key");
    if (["multiSelect", "person", "relation"].includes(property.type)) {
      const ids = key ? key.split(",") : [];
      if (parsePropertyValue(property, ids)?.toString() !== key) throw new Error("Noncanonical set key");
    }
    if (property.type === "date") {
      const date = parsePropertyValue(
        property,
        property.config.mode === "civil"
          ? { kind: "civil", start: key, end: null }
          : { kind: "instant", start: key, end: null, timeZone: "UTC" },
      );
      if (date === null || typeof date !== "object" || Array.isArray(date) || date.start !== key)
        throw new Error("Noncanonical date key");
    }
    if (["createdTime", "editedTime"].includes(property.type) && instantSchema.parse(key) !== key)
      throw new Error("Noncanonical instant key");
    if (["title", "text", "url"].includes(property.type) && parsePropertyValue(property, key) !== key)
      throw new Error("Noncanonical string key");
  });
  return cursor;
}
/** Hash this canonical descriptor with SHA-256 on the server for cursor.queryKey.
 * It binds temporary filters, sort order and schema-dependent keys without SQL fragments. */
export function serializeDatabaseQuery(
  view: Pick<DatabaseView, "filter" | "sorts" | "groupBy">,
  properties: readonly PropertyDefinition[],
): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => compareText(a, b))
          .map(([key, item]) => [key, stable(item)]),
      );
    return value;
  };
  return JSON.stringify(
    stable({
      filter: view.filter,
      sorts: view.sorts,
      groupBy: view.groupBy,
      properties: [...properties]
        .sort((a, b) => compareText(a.id, b.id))
        .map(({ id, type, config }) => ({ id, type, config })),
    }),
  );
}
