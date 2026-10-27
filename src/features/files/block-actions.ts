"use server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PreparedFileUpload } from "./actions";
import { verifyImageDimensions } from "./image-dimensions";
import type { PageFileInfo } from "./types";
import { blockUploadSchema, MAX_FILE_BYTES } from "./validation";
import { withFileValidation } from "./validation-slots";

export type { PageFileInfo } from "./types";

type BlockUploadInput = { pageId: string; name: string; type: string; size: number; kind: "image" | "file" };
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const failed =
  "Não foi possível confirmar o arquivo. Confira seu acesso e tente novamente. Imagens devem ter até 30 megapixels e arquivos até 25 MiB.";

export async function prepareBlockUpload(input: BlockUploadInput): Promise<Result<PreparedFileUpload>> {
  try {
    const parsed = blockUploadSchema.parse(input);
    const client = await createClient(true);
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) throw new Error("Upload unavailable");
    const { data: fileId, error } = await client.rpc("prepare_block_file", {
      p_page_id: parsed.pageId,
      p_name: parsed.name,
      p_mime_type: parsed.type,
      p_size: parsed.size,
      p_kind: parsed.kind,
    });
    if (error || !fileId) throw new Error("Upload unavailable");
    const file = await client.from("page_files").select("object_path").eq("id", fileId).single();
    if (file.error || !file.data) throw new Error("Upload unavailable");
    const upload = await client.storage
      .from("page-assets")
      .createSignedUploadUrl(file.data.object_path, { upsert: false });
    if (upload.error || !upload.data) throw new Error("Upload unavailable");
    return {
      ok: true,
      value: { fileId, path: upload.data.path, token: upload.data.token, signedUrl: upload.data.signedUrl },
    };
  } catch {
    return {
      ok: false,
      error:
        "Não foi possível preparar o envio. Use PNG, JPEG, WebP ou GIF para imagens e arquivos de até 25 MiB. Confira seu acesso e tente novamente.",
    };
  }
}
export async function finishBlockUpload(fileId: string): Promise<Result<PageFileInfo>> {
  try {
    const id = z.uuid().parse(fileId);
    const client = await createClient(true);
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) throw new Error("Upload unavailable");
    const { data: file, error } = await client
      .from("page_files")
      .select(
        "page_id,workspace_id,object_path,original_name,mime_type,expected_size,uploaded_by,purpose,status,actual_size,sha256,image_width,image_height",
      )
      .eq("id", id)
      .single();
    if (
      error ||
      !file ||
      file.uploaded_by !== user.id ||
      file.purpose !== "block" ||
      file.expected_size < 1 ||
      file.expected_size > MAX_FILE_BYTES
    )
      throw new Error("Upload unavailable");
    const role = await client.rpc("get_page_role", { p_page_id: file.page_id });
    if (role.error || !["owner", "editor"].includes(role.data ?? "")) throw new Error("Upload unavailable");
    const admin = createAdminClient();
    const reservation = await admin.rpc("reserve_page_file_validation", {
      p_file_id: id,
      p_actor_id: user.id,
    });
    if (reservation.error) throw new Error("Upload unavailable");
    if (file.status === "ready") {
      if (file.actual_size === null || !file.sha256) throw new Error("Upload unavailable");
      const finalized = await admin.rpc("finalize_page_block_file", {
        p_file_id: id,
        p_actor_id: user.id,
        p_actual_size: file.actual_size,
        p_sha256: file.sha256,
        ...(file.image_width !== null && file.image_height !== null
          ? { p_width: file.image_width, p_height: file.image_height }
          : {}),
      });
      if (finalized.error || finalized.data !== id) throw new Error("Upload unavailable");
      return {
        ok: true,
        value: {
          fileId: id,
          name: file.original_name,
          mimeType: file.mime_type,
          size: file.actual_size,
          width: file.image_width,
          height: file.image_height,
        },
      };
    }
    return await withFileValidation(async () => {
      const downloaded = await admin.storage.from("page-assets").download(file.object_path);
      if (downloaded.error || !downloaded.data || downloaded.data.size !== file.expected_size)
        throw new Error("Upload unavailable");
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      const dimensions =
        file.mime_type === "application/octet-stream" ? null : verifyImageDimensions(bytes, file.mime_type);
      const finalized = await admin.rpc("finalize_page_block_file", {
        p_file_id: id,
        p_actor_id: user.id,
        p_actual_size: bytes.length,
        p_sha256: createHash("sha256").update(bytes).digest("hex"),
        ...(dimensions ? { p_width: dimensions.width, p_height: dimensions.height } : {}),
      });
      if (finalized.error || finalized.data !== id) throw new Error("Upload unavailable");
      return {
        ok: true,
        value: {
          fileId: id,
          name: file.original_name,
          mimeType: file.mime_type,
          size: bytes.length,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
        },
      };
    });
  } catch {
    return { ok: false, error: failed };
  }
}
