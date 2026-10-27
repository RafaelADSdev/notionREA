import "server-only";
import * as Y from "yjs";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  commentAnchorSchema,
  commentInstant,
  commentRevision,
  commentSchema,
  commentThreadSchema,
  createThreadSchema,
  deleteCommentSchema,
  editCommentSchema,
  idSchema,
  pageRoleSchema,
  presenceSchema,
  threadCommandSchema,
} from "./model";

export class CommentRequestError extends Error {
  constructor(public readonly status: 400 | 403 | 409 | 429 | 503) {
    super("Comment request failed");
  }
}
function check(error: { code?: string } | null): void {
  if (!error) return;
  throw new CommentRequestError(
    error.code === "40001"
      ? 409
      : error.code === "54000"
        ? 429
        : ["42501", "28000"].includes(error.code ?? "")
          ? 403
          : ["22023", "22P02", "23514"].includes(error.code ?? "")
            ? 400
            : 503,
  );
}
function trusted<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new CommentRequestError(503);
  }
}
const rawCursor = z.strictObject({ createdAt: commentInstant, id: idSchema });
const cursorSchema = rawCursor.extend({
  version: z.literal(1),
  scope: idSchema,
  kind: z.enum(["threads", "replies"]),
});
function cursorParameters(value: string | null | undefined, scope: string, kind: "threads" | "replies") {
  if (!value) return {};
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new CommentRequestError(400);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new CommentRequestError(400);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CommentRequestError(400);
  }
  const cursor = cursorSchema.parse(input);
  if (cursor.scope !== scope || cursor.kind !== kind) throw new CommentRequestError(400);
  return { p_after_created_at: cursor.createdAt, p_after_id: cursor.id };
}
function encodeCursor(value: z.infer<typeof rawCursor> | null, scope: string, kind: "threads" | "replies") {
  return value
    ? Buffer.from(JSON.stringify({ ...value, version: 1, scope, kind }), "utf8").toString("base64url")
    : null;
}
function verifyAnchor(input: unknown, blockId: string | undefined) {
  const anchor = commentAnchorSchema.parse(input);
  if (!blockId) throw new CommentRequestError(400);
  for (const value of [anchor.start, anchor.end]) {
    try {
      const bytes = Buffer.from(value, "base64url");
      const position = Y.decodeRelativePosition(bytes);
      if (
        Buffer.from(Y.encodeRelativePosition(position)).toString("base64url") !== value ||
        (position.tname !== null && position.tname !== `block-content:${blockId}`) ||
        !Number.isSafeInteger(position.assoc)
      )
        throw new Error("Invalid relative position");
      for (const identity of [position.type, position.item])
        if (
          identity &&
          (!Number.isSafeInteger(identity.client) ||
            identity.client < 0 ||
            identity.client > 4294967295 ||
            !Number.isSafeInteger(identity.clock) ||
            identity.clock < 0)
        )
          throw new Error("Invalid relative identity");
    } catch {
      throw new CommentRequestError(400);
    }
  }
  return anchor;
}
export async function listCommentThreads(pageId: string, actorId: string, cursor?: string | null) {
  const page = idSchema.parse(pageId),
    actor = idSchema.parse(actorId);
  const after = cursorParameters(cursor, page, "threads");
  const client = await createClient();
  const [result, role] = await Promise.all([
    client.rpc("list_comment_threads", { p_page_id: page, ...after }),
    client.rpc("get_page_role", { p_page_id: page }),
  ]);
  check(result.error);
  check(role.error);
  if (!role.data) throw new CommentRequestError(403);
  const data = trusted(() =>
    z
      .strictObject({ threads: z.array(commentThreadSchema).max(50), nextCursor: rawCursor.nullable() })
      .parse(result.data),
  );
  if (data.threads.some((thread) => thread.pageId !== page)) throw new CommentRequestError(503);
  return {
    threads: data.threads,
    nextCursor: encodeCursor(data.nextCursor, page, "threads"),
    actorId: actor,
    role: trusted(() => pageRoleSchema.parse(role.data)),
  };
}
export async function createCommentThread(pageId: string, input: unknown) {
  const page = idSchema.parse(pageId),
    value = createThreadSchema.parse(input);
  const anchor = value.anchor ? verifyAnchor(value.anchor, value.blockId) : undefined;
  const client = await createClient();
  const result = await client.rpc("create_comment_thread", {
    p_page_id: page,
    p_body: value.body,
    p_request_id: value.requestId,
    ...(value.blockId ? { p_block_id: value.blockId } : {}),
    ...(anchor ? { p_anchor: anchor } : {}),
  });
  check(result.error);
  return { id: trusted(() => idSchema.parse(result.data)) };
}
export async function listThreadComments(threadId: string, cursor?: string | null) {
  const thread = idSchema.parse(threadId),
    after = cursorParameters(cursor, thread, "replies");
  const client = await createClient();
  const result = await client.rpc("list_thread_comments", { p_thread_id: thread, ...after });
  check(result.error);
  const data = trusted(() =>
    z
      .strictObject({ comments: z.array(commentSchema).max(50), nextCursor: rawCursor.nullable() })
      .parse(result.data),
  );
  if (data.comments.some((comment) => comment.threadId !== thread)) throw new CommentRequestError(503);
  return { comments: data.comments, nextCursor: encodeCursor(data.nextCursor, thread, "replies") };
}
export async function changeCommentThread(threadId: string, input: unknown) {
  const thread = idSchema.parse(threadId),
    value = threadCommandSchema.parse(input);
  const client = await createClient();
  if (value.action === "reply") {
    const result = await client.rpc("add_comment", {
      p_thread_id: thread,
      p_body: value.body,
      p_request_id: value.requestId,
    });
    check(result.error);
    return { id: trusted(() => idSchema.parse(result.data)) };
  }
  const result = await client.rpc("resolve_comment_thread", {
    p_thread_id: thread,
    p_resolved: value.resolved,
    p_expected_revision: value.expectedRevision,
  });
  check(result.error);
  return { revision: trusted(() => commentRevision.parse(result.data)) };
}
export async function editComment(commentId: string, input: unknown) {
  const id = idSchema.parse(commentId),
    value = editCommentSchema.parse(input),
    client = await createClient();
  const result = await client.rpc("edit_comment", {
    p_comment_id: id,
    p_body: value.body,
    p_expected_revision: value.expectedRevision,
  });
  check(result.error);
  return { revision: trusted(() => commentRevision.parse(result.data)) };
}
export async function deleteComment(commentId: string, input: unknown) {
  const id = idSchema.parse(commentId),
    value = deleteCommentSchema.parse(input),
    client = await createClient();
  const result = await client.rpc("delete_comment", {
    p_comment_id: id,
    p_expected_revision: value.expectedRevision,
  });
  check(result.error);
  return { ok: true };
}
export async function renewPagePresence(pageId: string, input: unknown) {
  const page = idSchema.parse(pageId),
    value = z.strictObject({ participantId: idSchema }).parse(input),
    client = await createClient();
  const result = await client.rpc("renew_page_presence", {
    p_page_id: page,
    p_participant_id: value.participantId,
  });
  check(result.error);
  return trusted(() => presenceSchema.parse(result.data));
}
