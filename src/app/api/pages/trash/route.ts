import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, currentUser } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError, readBoundedJson } from "@/lib/http";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  if (!(await currentUser())) return NextResponse.json({ error: "Entre novamente." }, { status: 401 });
  let input: { workspaceId: string; query: string; afterId?: string | undefined };
  try {
    input = z
      .object({ workspaceId: z.uuid(), query: z.string().max(200), afterId: z.uuid().optional() })
      .parse(await readBoundedJson(request, 2048));
  } catch (error) {
    return NextResponse.json(
      { error: "Consulta inválida." },
      { status: error instanceof PayloadLimitError ? 413 : 400 },
    );
  }
  const client = await createClient();
  const { data, error } = await client.rpc("list_trash", {
    p_workspace_id: input.workspaceId,
    p_query: input.query,
    ...(input.afterId ? { p_after_id: input.afterId } : {}),
  });
  if (error) return NextResponse.json({ error: "Lixeira indisponível." }, { status: 403 });
  return NextResponse.json(
    { items: data.slice(0, 50), more: data.length > 50 },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
