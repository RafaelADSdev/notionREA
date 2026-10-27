import { z } from "zod";
import { assertJsonBudget, DATABASE_MODEL_LIMITS } from "./limits";
import {
  dateValueSchema,
  instantSchema,
  parsePropertyValue,
  type PropertyDefinition,
  type PropertyValue,
  uuidSchema,
} from "./properties";

export const filterOperators = [
  "eq",
  "neq",
  "contains",
  "startsWith",
  "lt",
  "lte",
  "gt",
  "gte",
  "before",
  "after",
  "between",
  "containsAny",
  "containsAll",
  "containsNone",
  "isEmpty",
  "isNotEmpty",
] as const;
export type FilterOperator = (typeof filterOperators)[number];
export type FilterCondition = {
  kind: "condition";
  propertyId: string;
  operator: FilterOperator;
  value?: PropertyValue;
};
export type Filter = FilterCondition | { kind: "and" | "or"; children: Filter[] };
const conditionSchema = z.strictObject({
  kind: z.literal("condition"),
  propertyId: uuidSchema,
  operator: z.enum(filterOperators),
  value: z.unknown().optional(),
});
const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    conditionSchema as z.ZodType<FilterCondition>,
    z.strictObject({ kind: z.enum(["and", "or"]), children: z.array(filterSchema).min(1).max(50) }),
  ]),
);
export function allowedFilterOperators(property: PropertyDefinition): readonly FilterOperator[] {
  const empty: FilterOperator[] = ["isEmpty", "isNotEmpty"];
  switch (property.type) {
    case "title":
    case "text":
    case "url":
      return [...empty, "eq", "neq", "contains", "startsWith"];
    case "number":
      return [...empty, "eq", "neq", "lt", "lte", "gt", "gte"];
    case "date":
    case "createdTime":
    case "editedTime":
      return [...empty, "before", "after", "between"];
    case "select":
      return [...empty, "eq", "neq"];
    case "checkbox":
      return [...empty, "eq"];
    case "multiSelect":
    case "person":
    case "relation":
      return [...empty, "containsAny", "containsAll", "containsNone"];
  }
}
export function parseFilter(input: unknown, properties: readonly PropertyDefinition[]): Filter {
  assertJsonBudget(input, DATABASE_MODEL_LIMITS.viewBytes);
  const stack = [{ node: input, depth: 1 }];
  let conditions = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item || item.depth > DATABASE_MODEL_LIMITS.filterDepth)
      throw new Error("Filter exceeds depth limit");
    const node = item.node as { kind?: unknown; children?: unknown } | null;
    if (node?.kind === "condition") conditions++;
    else if (Array.isArray(node?.children))
      for (const child of node.children) stack.push({ node: child, depth: item.depth + 1 });
    if (conditions > DATABASE_MODEL_LIMITS.filterConditions)
      throw new Error("Filter exceeds condition limit");
  }
  const parsed = filterSchema.parse(input);
  const normalize = (filter: Filter): Filter => {
    if (filter.kind !== "condition") return { ...filter, children: filter.children.map(normalize) };
    const property = properties.find((property) => property.id === filter.propertyId);
    if (!property || !allowedFilterOperators(property).includes(filter.operator))
      throw new Error("Invalid filter property or operator");
    if (filter.operator === "isEmpty" || filter.operator === "isNotEmpty") {
      if (filter.value !== undefined) throw new Error("Unexpected filter operand");
      return filter;
    }
    if (filter.value === null || filter.value === undefined) throw new Error("Missing filter operand");
    let value: PropertyValue;
    if (["title", "text", "url"].includes(property.type))
      value = z
        .string()
        .max(DATABASE_MODEL_LIMITS.textLength)
        .refine((value) => value.isWellFormed())
        .parse(filter.value);
    else if (property.type === "createdTime" || property.type === "editedTime") {
      if (filter.operator === "between") {
        value = dateValueSchema.parse(filter.value);
        if (value.kind !== "instant" || value.end === null) throw new Error("Invalid instant interval");
      } else value = instantSchema.parse(filter.value);
    } else value = parsePropertyValue(property, filter.value);
    if (
      filter.operator === "between" &&
      (typeof value !== "object" || value === null || Array.isArray(value) || value.end === null)
    )
      throw new Error("Missing interval end");
    return { ...filter, value };
  };
  return normalize(parsed);
}

