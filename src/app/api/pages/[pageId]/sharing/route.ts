import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharingCommand, sharingSchema } from "@/features/sharing/model";
import { getEnvironment } from "@/lib/env";
import { readBoundedJson } from "@/lib/http";
import { createClient, currentUser } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ pageId: string }> };
function failure(code?: string) {
  const status = code === "40001" ? 409 : code === "42501" ? 403 : code === "22023" ? 400 : 503;
  return NextResponse.json(
    {
      error:
        status === 409
          ? "O acesso mudou. Atualize antes de confirmar novamente."
          : "Não foi possível concluir o compartilhamento.",
    },
    { status, headers },
  );
}
export async function GET(request: NextRequest, context: Context) {
  if (!(await currentUser()))
    return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers });
  try {
    const id = z.uuid().parse((await context.params).pageId),
      client = await createClient();
    if (request.nextUrl.searchParams.has("targets")) {
      const after = z
        .uuid()
        .optional()
        .parse(request.nextUrl.searchParams.get("after") ?? undefined);
      const result = await client.rpc("list_page_sharing_targets", {
        p_page_id: id,
        ...(after ? { p_after_id: after } : {}),
      });
      if (result.error) return failure(result.error.code);
      return NextResponse.json(
        z
          .strictObject({
            items: z.array(z.strictObject({ userId: z.uuid(), label: z.string().max(120) })).max(50),
            nextCursor: z.uuid().nullable(),
          })
          .parse(result.data),
        { headers },
      );
    }
    const result = await client.rpc("get_page_sharing", { p_page_id: id });
    if (result.error) return failure(result.error.code);
    return NextResponse.json(sharingSchema.parse(result.data), { headers });
  } catch {
    return failure("22023");
  }
}
export async function POST(request: NextRequest, context: Context) {
  if (request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json({ error: "Origem inválida." }, { status: 403, headers });
  if (!(await currentUser()))
    return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers });
  try {
    const id = z.uuid().parse((await context.params).pageId),
      body = sharingCommand.parse(await readBoundedJson(request, 262144)),
      client = await createClient();
    const result =
      body.action === "publication"
        ? await client.rpc("configure_page_publication", {
            p_page_id: id,
            p_expected_revision: body.expectedRevision,
            p_enabled: body.enabled,
            p_fields: body.fields,
            p_rotate: body.rotate ?? false,
          })
        : await client.rpc("configure_page_sharing", {
            p_page_id: id,
            p_expected_revision: body.expectedRevision,
            p_restricted: body.restricted,
            ...(body.workspaceRole ? { p_workspace_role: body.workspaceRole } : {}),
            p_grants: body.grants,
            p_owner_id: body.ownerId,
            p_confirm: body.confirm ?? false,
            ...(body.previewToken ? { p_preview_token: body.previewToken } : {}),
          });
    if (result.error) return failure(result.error.code);
    return NextResponse.json(result.data, { headers });
  } catch {
    return failure("22023");
  }
}
