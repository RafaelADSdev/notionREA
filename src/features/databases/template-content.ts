import "server-only";
import { requireContentEditor, saveContentOperation } from "@/features/editor/server/documents";
import { finishBlockUpload } from "@/features/files/block-actions";
import { withFileValidation } from "@/features/files/validation-slots";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { templateContentUpdates } from "./model/template-content";

export async function cloneTemplateBody(
  sourcePageId: string,
  targetPageId: string,
  actorId: string,
): Promise<void> {
  const client = await createClient();
  await requireContentEditor(targetPageId);
  const sourceRole = await client.rpc("get_page_role", { p_page_id: sourcePageId });
  if (sourceRole.error || !sourceRole.data) throw new Error("Template indisponível para esta conta.");
  const [source, target] = await Promise.all([
    client.from("document_heads").select("projection").eq("page_id", sourcePageId).maybeSingle(),
    client.from("document_heads").select("revision").eq("page_id", targetPageId).maybeSingle(),
  ]);
  if (source.error || target.error || target.data)
    throw new Error("O destino mudou. O conteúdo existente foi preservado.");
  if (!source.data) return;
  const projection = source.data.projection;
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection) ||
    !Array.isArray(projection.files)
  )
    throw new Error("Template indisponível.");
  const files = new Map<string, string>();
  const admin = createAdminClient();
  for (const fileId of projection.files) {
    if (typeof fileId !== "string") throw new Error("Arquivo do template indisponível.");
    const file = await client
      .from("page_files")
      .select("id,object_path,original_name,mime_type,actual_size,status,purpose")
      .eq("id", fileId)
      .eq("page_id", sourcePageId)
      .single();
    if (
      file.error ||
      !file.data ||
      file.data.status !== "ready" ||
      file.data.purpose !== "block" ||
      !file.data.actual_size
    )
      throw new Error("Arquivo do template indisponível.");
    const prepared = await client.rpc("prepare_block_file", {
      p_page_id: targetPageId,
      p_name: file.data.original_name,
      p_mime_type: file.data.mime_type,
      p_size: file.data.actual_size,
      p_kind: file.data.mime_type === "application/octet-stream" ? "file" : "image",
    });
    if (prepared.error || !prepared.data)
      throw new Error("Não foi possível preparar os arquivos do template.");
    const destination = await client
      .from("page_files")
      .select("object_path")
      .eq("id", prepared.data)
      .single();
    if (destination.error || !destination.data) throw new Error("Arquivo indisponível.");
    const sourceFile = file.data;
    const destinationPath = destination.data.object_path;
    await withFileValidation(async () => {
      // Authenticated download rechecks current source ACL; COPY would require a broader Storage policy.
      const blob = await client.storage.from("page-assets").download(sourceFile.object_path);
      if (blob.error || !blob.data || blob.data.size !== sourceFile.actual_size)
        throw new Error("O acesso ao arquivo do template mudou.");
      const uploaded = await admin.storage
        .from("page-assets")
        .upload(destinationPath, blob.data, { contentType: sourceFile.mime_type, upsert: false });
      if (uploaded.error) throw new Error("Não foi possível copiar o arquivo do template.");
    });
    const ready = await finishBlockUpload(prepared.data);
    if (!ready.ok) throw new Error(ready.error);
    files.set(fileId, prepared.data);
  }
  const updates = templateContentUpdates(projection, files);
  for (const delta of updates) await saveContentOperation(targetPageId, actorId, crypto.randomUUID(), delta);
}