export function isEmptyValue(value: PropertyValue | undefined): boolean {
  return (
    value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)
  );
}
/** Decimal comparison never converts canonical precision to IEEE-754. */
export function compareDecimals(a: string, b: string): number {
  const negativeA = a.startsWith("-");
  const negativeB = b.startsWith("-");
  if (negativeA !== negativeB) return negativeA ? -1 : 1;
  const [wholeA = "0", fractionA = ""] = a.replace(/^-/, "").split(".");
  const [wholeB = "0", fractionB = ""] = b.replace(/^-/, "").split(".");
  const width = Math.max(fractionA.length, fractionB.length);
  const left = `${wholeA}.${fractionA.padEnd(width, "0")}`;
  const right = `${wholeB}.${fractionB.padEnd(width, "0")}`;
  const result = wholeA.length - wholeB.length || (left < right ? -1 : left > right ? 1 : 0);
  return negativeA ? -result : result;
}
/** Unicode scalar ordering matches PostgreSQL COLLATE "C" on UTF-8, independent of UI locale. */
export function compareText(a: string, b: string): number {
  let left = 0;
  let right = 0;
  while (left < a.length && right < b.length) {
    const first = a.codePointAt(left) ?? 0;
    const second = b.codePointAt(right) ?? 0;
    if (first !== second) return first < second ? -1 : 1;
    left += first > 0xffff ? 2 : 1;
    right += second > 0xffff ? 2 : 1;
  }
  return left < a.length ? 1 : right < b.length ? -1 : 0;
}
export function valueSortKey(
  property: PropertyDefinition,
  value: PropertyValue | undefined,
): string | boolean | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return [...value].sort().join(",");
  if (typeof value === "object") return value.start;
  if (property.type === "select")
    return String(property.config.options.findIndex((option) => option.id === value)).padStart(4, "0");
  return value;
}
export function evaluateFilter(
  filter: Filter,
  values: Readonly<Record<string, PropertyValue>>,
  properties: readonly PropertyDefinition[],
): boolean {
  if (filter.kind !== "condition")
    return filter.kind === "and"
      ? filter.children.every((child) => evaluateFilter(child, values, properties))
      : filter.children.some((child) => evaluateFilter(child, values, properties));
  const property = properties.find((property) => property.id === filter.propertyId);
  if (!property) throw new Error("Removed filter property");
  const actual = values[filter.propertyId];
  const expected = filter.value;
  if (filter.operator === "isEmpty") return isEmptyValue(actual);
  if (filter.operator === "isNotEmpty") return !isEmptyValue(actual);
  if (["containsAny", "containsAll", "containsNone"].includes(filter.operator)) {
    const present = new Set(Array.isArray(actual) ? actual : []);
    const wanted = Array.isArray(expected) ? expected : [];
    if (filter.operator === "containsAll") return wanted.every((id) => present.has(id));
    const any = wanted.some((id) => present.has(id));
    return filter.operator === "containsNone" ? !any : any;
  }
  // Negative comparisons exclude absence; only explicit empty predicates include it.
  if (actual === null || actual === undefined || expected === undefined || expected === null) return false;
  const left = valueSortKey(property, actual);
  const right = valueSortKey(property, expected);
  if (left === null || right === null) return false;
  if (filter.operator === "contains") return String(left).includes(String(right));
  if (filter.operator === "startsWith") return String(left).startsWith(String(right));
  if (filter.operator === "between")
    return (
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      expected.end !== null &&
      String(left) >= expected.start &&
      String(left) <= expected.end
    );
  const compare =
    property.type === "number"
      ? compareDecimals(String(left), String(right))
      : compareText(String(left), String(right));
  switch (filter.operator) {
    case "eq":
      return compare === 0;
    case "neq":
      return compare !== 0;
    case "lt":
    case "before":
      return compare < 0;
    case "lte":
      return compare <= 0;
    case "gt":
    case "after":
      return compare > 0;
    case "gte":
      return compare >= 0;
    default:
      return false;
  }
}
