import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, currentUser } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import { PayloadLimitError, readBoundedJson } from "@/lib/http";
import { pageDetailSchema } from "@/features/pages/model/validation";

const headers = { "Cache-Control": "private, no-store" };
const input = z.strictObject({
  workspaceId: z.uuid(),
  mentions: z.array(z.uuid()).max(100),
  files: z.array(z.uuid()).max(100),
});
export async function POST(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  if (request.headers.get("origin") !== new URL(getEnvironment().APP_URL).origin)
    return NextResponse.json({ error: "Origem inválida." }, { status: 403, headers });
  if (!(await currentUser()))
    return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers });
  let values: z.infer<typeof input>;
  let pageId: string;
  try {
    pageId = z.uuid().parse((await params).pageId);
    values = input.parse(await readBoundedJson(request, 16384));
  } catch (error) {
    return NextResponse.json(
      { error: "Referências inválidas." },
      { status: error instanceof PayloadLimitError ? 413 : 400, headers },
    );
  }
  const client = await createClient();
  const source = await client.rpc("get_page_metadata", {
    p_page_id: pageId,
    p_workspace_id: values.workspaceId,
  });
  const page = pageDetailSchema.safeParse(source.data);
  if (source.error || !page.success)
    return NextResponse.json({ error: "Página indisponível." }, { status: 403, headers });
  const [mentions, files] = await Promise.all([
    client.rpc("resolve_page_mentions", { p_workspace_id: values.workspaceId, p_page_ids: values.mentions }),
    values.files.length
      ? client
          .from("page_files")
          .select("id,original_name,mime_type,actual_size,image_width,image_height")
          .eq("workspace_id", values.workspaceId)
          .eq("page_id", pageId)
          .eq("status", "ready")
          .in("id", values.files)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (mentions.error || files.error)
    return NextResponse.json(
      { error: "Não foi possível atualizar as referências." },
      { status: 503, headers },
    );
  return NextResponse.json(
    {
      mentions: mentions.data,
      files: files.data.map((file) => ({
        fileId: file.id,
        name: file.original_name,
        mimeType: file.mime_type,
        size: file.actual_size ?? 0,
        width: file.image_width,
        height: file.image_height,
      })),
    },
    { headers },
  );
}
