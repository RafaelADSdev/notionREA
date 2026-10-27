import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError } from "@/lib/http";
import { DatabaseRequestError } from "./validation";

export const databaseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function databaseFailure(error: unknown) {
  const status =
    error instanceof DatabaseRequestError
      ? error.status
      : error instanceof PayloadLimitError
        ? 413
        : error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError
          ? 400
          : 503;
  const message =
    status === 409
      ? "Os dados mudaram. Atualize a consulta e confira a alteração antes de tentar novamente."
      : status === 413
        ? "Esta alteração excede o tamanho permitido."
        : status === 403 || status === 404
          ? "Base ou registro indisponível para esta conta."
          : status === 400
            ? "Confira os dados da consulta ou alteração."
            : "Não foi possível concluir. Tente novamente.";
  return NextResponse.json({ ok: false, error: message }, { status, headers: databaseHeaders });
}
export function sameDatabaseOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(getEnvironment().APP_URL).origin;
}
