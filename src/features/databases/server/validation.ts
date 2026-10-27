import "server-only";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";
import {
  cursorSchema,
  instantSchema,
  parseDatabaseSchema,
  parsePropertyValue,
  parseView,
  propertyTypes,
  sortSchema,
  viewTypes,
} from "../model";
import { uuidSchema } from "../model/properties";
import type { DatabaseProperty, DatabaseRow, DatabaseTemplate, SavedDatabaseView } from "../types";

export class DatabaseRequestError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409 | 413 | 503) {
    super("Database request failed");
  }
}
export function checkDatabaseError(error: { code?: string } | null): void {
  if (!error) return;
  throw new DatabaseRequestError(
    error.code === "40001"
      ? 409
      : ["42501", "28000"].includes(error.code ?? "")
        ? 403
        : error.code === "54000"
          ? 413
          : ["22023", "23514", "23503", "23505", "22P02"].includes(error.code ?? "")
            ? 400
            : 503,
  );
}
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const positionSchema = z.string().regex(/^[0-9A-Za-z]{1,128}$/);
const propertyWire = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  type: z.enum(propertyTypes),
  config: z.unknown(),
  position: positionSchema,
  revision: revisionSchema,
});
const viewConfigSchema = z.strictObject({
  visibleProperties: z.array(uuidSchema).max(500),
  sorts: z.array(sortSchema).max(10),
  filter: z.unknown(),
  groupBy: uuidSchema.nullable(),
  datePropertyId: uuidSchema.nullable(),
});
const viewWire = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  type: z.enum(viewTypes),
  config: viewConfigSchema,
  position: positionSchema,
  revision: revisionSchema,
});
const templateSchema = z.strictObject({
  id: uuidSchema,
  pageId: uuidSchema,
  title: z.string().min(1).max(120),
  revision: revisionSchema,
});
const metadataWire = z.strictObject({
  id: uuidSchema,
  pageId: uuidSchema,
  workspaceId: uuidSchema,
  revision: revisionSchema,
  role: z.enum(["owner", "editor", "commenter", "viewer"]),
  properties: z.array(propertyWire).min(1).max(3000),
  views: z.array(viewWire).min(1).max(1000),
  templates: z.array(templateSchema).max(1000),
});
export type DatabaseMetadata = {
  id: string;
  pageId: string;
  workspaceId: string;
  revision: number;
  role: "owner" | "editor" | "commenter" | "viewer";
  properties: DatabaseProperty[];
  views: SavedDatabaseView[];
  templates: DatabaseTemplate[];
};
export function parseMetadata(input: unknown): DatabaseMetadata {
  const value = metadataWire.parse(input);
  const properties = parseDatabaseSchema(
    value.properties.map(({ id, name, type, config }) => ({ id, name, type, config })),
  ).map((property, index) => ({
    ...property,
    revision: value.properties[index]?.revision ?? 0,
    position: value.properties[index]?.position ?? "V",
  }));
  const views = value.views.map((view) => ({
    ...parseView({ id: view.id, name: view.name, type: view.type, ...view.config }, properties),
    revision: view.revision,
    position: view.position,
  }));
  return { ...value, properties, views };
}
const rowWire = z.strictObject({
  id: uuidSchema,
  title: z.string().max(500),
  position: positionSchema,
  revision: revisionSchema,
  values: z.record(z.string(), z.unknown()),
  cellRevisions: z.record(z.string(), revisionSchema),
  createdAt: instantSchema,
  editedAt: instantSchema,
  coverFileId: uuidSchema.nullable(),
});
export function parseRow(input: unknown, properties: readonly DatabaseProperty[]): DatabaseRow {
  const row = rowWire.parse(input);
  const values: DatabaseRow["values"] = {};
  for (const [id, value] of Object.entries(row.values)) {
    const property = properties.find((property) => property.id === id);
    if (!property) throw new Error("Unknown projected property");
    values[id] = parsePropertyValue(property, value);
  }
  if (
    properties.some((property) => !(property.id in values)) ||
    Object.keys(row.cellRevisions).some((id) => !properties.some((property) => property.id === id))
  )
    throw new Error("Incomplete projected properties");
  return { ...row, values };
}

