import { type NextRequest, NextResponse } from "next/server";
import { uuidSchema } from "@/features/auth/validation";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const t = await getTranslations();

  if (!(await currentUser())) return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401 });
  const id = uuidSchema.safeParse(request.nextUrl.searchParams.get("pageId"));
  const depth = Number(request.nextUrl.searchParams.get("afterDepth") ?? -1);
  if (!id.success || !Number.isSafeInteger(depth) || depth < -1)
    return NextResponse.json({ error: t("errors.invalidQuery") }, { status: 400 });
  const client = await createClient();
  const { data, error } = await client.rpc("list_page_breadcrumbs", {
    p_page_id: id.data,
    p_after_depth: depth,
  });
  if (error) return NextResponse.json({ error: t("pages.unavailable") }, { status: 403 });
  return NextResponse.json(
    { items: data.slice(0, 50), more: data.length > 50 },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
