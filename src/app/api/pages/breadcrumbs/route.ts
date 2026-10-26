import { type NextRequest, NextResponse } from "next/server";
import { createClient, currentUser } from "@/lib/supabase/server";
import { uuidSchema } from "@/features/auth/validation";

export async function GET(request: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Entre novamente." }, { status: 401 });
  const id = uuidSchema.safeParse(request.nextUrl.searchParams.get("pageId"));
  const depth = Number(request.nextUrl.searchParams.get("afterDepth") ?? -1);
  if (!id.success || !Number.isSafeInteger(depth) || depth < -1)
    return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  const client = await createClient();
  const { data, error } = await client.rpc("list_page_breadcrumbs", {
    p_page_id: id.data,
    p_after_depth: depth,
  });
  if (error) return NextResponse.json({ error: "Página indisponível." }, { status: 403 });
  return NextResponse.json(
    { items: data.slice(0, 50), more: data.length > 50 },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
