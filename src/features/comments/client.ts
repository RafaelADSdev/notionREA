"use client";
import { z } from "zod";
import { readBoundedJson } from "@/lib/http";
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
    super(
      status === 401 || status === 403
        ? "O acesso aos comentários mudou. Seu rascunho foi preservado."
        : status === 409
          ? "O comentário mudou. Atualize a conversa antes de reaplicar sua edição."
          : status === 429
            ? "Muitas alterações. Aguarde um instante antes de tentar novamente."
            : status === 400 || status === 413
              ? "Confira o comentário: o limite é 8 KiB de texto."
              : "Não foi possível concluir. Seu texto foi preservado; tente novamente.",
    );
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
export function commentErrorMessage(error: unknown): string {
  return error instanceof CommentHttpError
    ? error.message
    : "Não foi possível concluir. Confira o texto e tente novamente; seu rascunho foi preservado.";
}
export function commentAccessLost(error: unknown): boolean {
  return error instanceof CommentHttpError && (error.status === 401 || error.status === 403);
}
