import { getTranslations } from "@/lib/i18n/server";
import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError } from "@/lib/http";
import { currentUser } from "@/lib/supabase/server";
import { InterchangeError } from "./repository";
export const interchangeHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function interchangeActor(request?: NextRequest) {
  const t = await getTranslations();

  if (request && request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json(
      { error: t("errors.invalidOrigin"), code: "invalid-origin" },
      { status: 403, headers: interchangeHeaders },
    );
  if (!(await currentUser()))
    return NextResponse.json(
      { error: t("errors.signInAgain"), code: "authentication-required" },
      { status: 401, headers: interchangeHeaders },
    );
  return null;
}
export async function interchangeFailure(error: unknown) {
  const t = await getTranslations();

  const status =
    error instanceof InterchangeError
      ? error.status
      : error instanceof PayloadLimitError
        ? 413
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 422
          : 503;
  return NextResponse.json(
    {
      error:
        status === 403
          ? t("interchange.accountUnavailable")
          : status === 429
            ? t("interchange.wait")
            : t("interchange.stepFailed"),
      code:
        error instanceof InterchangeError
          ? error.code
          : status === 413
            ? "payload-too-large"
            : "request-failed",
    },
    { status, headers: interchangeHeaders },
  );
}
