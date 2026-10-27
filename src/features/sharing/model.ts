import { z } from "zod";
import { blockTypeSchema, contentToneSchema } from "@/features/editor/model/block-schema";

export const publicationToken = z.string().regex(/^[a-f0-9]{64}$/);
export const sharingRole = z.enum(["owner", "editor", "commenter", "viewer"]);
export const workspacePageRole = z.enum(["editor", "commenter", "viewer"]);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sharingSchema = z.strictObject({
  revision,
  ownerId: z.uuid(),
  restricted: z.boolean(),
  workspaceRole: workspacePageRole.nullable(),
  grants: z
    .array(z.strictObject({ userId: z.uuid(), label: z.string().max(120), role: sharingRole }))
    .max(1000),
  publication: z
    .strictObject({ token: publicationToken, fields: z.array(z.uuid()).max(500), revision })
    .nullable(),
});
export type PageSharing = z.infer<typeof sharingSchema>;
export const sharingCommand = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("access"),
    expectedRevision: revision,
    restricted: z.boolean(),
    workspaceRole: workspacePageRole.nullable(),
    grants: z.array(z.strictObject({ userId: z.uuid(), role: sharingRole })).max(1000),
    ownerId: z.uuid(),
    confirm: z.boolean().optional(),
    previewToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    action: z.literal("publication"),
    expectedRevision: revision,
    enabled: z.boolean(),
    fields: z.array(z.uuid()).max(500),
    rotate: z.boolean().optional(),
  }),
]);
export type SharingCommand = z.infer<typeof sharingCommand>;
const publicMark = z.strictObject({
  type: z.enum(["bold", "italic", "underline", "strike", "code", "link", "textStyle"]),
  attrs: z.record(z.string(), z.unknown()).optional(),
});
export const publicInline = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    text: z.string().max(8388608),
    marks: z.array(publicMark).max(7).optional(),
  }),
  z.strictObject({ type: z.literal("hardBreak") }),
  z.strictObject({
    type: z.literal("pageMention"),
    attrs: z.strictObject({ pageId: z.uuid(), title: z.string().max(500), token: publicationToken }),
  }),
]);
export type PublicInline = z.infer<typeof publicInline>;
const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const publicBlock = z.strictObject({
  id: blockId,
  type: blockTypeSchema,
  parentId: blockId.nullable(),
  position: z.string().max(128),
  attributes: z.record(z.string(), z.unknown()),
  content: z.strictObject({
    type: z.literal("doc"),
    content: z
      .array(z.strictObject({ type: z.literal("paragraph"), content: z.array(publicInline).max(100000) }))
      .max(1),
  }),
});
export type PublicBlock = z.infer<typeof publicBlock>;
export const publicReference = z.strictObject({
  id: z.uuid(),
  title: z.string().max(500),
  token: publicationToken,
});
export const publicProperty = z.strictObject({
  id: z.uuid(),
  name: z.string().max(120),
  type: z.string().max(32),
  options: z
    .array(z.strictObject({ id: z.uuid(), label: z.string().max(120), color: contentToneSchema }))
    .max(500)
    .optional(),
});
export const publicPageSchema = z.strictObject({
  page: z.strictObject({
    id: z.uuid(),
    title: z.string().max(500),
    icon: z.string().max(16),
    coverFileId: z.uuid().nullable(),
  }),
  content: z.strictObject({ schemaVersion: z.literal(1), blocks: z.array(publicBlock).max(10000) }),
  database: z
    .strictObject({
      id: z.uuid(),
      properties: z.array(publicProperty).max(500),
      rows: z
        .array(
          z.strictObject({
            id: z.uuid(),
            title: z.string().max(500),
            icon: z.string().max(16),
            coverFileId: z.uuid().nullable(),
            token: publicationToken,
            values: z.record(z.string(), z.unknown()),
          }),
        )
        .max(50),
      nextCursor: z.uuid().nullable(),
    })
    .nullable(),
  files: z.array(z.uuid()).max(10000),
});
export type PublicPage = z.infer<typeof publicPageSchema>;
