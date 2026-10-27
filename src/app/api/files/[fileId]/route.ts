import { z } from "zod";
import { COVER_TYPES, fileDisposition } from "@/features/files/validation";
import { createClient } from "@/lib/supabase/server";

const unavailable = () =>
  new Response("Arquivo indisponível.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });

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
  if (error || !file) return unavailable();
  const { data: blob, error: downloadError } = await client.storage
    .from("page-assets")
    .download(file.object_path);
  if (downloadError || !blob || blob.size !== file.actual_size) return unavailable();
  const inline = COVER_TYPES.some((type) => type === file.mime_type);
  return new Response(blob, {
    headers: {
      "Content-Type": inline ? file.mime_type : "application/octet-stream",
      "Content-Length": String(blob.size),
      "Content-Disposition": fileDisposition(file.original_name, inline),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
