import { z } from "zod";

export const blockTypes = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberListItem",
  "task",
  "toggle",
  "quote",
  "callout",
  "divider",
  "code",
  "image",
  "file",
  "table",
  "tableRow",
  "tableCell",
  "columns",
  "column",
  "databaseRef",
] as const;
export type BlockType = (typeof blockTypes)[number];
export type BlockAttributes = Record<string, string | number | boolean | number[] | undefined>;
export const blockTypeSchema = z.enum(blockTypes);
export const contentToneSchema = z.enum(["default", "indigo", "copper", "green", "red", "yellow"]);
export const codeLanguageSchema = z.enum([
  "plaintext",
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "python",
  "sql",
  "bash",
  "markdown",
]);
const empty = z.strictObject({});
const media = {
  fileId: z.uuid().optional(),
  caption: z.string().max(1000).optional(),
};
const attributeSchemas: Record<BlockType, z.ZodType<BlockAttributes>> = {
  paragraph: empty,
  heading: z.strictObject({ level: z.number().int().min(1).max(3).default(1) }),
  bulletListItem: empty,
  numberListItem: z.strictObject({ start: z.number().int().min(1).max(999999).optional() }),
  task: z.strictObject({ checked: z.boolean().default(false) }),
  toggle: empty,
  quote: empty,
  callout: z.strictObject({ tone: contentToneSchema.default("indigo") }),
  divider: empty,
  code: z.strictObject({ language: codeLanguageSchema.default("plaintext") }),
  image: z.strictObject({
    ...media,
    alt: z.string().max(1000).default(""),
    width: z.number().min(10).max(4096).optional(),
  }),
  file: z.strictObject({ ...media, displayName: z.string().max(180).optional() }),
  table: z.strictObject({ header: z.boolean().default(false) }),
  tableRow: empty,
  tableCell: z.strictObject({
    columnId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .optional(),
  }),
  columns: z.strictObject({ widths: z.array(z.number().min(0.01).max(100)).min(2).max(12).optional() }),
  column: empty,
  databaseRef: z.strictObject({ databaseId: z.uuid().optional(), viewId: z.uuid().optional() }),
};

export function validateBlockAttributes(type: BlockType, value: unknown): BlockAttributes {
  return attributeSchemas[type].parse(value);
}

export function canContainBlock(parent: BlockType | null, child: BlockType): boolean {
  if (parent === "table") return child === "tableRow";
  if (parent === "tableRow") return child === "tableCell";
  if (parent === "columns") return child === "column";
  if (child === "tableRow" || child === "tableCell" || child === "column") return false;
  return (
    parent === null ||
    [
      "toggle",
      "quote",
      "callout",
      "bulletListItem",
      "numberListItem",
      "task",
      "tableCell",
      "column",
    ].includes(parent)
  );
}
