import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError, readBoundedJson } from "@/lib/http";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const t = await getTranslations();

  if (request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json({ error: t("errors.invalidOrigin") }, { status: 403 });
  if (!(await currentUser())) return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401 });
  let input: { workspaceId: string; query: string; afterId?: string | undefined };
  try {
    input = z
      .object({ workspaceId: z.uuid(), query: z.string().max(200), afterId: z.uuid().optional() })
      .parse(await readBoundedJson(request, 2048));
  } catch (error) {
    return NextResponse.json(
      { error: t("errors.invalidQuery") },
      { status: error instanceof PayloadLimitError ? 413 : 400 },
    );
  }
  const client = await createClient();
  const { data, error } = await client.rpc("list_trash", {
    p_workspace_id: input.workspaceId,
    p_query: input.query,
    ...(input.afterId ? { p_after_id: input.afterId } : {}),
  });
  if (error) return NextResponse.json({ error: t("pages.trashUnavailable") }, { status: 403 });
  return NextResponse.json(
    { items: data.slice(0, 50), more: data.length > 50 },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
