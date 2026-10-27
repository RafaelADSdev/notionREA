import { z } from "zod";
import { COVER_TYPES, fileDisposition } from "@/features/files/validation";
import { withFileValidation } from "@/features/files/validation-slots";
import { publicationToken } from "@/features/sharing/model";
import { createAdminClient } from "@/lib/supabase/admin";

const unavailable = () =>
  new Response("Arquivo indisponível.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; fileId: string }> },
) {
  const params = await context.params,
    token = publicationToken.safeParse(params.token),
    id = z.uuid().safeParse(params.fileId);
  if (!token.success || !id.success) return unavailable();
  const admin = createAdminClient();
  const allowed = await admin.rpc("verify_public_file", { p_token: token.data, p_file_id: id.data });
  if (allowed.error || allowed.data !== true) return unavailable();
  try {
    return await withFileValidation(async () => {
      const file = await admin
        .from("page_files")
        .select("object_path,original_name,mime_type,actual_size,status")
        .eq("id", id.data)
        .eq("status", "ready")
        .maybeSingle();
      if (file.error || !file.data || !file.data.actual_size || file.data.actual_size > 26214400)
        return unavailable();
      const metadata = file.data;
      const downloaded = await admin.storage.from("page-assets").download(file.data.object_path);
      if (downloaded.error || !downloaded.data || downloaded.data.size !== file.data.actual_size)
        return unavailable();
      const current = await admin.rpc("verify_public_file", { p_token: token.data, p_file_id: id.data });
      if (current.error || current.data !== true) return unavailable();
      const inline = COVER_TYPES.some((type) => type === metadata.mime_type);
      return new Response(downloaded.data, {
        headers: {
          "Content-Type": inline ? file.data.mime_type : "application/octet-stream",
          "Content-Length": String(downloaded.data.size),
          "Content-Disposition": fileDisposition(file.data.original_name, inline),
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    });
  } catch {
    return new Response("Arquivo temporariamente indisponível.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "Retry-After": "5" },
    });
  }
}
