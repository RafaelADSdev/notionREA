"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "@/lib/i18n/server";
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
  const t = await getTranslations();

  try {
    return { ok: true, value: await prepareFileUpload(input) };
  } catch {
    return {
      ok: false,
      error: t("files.coverPrepareFailure"),
    };
  }
}

export async function finishCoverUpload(
  fileId: string,
  expectedPageRevision: number,
): Promise<CoverMutationResult> {
  const t = await getTranslations();

  try {
    return { ok: true, revision: await finalizePageCover(fileId, expectedPageRevision) };
  } catch {
    return {
      ok: false,
      error: t("files.coverConfirmFailure"),
    };
  }
}

export async function removeCover(
  pageId: string,
  expectedPageRevision: number,
): Promise<CoverMutationResult> {
  const t = await getTranslations();

  try {
    return { ok: true, revision: await clearPageCover(pageId, expectedPageRevision) };
  } catch {
    return {
      ok: false,
      error: t("files.coverRemoveFailure"),
    };
  }
}

export async function prepareFileUpload(input: {
  pageId: string;
  name: string;
  type: string;
  size: number;
}): Promise<PreparedFileUpload> {
  const t = await getTranslations();

  const parsed = coverUploadSchema.safeParse(input);
  if (!parsed.success) throw new Error(t("files.coverRequirementsName"));
  const client = await createClient(true);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error(t("files.signInUpload"));
  const { data: fileId, error } = await client.rpc("prepare_page_file", {
    p_page_id: parsed.data.pageId,
    p_name: parsed.data.name,
    p_mime_type: parsed.data.type,
    p_size: parsed.data.size,
  });
  if (error || !fileId) throw new Error(t("files.prepareAccessFailure"));
  const { data: file, error: fileError } = await client
    .from("page_files")
    .select("object_path")
    .eq("id", fileId)
    .single();
  if (fileError || !file) throw new Error(t("files.prepareFailure"));
  const { data: upload, error: uploadError } = await client.storage
    .from("page-assets")
    .createSignedUploadUrl(file.object_path, { upsert: false });
  if (uploadError || !upload) throw new Error(t("files.startFailure"));
  return { fileId, path: upload.path, token: upload.token, signedUrl: upload.signedUrl };
}

export async function finalizePageCover(fileId: string, expectedPageRevision: number): Promise<number> {
  const t = await getTranslations();

  const input = z
    .object({ fileId: z.uuid(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
    .safeParse({ fileId, revision: expectedPageRevision });
  if (!input.success) throw new Error(t("files.imageLinkFailure"));
  const client = await createClient(true);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error(t("files.signInSaveCover"));
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
    throw new Error(t("files.uploadAccessFailure"));
  const role = await client.rpc("get_page_role", { p_page_id: file.page_id });
  if (role.error || !["owner", "editor"].includes(role.data ?? ""))
    throw new Error(t("files.uploadAccessFailure"));
  const admin = createAdminClient();
  const reservation = await admin.rpc("reserve_page_file_validation", {
    p_file_id: input.data.fileId,
    p_actor_id: user.id,
  });
  if (reservation.error) throw new Error(t("files.uploadWaitFailure"));
  if (file.status === "ready") {
    if (file.actual_size === null || !file.sha256) throw new Error(t("files.uploadUnavailable"));
    const finalized = await admin.rpc("finalize_page_cover", {
      p_file_id: input.data.fileId,
      p_actor_id: user.id,
      p_expected_revision: input.data.revision,
      p_actual_size: file.actual_size,
      p_sha256: file.sha256,
    });
    if (finalized.error || finalized.data === null) throw new Error(t("files.coverConflict"));
    revalidatePath(`/w/${file.workspace_id}`, "layout");
    return finalized.data;
  }
  return await withFileValidation(async () => {
    const { data: blob, error: downloadError } = await admin.storage
      .from("page-assets")
      .download(file.object_path);
    if (downloadError || !blob) throw new Error(t("files.uploadIncomplete"));
    if (blob.size !== file.expected_size) throw new Error(t("files.imageSizeMismatch"));
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
    if (finalizeError || revision === null) throw new Error(t("files.coverConflict"));
    revalidatePath(`/w/${file.workspace_id}`, "layout");
    return revision;
  });
}

export async function clearPageCover(pageId: string, expectedPageRevision: number): Promise<number> {
  const t = await getTranslations();

  const input = z
    .object({ pageId: z.uuid(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
    .safeParse({ pageId, revision: expectedPageRevision });
  if (!input.success) throw new Error(t("workspaces.invalidChange"));
  const client = await createClient(true);
  const { data, error } = await client.rpc("clear_page_cover", {
    p_page_id: input.data.pageId,
    p_expected_revision: input.data.revision,
  });
  if (error || data === null) throw new Error(t("files.removeAccessFailure"));
  return data;
}
