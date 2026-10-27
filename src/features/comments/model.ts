import { z } from "zod";

export const idSchema = z.uuid().transform((value) => value.toLowerCase());
export const commentRevision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Preserve PostgreSQL's microseconds: a truncated timestamp changes a keyset cursor.
export const commentInstant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
export const commentBody = z
  .string()
  .max(8192)
  .refine(
    (value) =>
      value.isWellFormed() && value.trim().length > 0 && new TextEncoder().encode(value).length <= 8192,
  );
export const blockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const commentAnchorSchema = z
  .strictObject({
    type: z.literal("relative"),
    start: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/),
    end: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/),
  })
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 4096);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export const pageRoleSchema = z.enum(["owner", "editor", "commenter", "viewer"]);
export type CommentPageRole = z.infer<typeof pageRoleSchema>;
export const commentSchema = z.strictObject({
  id: idSchema,
  threadId: idSchema,
  authorId: idSchema.nullable(),
  authorLabel: z.string().max(120),
  body: commentBody,
  revision: commentRevision,
  createdAt: commentInstant,
  updatedAt: commentInstant,
});
export type Comment = z.infer<typeof commentSchema>;
export const commentThreadSchema = z.strictObject({
  id: idSchema,
  pageId: idSchema,
  blockId: blockIdSchema.nullable(),
  anchor: commentAnchorSchema.nullable(),
  anchorAvailable: z.boolean(),
  authorId: idSchema.nullable(),
  authorLabel: z.string().max(120),
  resolved: z.boolean(),
  revision: commentRevision,
  createdAt: commentInstant,
  updatedAt: commentInstant,
  preview: commentSchema.nullable(),
});
export type CommentThread = z.infer<typeof commentThreadSchema>;
export const threadPageSchema = z.strictObject({
  threads: z.array(commentThreadSchema).max(50),
  nextCursor: z.string().max(512).nullable(),
  actorId: idSchema,
  role: pageRoleSchema,
});
export type CommentThreadPage = z.infer<typeof threadPageSchema>;
export const repliesPageSchema = z.strictObject({
  comments: z.array(commentSchema).max(50),
  nextCursor: z.string().max(512).nullable(),
});
export type CommentRepliesPage = z.infer<typeof repliesPageSchema>;
export const presenceSchema = z.strictObject({
  epoch: commentRevision,
  expiresAt: commentInstant,
  participants: z
    .array(z.strictObject({ participantId: idSchema, label: z.string().max(120), expiresAt: commentInstant }))
    .max(256),
});
export type PagePresence = z.infer<typeof presenceSchema>;
export const createThreadSchema = z
  .strictObject({
    body: commentBody,
    requestId: idSchema,
    blockId: blockIdSchema.optional(),
    anchor: commentAnchorSchema.optional(),
  })
  .refine((value) => !value.anchor || Boolean(value.blockId));
export const threadCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("reply"), body: commentBody, requestId: idSchema }),
  z.strictObject({ action: z.literal("resolve"), resolved: z.boolean(), expectedRevision: commentRevision }),
]);
export const editCommentSchema = z.strictObject({ body: commentBody, expectedRevision: commentRevision });
export const deleteCommentSchema = z.strictObject({ expectedRevision: commentRevision });
