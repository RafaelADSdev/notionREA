"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyImageDimensions } from "./image-dimensions";
import { coverUploadSchema, MAX_FILE_BYTES, verifyImageBytes } from "./validation";
import { withFileValidation } from "./validation-slots";

export type PreparedFileUpload = { fileId: string; path: string; token: string; signedUrl: string };
export type PrepareCoverUploadResult = { ok: true; value: PreparedFileUpload } | { ok: false; error: string };
export type CoverMutationResult = { ok: true; revision: number } | { ok: false; error: string };

export async function prepareCoverUpload(
  input: Parameters<typeof prepareFileUpload>[0],
): Promise<PrepareCoverUploadResult> {
  try {
    return { ok: true, value: await prepareFileUpload(input) };
  } catch {
    return {
      ok: false,
      error:
        "Envie uma imagem PNG, JPEG, WebP ou GIF de até 25 MiB. Confira seu acesso e tente novamente em instantes.",
    };
  }
}

export async function finishCoverUpload(
  fileId: string,
  expectedPageRevision: number,
): Promise<CoverMutationResult> {
  try {
    return { ok: true, revision: await finalizePageCover(fileId, expectedPageRevision) };
  } catch {
    return {
      ok: false,
      error:
        "Não foi possível confirmar a capa. Use uma imagem PNG, JPEG, WebP ou GIF de até 25 MiB. Recarregue a página e tente enviar novamente.",
    };
  }
}

export async function removeCover(
  pageId: string,
  expectedPageRevision: number,
): Promise<CoverMutationResult> {
  try {
    return { ok: true, revision: await clearPageCover(pageId, expectedPageRevision) };
  } catch {
    return {
      ok: false,
      error:
        "Não foi possível remover a capa. Confira seu acesso e recarregue a página antes de tentar novamente.",
    };
  }
}

export async function prepareFileUpload(input: {
  pageId: string;
  name: string;
  type: string;
  size: number;
}): Promise<PreparedFileUpload> {
  const parsed = coverUploadSchema.safeParse(input);
  if (!parsed.success)
    throw new Error("Envie uma imagem PNG, JPEG, WebP ou GIF de até 25 MiB, com nome simples.");
  const client = await createClient(true);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Entre novamente para enviar a capa.");
  const { data: fileId, error } = await client.rpc("prepare_page_file", {
    p_page_id: parsed.data.pageId,
    p_name: parsed.data.name,
    p_mime_type: parsed.data.type,
    p_size: parsed.data.size,
  });
  if (error || !fileId)
    throw new Error("Não foi possível preparar o envio. Confira seu acesso e tente novamente em instantes.");
  const { data: file, error: fileError } = await client
    .from("page_files")
    .select("object_path")
    .eq("id", fileId)
    .single();
  if (fileError || !file) throw new Error("Não foi possível preparar o envio.");
  const { data: upload, error: uploadError } = await client.storage
    .from("page-assets")
    .createSignedUploadUrl(file.object_path, { upsert: false });
  if (uploadError || !upload)
    throw new Error("Não foi possível iniciar o envio. Tente novamente em instantes.");
  return { fileId, path: upload.path, token: upload.token, signedUrl: upload.signedUrl };
}

export async function finalizePageCover(fileId: string, expectedPageRevision: number): Promise<number> {
  const input = z
    .object({ fileId: z.uuid(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
    .safeParse({ fileId, revision: expectedPageRevision });
  if (!input.success) throw new Error("A imagem não pôde ser vinculada à página.");
  const client = await createClient(true);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Entre novamente para salvar a capa.");
  const { data: file, error } = await client
    .from("page_files")
    .select("page_id,workspace_id,object_path,mime_type,expected_size,uploaded_by,status,actual_size,sha256")
    .eq("id", input.data.fileId)
    .single();
  if (
    error ||
    !file ||
    file.uploaded_by !== user.id ||
    file.expected_size < 1 ||
    file.expected_size > MAX_FILE_BYTES
  )
    throw new Error("O envio não está disponível. Confira seu acesso à página.");
  const role = await client.rpc("get_page_role", { p_page_id: file.page_id });
  if (role.error || !["owner", "editor"].includes(role.data ?? ""))
    throw new Error("O envio não está disponível. Confira seu acesso à página.");
  const admin = createAdminClient();
  const reservation = await admin.rpc("reserve_page_file_validation", {
    p_file_id: input.data.fileId,
    p_actor_id: user.id,
  });
  if (reservation.error) throw new Error("O envio não está disponível. Aguarde e tente novamente.");
  if (file.status === "ready") {
    if (file.actual_size === null || !file.sha256) throw new Error("O envio não está disponível.");
    const finalized = await admin.rpc("finalize_page_cover", {
      p_file_id: input.data.fileId,
      p_actor_id: user.id,
      p_expected_revision: input.data.revision,
      p_actual_size: file.actual_size,
      p_sha256: file.sha256,
    });
    if (finalized.error || finalized.data === null)
      throw new Error("A página mudou ou o acesso expirou. Recarregue antes de salvar a capa novamente.");
    revalidatePath(`/w/${file.workspace_id}`, "layout");
    return finalized.data;
  }
  return await withFileValidation(async () => {
    const { data: blob, error: downloadError } = await admin.storage
      .from("page-assets")
      .download(file.object_path);
    if (downloadError || !blob) throw new Error("O envio ainda não terminou. Tente salvar a capa novamente.");
    if (blob.size !== file.expected_size)
      throw new Error("O tamanho da imagem não corresponde ao arquivo informado.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    verifyImageBytes(bytes, file.mime_type, file.expected_size);
    verifyImageDimensions(bytes, file.mime_type);
    const { data: revision, error: finalizeError } = await admin.rpc("finalize_page_cover", {
      p_file_id: input.data.fileId,
      p_actor_id: user.id,
      p_expected_revision: input.data.revision,
      p_actual_size: bytes.length,
      p_sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (finalizeError || revision === null)
      throw new Error("A página mudou ou o acesso expirou. Recarregue antes de salvar a capa novamente.");
    revalidatePath(`/w/${file.workspace_id}`, "layout");
    return revision;
  });
}

export async function clearPageCover(pageId: string, expectedPageRevision: number): Promise<number> {
  const input = z
    .object({ pageId: z.uuid(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
    .safeParse({ pageId, revision: expectedPageRevision });
  if (!input.success) throw new Error("A alteração não é válida. Recarregue a página.");
  const client = await createClient(true);
  const { data, error } = await client.rpc("clear_page_cover", {
    p_page_id: input.data.pageId,
    p_expected_revision: input.data.revision,
  });
  if (error || data === null)
    throw new Error("Não foi possível remover a capa. Confira seu acesso e recarregue a página.");
  return data;
}
