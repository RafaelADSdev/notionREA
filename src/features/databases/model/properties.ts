import { z } from "zod";
import { assertJsonBudget, DATABASE_MODEL_LIMITS } from "./limits";

export const propertyTypes = [
  "title",
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "checkbox",
  "url",
  "person",
  "relation",
  "createdTime",
  "editedTime",
] as const;
export type PropertyType = (typeof propertyTypes)[number];
export const optionColors = ["default", "indigo", "copper", "green", "red", "yellow"] as const;
export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
const text = z.string().refine((value) => value.isWellFormed(), "Invalid Unicode text");
const label = text.trim().min(1).max(120);
const empty = z.strictObject({});
export const optionSchema = z.strictObject({
  id: uuidSchema,
  label,
  color: z.enum(optionColors),
});
export type DatabaseOption = z.infer<typeof optionSchema>;
const optionConfig = z.strictObject({
  options: z
    .array(optionSchema)
    .max(500)
    .refine(
      (options) => new Set(options.map((option) => option.id)).size === options.length,
      "Duplicate option",
    ),
});
const common = { id: uuidSchema, name: label };
export const propertyDefinitionSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("title"), config: empty }),
  z.strictObject({ ...common, type: z.literal("text"), config: empty }),
  z.strictObject({ ...common, type: z.literal("number"), config: empty }),
  z.strictObject({ ...common, type: z.literal("select"), config: optionConfig }),
  z.strictObject({ ...common, type: z.literal("multiSelect"), config: optionConfig }),
  z.strictObject({
    ...common,
    type: z.literal("date"),
    config: z.strictObject({ mode: z.enum(["civil", "instant"]) }),
  }),
  z.strictObject({ ...common, type: z.literal("checkbox"), config: empty }),
  z.strictObject({ ...common, type: z.literal("url"), config: empty }),
  z.strictObject({ ...common, type: z.literal("person"), config: empty }),
  z.strictObject({
    ...common,
    type: z.literal("relation"),
    config: z.strictObject({ targetDatabaseId: uuidSchema }),
  }),
  z.strictObject({ ...common, type: z.literal("createdTime"), config: empty }),
  z.strictObject({ ...common, type: z.literal("editedTime"), config: empty }),
]);
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>;
export const databaseSchemaSchema = z
  .array(propertyDefinitionSchema)
  .min(1)
  .superRefine((properties, context) => {
    if (
      properties.filter((property) => property.type === "title").length !== 1 ||
      new Set(properties.map((property) => property.id)).size !== properties.length
    )
      context.addIssue({
        code: "custom",
        message: "A schema requires unique identities and exactly one title",
      });
  });
export function parseDatabaseSchema(input: unknown): PropertyDefinition[] {
  assertJsonBudget(input, DATABASE_MODEL_LIMITS.schemaBytes);
  return databaseSchemaSchema.parse(input);
}

/** Canonical decimal strings retain precision; localized punctuation belongs to UI. */
export function normalizeDecimal(input: string | number): string {
  if (
    typeof input === "number" &&
    (!Number.isFinite(input) || (Number.isInteger(input) && !Number.isSafeInteger(input)))
  )
    throw new Error("Invalid decimal");
  const text = String(input);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || text.length > 160) throw new Error("Invalid decimal");
  const exponent = Number(match[4] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) throw new Error("Invalid decimal");
  let digits = `${match[2]}${match[3] ?? ""}`;
  const point = (match[2]?.length ?? 0) + exponent;
  if (point <= 0) digits = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) digits += "0".repeat(point - digits.length);
  else digits = `${digits.slice(0, point)}.${digits.slice(point)}`;
  let [whole = "0", fraction = ""] = digits.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  const canonical = `${whole}${fraction ? `.${fraction}` : ""}`;
  if (canonical.length > 128) throw new Error("Invalid decimal");
  return `${match[1] && canonical !== "0" ? "-" : ""}${canonical}`;
}
export const decimalSchema = z.union([z.string(), z.number()]).transform((value, context) => {
  try {
    return normalizeDecimal(value);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid decimal" });
    return z.NEVER;
  }
});
const civil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      value.slice(0, 4) !== "0000" &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Invalid civil date");
export const instantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => {
    const day = value.slice(0, 10);
    const parsed = new Date(value);
    return (
      civil.safeParse(day).success &&
      Number.isFinite(parsed.getTime()) &&
      parsed.getUTCFullYear() >= 1 &&
      parsed.getUTCFullYear() <= 9999
    );
  })
  .transform((value) => new Date(value).toISOString());
const timeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid time zone");
export const dateValueSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("civil"), start: civil, end: civil.nullable() }),
    z.strictObject({
      kind: z.literal("instant"),
      start: instantSchema,
      end: instantSchema.nullable(),
      timeZone,
    }),
  ])
  .refine((value) => value.end === null || value.end >= value.start, "Invalid date range");
export type DateValue = z.infer<typeof dateValueSchema>;
export type PropertyValue = string | boolean | string[] | DateValue | null;
const ids = z
  .array(uuidSchema)
  .max(DATABASE_MODEL_LIMITS.setSize)
  .refine((values) => new Set(values).size === values.length, "Duplicate identity")
  .transform((values) => values.sort());
const url = z
  .string()
  .max(2048)
  .transform((value, context) => {
    try {
      const parsed = new URL(value);
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error();
      return parsed.href;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid URL" });
      return z.NEVER;
    }
  });

/** System fields are parseable for reads; write permission is checked separately. */
export function isSystemProperty(property: PropertyDefinition): boolean {
  return property.type === "createdTime" || property.type === "editedTime";
}
export function defaultPropertyValue(property: PropertyDefinition): PropertyValue {
  if (property.type === "checkbox") return false;
  if (["multiSelect", "person", "relation"].includes(property.type)) return [];
  return property.type === "title" ? "" : null;
}
export function parsePropertyWrite(property: PropertyDefinition, input: unknown): PropertyValue {
  if (isSystemProperty(property)) throw new Error("System properties are read-only");
  return parsePropertyValue(property, input);
}
export function parsePropertyValue(property: PropertyDefinition, input: unknown): PropertyValue {
  assertJsonBudget(input, DATABASE_MODEL_LIMITS.valueBytes);
  if (input === null) return null;
  switch (property.type) {
    case "title":
      return text.max(500).parse(input);
    case "text":
      return text.max(DATABASE_MODEL_LIMITS.textLength).parse(input);
    case "number":
      return decimalSchema.parse(input);
    case "checkbox":
      return z.boolean().parse(input);
    case "url":
      return url.parse(input);
    case "createdTime":
    case "editedTime":
      return instantSchema.parse(input);
    case "date": {
      const value = dateValueSchema.parse(input);
      if (value.kind !== property.config.mode) throw new Error("Date mode mismatch");
      return value;
    }
    case "select": {
      const value = uuidSchema.parse(input);
      if (!property.config.options.some((option) => option.id === value)) throw new Error("Unknown option");
      return value;
    }
    case "multiSelect": {
      const values = ids.parse(input);
      if (values.some((value) => !property.config.options.some((option) => option.id === value)))
        throw new Error("Unknown option");
      return values;
    }
    case "person":
    case "relation":
      return ids.parse(input);
  }
}
