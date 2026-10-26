"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import {
  invitationTokenSchema,
  inviteEmailSchema,
  uuidSchema,
  workspaceNameSchema,
} from "@/features/auth/validation";
import type { ActionState } from "@/features/auth/action-state";

export async function createWorkspace(_previous: ActionState, form: FormData): Promise<ActionState> {
  const name = workspaceNameSchema.safeParse(form.get("name"));
  const requestId = uuidSchema.safeParse(form.get("requestId"));
  if (!name.success || !requestId.success)
    return { error: "Dê um nome de até 80 caracteres ao seu workspace." };
  const client = await createClient(true);
  const { data, error } = await client.rpc("create_workspace", {
    p_name: name.data,
    p_request_id: requestId.data,
  });
  if (error || !data)
    return { error: "Não foi possível criar o workspace. Entre novamente e tente outra vez." };
  redirect(`/w/${data}`);
}

export async function createInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {
  const workspaceId = uuidSchema.safeParse(form.get("workspaceId"));
  const email = inviteEmailSchema.safeParse(form.get("email"));
  if (!workspaceId.success || !email.success) return { error: "Informe um e-mail válido para o convite." };
  const client = await createClient(true);
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const { error } = await client.rpc("create_invite", {
    p_workspace_id: workspaceId.data,
    p_email: email.data,
    p_token_hash: hash,
  });
  if (error) return { error: "Não foi possível criar o convite. Confira seu acesso e tente novamente." };
  revalidatePath(`/w/${workspaceId.data}/members`);
  return {
    message: "Convite criado. Compartilhe o link com a pessoa indicada; ele vale por sete dias.",
    invitationUrl: `${getEnvironment().APP_URL}/join#${token}`,
  };
}

export async function acceptInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {
  const token = invitationTokenSchema.safeParse(form.get("token"));
  if (!token.success) return { error: "O convite não é válido. Peça um novo link ao administrador." };
  const client = await createClient(true);
  const { data, error } = await client.rpc("accept_invite", { p_token: token.data });
  if (error || !data)
    return {
      error:
        "Não foi possível aceitar. Entre com o e-mail convidado e confirmado, ou peça um novo convite se ele expirou.",
    };
  redirect(`/w/${data}`);
}

export async function changeMember(_previous: ActionState, form: FormData): Promise<ActionState> {
  const workspaceId = uuidSchema.safeParse(form.get("workspaceId"));
  const userId = uuidSchema.safeParse(form.get("userId"));
  const operation = z.enum(["owner", "member", "remove"]).safeParse(form.get("operation"));
  if (!workspaceId.success || !userId.success || !operation.success)
    return { error: "A alteração não é válida. Recarregue a página." };
  const client = await createClient(true);
  const result =
    operation.data === "remove"
      ? await client.rpc("remove_member", { p_workspace_id: workspaceId.data, p_user_id: userId.data })
      : await client.rpc("set_member_role", {
          p_workspace_id: workspaceId.data,
          p_user_id: userId.data,
          p_role: operation.data,
        });
  if (result.error)
    return { error: "Não foi possível alterar o membro. Mantenha pelo menos um administrador no workspace." };
  const {
    data: { user },
  } = await client.auth.getUser();
  if (user?.id === userId.data && operation.data === "remove") redirect("/");
  revalidatePath(`/w/${workspaceId.data}`, "layout");
  return { message: "Acesso atualizado." };
}
