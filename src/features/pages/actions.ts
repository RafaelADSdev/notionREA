"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/features/auth/validation";
import { pageMetadataSchema, type PageActionState } from "./model/validation";

const revisionSchema = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const optionalId = (value: FormDataEntryValue | null) =>
  value === "" || value === null ? null : uuidSchema.parse(value);
function invalidate(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}`, "layout");
}
function failure(code?: string): PageActionState {
  return {
    error:
      code === "40001"
        ? "Esta página mudou em outra sessão. Recarregue antes de reaplicar sua alteração."
        : "Não foi possível concluir. Confira seu acesso, o destino e tente novamente.",
  };
}

export async function createPage(_previous: PageActionState, form: FormData): Promise<PageActionState> {
  const workspace = uuidSchema.safeParse(form.get("workspaceId"));
  const request = uuidSchema.safeParse(form.get("requestId"));
  const title = z
    .string()
    .max(500)
    .safeParse(form.get("title") ?? "");
  let parent: string | null;
  try {
    parent = optionalId(form.get("parentId"));
  } catch {
    return failure();
  }
  if (!workspace.success || !request.success || !title.success) return failure();
  const client = await createClient(true);
  const { data, error } = await client.rpc("create_page", {
    p_workspace_id: workspace.data,
    ...(parent ? { p_parent_id: parent } : {}),
    p_title: title.data,
    p_request_id: request.data,
  });
  if (error || !data) return failure(error?.code);
  invalidate(workspace.data);
  return { createdPageId: data };
}

export async function savePageMetadata(_previous: PageActionState, form: FormData): Promise<PageActionState> {
  const page = uuidSchema.safeParse(form.get("pageId"));
  const workspace = uuidSchema.safeParse(form.get("workspaceId"));
  const revision = revisionSchema.safeParse(form.get("revision"));
  const metadata = pageMetadataSchema.safeParse({ title: form.get("title"), icon: form.get("icon") });
  if (!page.success || !workspace.success || !revision.success || !metadata.success)
    return { error: "Use título de até 500 caracteres e, se quiser, um único emoji." };
  const client = await createClient(true);
  const { error } = await client.rpc("update_page", {
    p_page_id: page.data,
    p_expected_revision: revision.data,
    p_patch: metadata.data,
  });
  if (error) return failure(error.code);
  invalidate(workspace.data);
  return { message: "Página atualizada." };
}

export async function movePage(_previous: PageActionState, form: FormData): Promise<PageActionState> {
  const page = uuidSchema.safeParse(form.get("pageId"));
  const workspace = uuidSchema.safeParse(form.get("workspaceId"));
  const revision = revisionSchema.safeParse(form.get("revision"));
  let parent: string | null;
  let before: string | null;
  try {
    parent = optionalId(form.get("parentId"));
    before = optionalId(form.get("beforeId"));
  } catch {
    return failure();
  }
  if (!page.success || !workspace.success || !revision.success) return failure();
  const client = await createClient(true);
  const { data, error } = await client.rpc("move_page", {
    p_page_id: page.data,
    ...(parent ? { p_parent_id: parent } : {}),
    ...(before ? { p_before_id: before } : {}),
    p_expected_revision: revision.data,
    p_accept_acl_change: form.get("confirmAccess") === "on",
    p_keep_parent: form.get("keepParent") === "on",
    ...(typeof form.get("previewHash") === "string"
      ? { p_preview_hash: String(form.get("previewHash")) }
      : {}),
  });
  if (error) return failure(error.code);
  const result = z
    .object({
      moved: z.boolean(),
      requires_confirmation: z.boolean(),
      affected_pages: z.number(),
      preview_hash: z.string().nullable(),
    })
    .safeParse(data);
  if (!result.success) return failure();
  if (result.data.requires_confirmation)
    return {
      requiresConfirmation: true,
      affectedPages: result.data.affected_pages,
      ...(result.data.preview_hash ? { previewHash: result.data.preview_hash } : {}),
      message: "O destino muda quem pode acessar esta página ou suas filhas. Revise e confirme para mover.",
    };
  invalidate(workspace.data);
  return { message: "Página movida." };
}

export async function trashPage(_previous: PageActionState, form: FormData): Promise<PageActionState> {
  const page = uuidSchema.safeParse(form.get("pageId"));
  const workspace = uuidSchema.safeParse(form.get("workspaceId"));
  const revision = revisionSchema.safeParse(form.get("revision"));
  if (!page.success || !workspace.success || !revision.success || form.get("confirmTrash") !== "on")
    return { error: "Confirme a remoção da página e das suas filhas." };
  const client = await createClient(true);
  const { error } = await client.rpc("remove_page", {
    p_page_id: page.data,
    p_expected_revision: revision.data,
  });
  if (error) return failure(error.code);
  invalidate(workspace.data);
  redirect(`/w/${workspace.data}/trash`);
}

export async function restorePage(_previous: PageActionState, form: FormData): Promise<PageActionState> {
  const page = uuidSchema.safeParse(form.get("pageId"));
  const workspace = uuidSchema.safeParse(form.get("workspaceId"));
  const revision = revisionSchema.safeParse(form.get("revision"));
  let parent: string | null;
  try {
    parent = optionalId(form.get("parentId"));
  } catch {
    return failure();
  }
  if (!page.success || !workspace.success || !revision.success) return failure();
  const client = await createClient(true);
  const { data, error } = await client.rpc("restore_page", {
    p_page_id: page.data,
    ...(parent ? { p_parent_id: parent } : {}),
    p_restore_original: form.get("originalParent") === "on",
    p_expected_revision: revision.data,
    p_accept_acl_change: form.get("confirmAccess") === "on",
    ...(typeof form.get("previewHash") === "string"
      ? { p_preview_hash: String(form.get("previewHash")) }
      : {}),
  });
  if (error || !data)
    return {
      error:
        "Não foi possível restaurar neste destino. Escolha a raiz ou uma página ativa em que você possa organizar o conteúdo.",
    };
  const result = z
    .object({
      restored: z.boolean(),
      requires_confirmation: z.boolean(),
      affected_pages: z.number(),
      preview_hash: z.string().nullable(),
    })
    .safeParse(data);
  if (!result.success) return failure();
  if (result.data.requires_confirmation)
    return {
      requiresConfirmation: true,
      affectedPages: result.data.affected_pages,
      ...(result.data.preview_hash ? { previewHash: result.data.preview_hash } : {}),
      message: "Restaurar neste local muda quem pode acessar a página. Revise o destino e confirme.",
    };
  invalidate(workspace.data);
  redirect(`/w/${workspace.data}/p/${page.data}`);
}

export async function favoritePage(pageId: string, workspaceId: string): Promise<boolean> {
  uuidSchema.parse(pageId);
  uuidSchema.parse(workspaceId);
  const client = await createClient(true);
  const { data, error } = await client.rpc("toggle_page_favorite", { p_page_id: pageId });
  if (error) throw new Error("Não foi possível atualizar o favorito.");
  invalidate(workspaceId);
  return data;
}
