import { z } from "zod";

export const INTERCHANGE_LIMITS = Object.freeze({
  sourceBytes: 50 * 1024 * 1024,
  expandedBytes: 250 * 1024 * 1024,
  entries: 10000,
  ratio: 100,
  chunkBytes: 4 * 1024 * 1024,
  pageBytes: 8 * 1024 * 1024,
  cellBytes: 32768,
  rowBytes: 262144,
  extractionMs: 20000,
  batchMs: 10000,
});
export const jobStateSchema = z.enum([
  "uploading",
  "scanning",
  "preview",
  "running",
  "complete",
  "cancelled",
  "error",
]);
export const createJobSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("import"),
    workspaceId: z.uuid(),
    parentId: z.uuid().nullable().default(null),
    operationId: z.uuid(),
    name: z.string().min(1).max(180),
    size: z.number().int().min(1).max(INTERCHANGE_LIMITS.sourceBytes),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    kind: z.literal("export"),
    workspaceId: z.uuid(),
    pageId: z.uuid(),
    operationId: z.uuid(),
  }),
]);
export const columnMappingSchema = z.strictObject({
  index: z.number().int().min(0).max(499),
  name: z.string().trim().min(1).max(120),
  type: z.enum([
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
  ]),
  config: z.record(z.string(), z.unknown()).default({}),
});
export const csvMappingSchema = z.strictObject({
  path: z.string().min(1).max(1000),
  columns: z.array(columnMappingSchema).min(1).max(500),
});
export const jobCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.enum(["scan", "run", "confirm", "cancel"]) }),
  z.strictObject({ action: z.literal("configure"), mappings: z.array(csvMappingSchema).max(100) }),
]);
export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export type CsvMapping = z.infer<typeof csvMappingSchema>;
export type InterchangeJobState = z.infer<typeof jobStateSchema>;
export type InterchangeWarning = { code: string; path?: string | undefined; count?: number | undefined };
export const warningSchema = z.strictObject({
  code: z.string().max(80),
  path: z.string().max(1000).optional(),
  count: z.number().int().nonnegative().optional(),
});
export const jobSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  actorId: z.uuid(),
  operationId: z.uuid(),
  sourceName: z.string().max(180),
  parentId: z.uuid().nullable(),
  kind: z.enum(["import", "export", "templateCopy"]),
  state: jobStateSchema,
  revision: z.number().int().nonnegative(),
  rootPageId: z.uuid().nullable(),
  sourcePath: z.string(),
  sourceSize: z.number().nonnegative(),
  sourceDigest: z.string(),
  cursor: z.record(z.string(), z.unknown()),
  report: z.array(warningSchema).max(1000),
  confirmed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InterchangeJob = z.infer<typeof jobSchema>;
export const itemSchema = z.object({
  key: z.string().min(1).max(1100),
  index: z.number().int().nonnegative(),
  kind: z.string().max(40),
  state: z.enum(["pending", "ready", "running", "done", "error", "skipped"]),
  payload: z.record(z.string(), z.unknown()),
  pageId: z.uuid().nullable(),
  databaseId: z.uuid().nullable(),
  fileId: z.uuid().nullable(),
});
export type InterchangeItem = z.infer<typeof itemSchema>;
