import { z } from "zod";
import { streamFile } from "@/features/files/stream";
import { COVER_TYPES, fileDisposition } from "@/features/files/validation";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

async function unavailable() {
  const t = await getTranslations();
  return new Response(t("files.unavailable"), {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const id = z.uuid().safeParse((await params).fileId);
  if (!id.success) return unavailable();
  const client = await createClient(true);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return unavailable();
  const { data: file, error } = await client
    .from("page_files")
    .select("object_path,original_name,mime_type,actual_size,status")
    .eq("id", id.data)
    .eq("status", "ready")
    .maybeSingle();
  if (error || !file || !file.actual_size || file.actual_size > 25 * 1024 * 1024) return unavailable();
  const { data: blob, error: downloadError } = await client.storage
    .from("page-assets")
    .download(file.object_path);
  if (downloadError || !blob || blob.size !== file.actual_size) return unavailable();
  const current = await client
    .from("page_files")
    .select("id")
    .eq("id", id.data)
    .eq("status", "ready")
    .maybeSingle();
  if (current.error || !current.data) return unavailable();
  const inline = COVER_TYPES.some((type) => type === file.mime_type);
  return new Response(streamFile(blob), {
    headers: {
      "Content-Type": inline ? file.mime_type : "application/octet-stream",
      "Content-Disposition": fileDisposition(file.original_name, inline),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