const queryFields = {
  viewId: uuidSchema.optional(),
  cursor: z.string().max(87384).nullable().optional(),
  filter: z.unknown().optional(),
  sorts: z.array(sortSchema).max(10).optional(),
  groupBy: uuidSchema.nullable().optional(),
  month: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
    .optional(),
};
export const querySchema = z.strictObject(queryFields);
export const queryActionSchema = z.strictObject({ action: z.literal("query"), ...queryFields });
export const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("createRecord"),
    title: z.string().max(500),
    templateId: uuidSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("cell"),
    recordId: uuidSchema,
    propertyId: uuidSchema,
    value: z.unknown(),
    expectedRevision: revisionSchema,
  }),
  z.strictObject({
    action: z.literal("property"),
    id: uuidSchema.nullable(),
    name: z.string().trim().min(1).max(120),
    type: z.enum(propertyTypes),
    config: z.unknown(),
    expectedRevision: revisionSchema,
    confirm: z.boolean().optional(),
    previewToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    action: z.literal("deleteProperty"),
    id: uuidSchema,
    expectedRevision: revisionSchema,
    confirm: z.boolean().optional(),
    previewToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    action: z.literal("view"),
    id: uuidSchema.nullable(),
    name: z.string().trim().min(1).max(120),
    type: z.enum(viewTypes),
    config: viewConfigSchema,
    expectedRevision: revisionSchema,
  }),
  z.strictObject({ action: z.literal("deleteView"), id: uuidSchema, expectedRevision: revisionSchema }),
  z.strictObject({
    action: z.literal("template"),
    id: uuidSchema.nullable(),
    title: z.string().trim().min(1).max(120),
    pageId: uuidSchema.optional(),
    expectedRevision: revisionSchema,
  }),
  z.strictObject({ action: z.literal("deleteTemplate"), id: uuidSchema, expectedRevision: revisionSchema }),
  z.strictObject({
    action: z.literal("moveRecord"),
    id: uuidSchema,
    beforeId: uuidSchema.nullable(),
    expectedRevision: revisionSchema,
  }),
]);
export const referenceSchema = z
  .strictObject({ id: uuidSchema, label: z.string().max(500), databaseId: uuidSchema.optional() })
  .transform((value) => ({
    id: value.id,
    label: value.label,
    ...(value.databaseId ? { databaseId: value.databaseId } : {}),
  }));
export const referenceListInput = z.strictObject({
  query: z.string().max(500).default(""),
  cursor: z.string().max(512).nullable().optional(),
});
export function encodeCursor(input: unknown): string {
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text, "utf8") > 65536) throw new DatabaseRequestError(503);
  return Buffer.from(text, "utf8").toString("base64url");
}
export function decodeCursor(input: string): unknown {
  if (!/^[A-Za-z0-9_-]{1,87384}$/.test(input)) throw new DatabaseRequestError(400);
  const bytes = Buffer.from(input, "base64url");
  if (bytes.length > 65536 || bytes.toString("base64url") !== input) throw new DatabaseRequestError(400);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DatabaseRequestError(400);
  }
}
export function decodeRecordCursor(input: string) {
  return cursorSchema.parse(decodeCursor(input));
}
export function toJson(input: unknown): Json {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (Array.isArray(input)) return input.map(toJson);
  if (typeof input === "object" && input !== null && Object.getPrototypeOf(input) === Object.prototype) {
    const result: { [key: string]: Json } = {};
    for (const [key, value] of Object.entries(input)) result[key] = toJson(value);
    return result;
  }
  throw new DatabaseRequestError(400);
}
export function parseServer<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof DatabaseRequestError) throw error;
    throw new DatabaseRequestError(503);
  }
}
export function parseInput<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof DatabaseRequestError) throw error;
    throw new DatabaseRequestError(400);
  }
}
