import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError } from "@/lib/http";
import { currentUser } from "@/lib/supabase/server";
import { CommentRequestError } from "./server";

export const commentHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function commentFailure(error: unknown) {
  const status =
    error instanceof CommentRequestError
      ? error.status
      : error instanceof PayloadLimitError
        ? 413
        : error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError
          ? 400
          : 503;
  const message =
    status === 403
      ? "Comentários indisponíveis para esta conta."
      : status === 409
        ? "A conversa mudou. Atualize antes de tentar novamente; seu texto foi preservado."
        : status === 400
          ? "Confira o texto e os dados do comentário."
          : status === 413
            ? "Este comentário excede o tamanho permitido."
            : status === 429
              ? "Muitas alterações. Aguarde um instante antes de tentar novamente."
              : "Não foi possível concluir. Tente novamente.";
  return NextResponse.json(
    { error: message },
    { status, headers: { ...commentHeaders, ...(status === 429 ? { "Retry-After": "5" } : {}) } },
  );
}
export async function commentActor(request?: Request) {
  if (request && request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return {
      response: NextResponse.json({ error: "Origem inválida." }, { status: 403, headers: commentHeaders }),
    };
  const actor = await currentUser();
  if (!actor)
    return {
      response: NextResponse.json({ error: "Entre novamente." }, { status: 401, headers: commentHeaders }),
    };
  return { actor };
}
