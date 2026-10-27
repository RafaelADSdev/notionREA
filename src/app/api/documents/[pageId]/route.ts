import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError, readBoundedBytes } from "@/lib/http";
import {
  CONTENT_CHUNK_BYTES,
  MAX_CONTENT_BYTES,
  MAX_UPDATE_BYTES,
} from "@/features/editor/model/content-limits";
import {
  documentChunk,
  documentManifest,
  DocumentRequestError,
  requireContentEditor,
  saveContentOperation,
} from "@/features/editor/server/documents";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ pageId: string }> };
function failure(error: unknown) {
  const status =
    error instanceof DocumentRequestError ? error.status : error instanceof PayloadLimitError ? 413 : 503;
  const message =
    status === 409
      ? "O conteúdo mudou. Vamos atualizar e tentar novamente."
      : status === 413
        ? "Esta alteração excede o tamanho permitido."
        : status === 422
          ? "Não foi possível validar o conteúdo. Seu rascunho continua nesta sessão."
          : status === 403 || status === 404
            ? "Conteúdo indisponível para esta conta."
            : status === 429
              ? "Muitas alterações. Aguarde um instante antes de tentar novamente."
              : "Não foi possível concluir. Tente novamente.";
  return NextResponse.json(
    { error: message },
    { status, headers: { ...headers, ...(status === 429 || status === 503 ? { "Retry-After": "5" } : {}) } },
  );
}
export async function GET(request: NextRequest, context: Context) {
  if (!(await currentUser()))
    return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers });
  const page = z.uuid().safeParse((await context.params).pageId);
  if (!page.success) return NextResponse.json({ error: "Página indisponível." }, { status: 404, headers });
  try {
    const query = request.nextUrl.searchParams;
    if (!query.has("offset") && !query.has("revision"))
      return NextResponse.json(await documentManifest(page.data), { headers });
    const parsed = z
      .strictObject({
        revision: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        offset: z.coerce.number().int().min(0).max(MAX_CONTENT_BYTES).multipleOf(CONTENT_CHUNK_BYTES),
      })
      .safeParse({ revision: query.get("revision"), offset: query.get("offset") });
    if (!query.has("offset") || !query.has("revision") || !parsed.success)
      throw new DocumentRequestError(400);
    const bytes = await documentChunk(page.data, parsed.data.revision, parsed.data.offset);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  if (request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json({ error: "Origem inválida." }, { status: 403, headers });
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers });
  const page = z.uuid().safeParse((await context.params).pageId);
  const operation = z.uuid().safeParse(request.headers.get("x-operation-id"));
  if (
    !page.success ||
    !operation.success ||
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/octet-stream"
  )
    return NextResponse.json({ error: "Alteração inválida." }, { status: 400, headers });
  try {
    await requireContentEditor(page.data);
    const delta = await readBoundedBytes(request, MAX_UPDATE_BYTES);
    if (!delta.length) throw new DocumentRequestError(400);
    const revision = await saveContentOperation(page.data, actor.id, operation.data, delta);
    return NextResponse.json({ revision }, { headers });
  } catch (error) {
    return failure(error);
  }
}
