"use client";
import { z } from "zod";
import { readBoundedJson } from "@/lib/http";
import { createTranslator, DEFAULT_LOCALE, type Translator } from "@/lib/i18n/core";
import {
  commentRevision,
  createThreadSchema,
  deleteCommentSchema,
  editCommentSchema,
  idSchema,
  repliesPageSchema,
  threadCommandSchema,
  threadPageSchema,
} from "./model";

export class CommentHttpError extends Error {
  constructor(public readonly status: number) {
    super("Comment request failed");
  }
}
async function request<T>(
  url: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(signal ? { signal } : {}),
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw new CommentHttpError(response.status);
  try {
    return schema.parse(await readBoundedJson(response, 1048576));
  } catch {
    throw new CommentHttpError(503);
  }
}
export function fetchThreads(pageId: string, cursor?: string | null, signal?: AbortSignal) {
  return request(
    `/api/pages/${idSchema.parse(pageId)}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    threadPageSchema,
    "GET",
    undefined,
    signal,
  );
}
export function postThread(pageId: string, input: unknown) {
  return request(
    `/api/pages/${idSchema.parse(pageId)}/comments`,
    z.strictObject({ id: idSchema }),
    "POST",
    createThreadSchema.parse(input),
  );
}
export function fetchReplies(threadId: string, cursor?: string | null, signal?: AbortSignal) {
  return request(
    `/api/comments/threads/${idSchema.parse(threadId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    repliesPageSchema,
    "GET",
    undefined,
    signal,
  );
}
export function postThreadAction(threadId: string, input: unknown) {
  return request(
    `/api/comments/threads/${idSchema.parse(threadId)}`,
    z.union([z.strictObject({ id: idSchema }), z.strictObject({ revision: commentRevision })]),
    "POST",
    threadCommandSchema.parse(input),
  );
}
export function patchComment(commentId: string, input: unknown) {
  return request(
    `/api/comments/${idSchema.parse(commentId)}`,
    z.strictObject({ revision: commentRevision }),
    "PATCH",
    editCommentSchema.parse(input),
  );
}
export function removeComment(commentId: string, input: unknown) {
  return request(
    `/api/comments/${idSchema.parse(commentId)}`,
    z.strictObject({ ok: z.literal(true) }),
    "DELETE",
    deleteCommentSchema.parse(input),
  );
}
export function commentErrorMessage(
  error: unknown,
  t: Translator = createTranslator(DEFAULT_LOCALE),
): string {
  if (!(error instanceof CommentHttpError)) return t("comments.checkPreserved");
  return t(
    error.status === 401 || error.status === 403
      ? "comments.accessChanged"
      : error.status === 409
        ? "comments.conflict"
        : error.status === 429
          ? "comments.rateLimit"
          : error.status === 400 || error.status === 413
            ? "comments.checkLimit"
            : "comments.retryPreserved",
  );
}
export function commentAccessLost(error: unknown): boolean {
  return error instanceof CommentHttpError && (error.status === 401 || error.status === 403);
}
