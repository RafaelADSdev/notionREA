import { type NextRequest, NextResponse } from "next/server";
import { uuidSchema } from "@/features/auth/validation";
import { childrenOf } from "@/features/pages/queries";
import { getTranslations } from "@/lib/i18n/server";
import { currentUser } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const t = await getTranslations();

  if (!(await currentUser())) return NextResponse.json({ error: t("errors.signInAgain") }, { status: 401 });
  const workspace = uuidSchema.safeParse(request.nextUrl.searchParams.get("workspaceId"));
  const parentValue = request.nextUrl.searchParams.get("parentId");
  const parent = parentValue ? uuidSchema.safeParse(parentValue) : null;
  const afterId = request.nextUrl.searchParams.get("afterId");
  const afterPosition = request.nextUrl.searchParams.get("afterPosition");
  if (
    !workspace.success ||
    (parent && !parent.success) ||
    (afterId && !uuidSchema.safeParse(afterId).success) ||
    (afterPosition && !/^[A-Za-z0-9]{1,128}$/.test(afterPosition))
  )
    return NextResponse.json({ error: t("errors.invalidQuery") }, { status: 400 });
  try {
    return NextResponse.json(
      await childrenOf(
        workspace.data,
        parent?.data ?? null,
        afterPosition ?? undefined,
        afterId ?? undefined,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: t("pages.loadFailed") }, { status: 403 });
  }
}
