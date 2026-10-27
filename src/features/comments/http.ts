import { getTranslations } from "@/lib/i18n/server";
import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError } from "@/lib/http";
import { currentUser } from "@/lib/supabase/server";
import { CommentRequestError } from "./server";

export const commentHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function commentFailure(error: unknown) {
  const t = await getTranslations();

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
      ? t("comments.unavailable")
      : status === 409
        ? t("comments.threadConflict")
        : status === 400
          ? t("comments.checkData")
          : status === 413
            ? t("comments.tooLarge")
            : status === 429
              ? t("comments.rateLimit")
              : t("errors.tryAgain");
  return NextResponse.json(
    { error: message },
    { status, headers: { ...commentHeaders, ...(status === 429 ? { "Retry-After": "5" } : {}) } },
  );
}
export async function commentActor(request?: Request) {
  const t = await getTranslations();

  if (request && request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return {
      response: NextResponse.json(
        { error: t("errors.invalidOrigin") },
        { status: 403, headers: commentHeaders },
      ),
    };
  const actor = await currentUser();
  if (!actor)
    return {
      response: NextResponse.json(
        { error: t("errors.signInAgain") },
        { status: 401, headers: commentHeaders },
      ),
    };
  return { actor };
}
