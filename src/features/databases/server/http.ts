import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError } from "@/lib/http";
import { getTranslations } from "@/lib/i18n/server";
import { DatabaseRequestError } from "./validation";

export const databaseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function databaseFailure(error: unknown) {
  const t = await getTranslations();
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
      ? t("database.dataChanged")
      : status === 413
        ? t("database.changeTooLarge")
        : status === 403 || status === 404
          ? t("database.recordUnavailable")
          : status === 400
            ? t("database.checkQueryData")
            : t("errors.tryAgain");
  return NextResponse.json({ ok: false, error: message }, { status, headers: databaseHeaders });
}
export function sameDatabaseOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(getEnvironment().APP_URL).origin;
}
