"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/features/auth/action-state";
import {
  invitationTokenSchema,
  inviteEmailSchema,
  uuidSchema,
  workspaceNameSchema,
} from "@/features/auth/validation";
import { getEnvironment } from "@/lib/env";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function createWorkspace(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const name = workspaceNameSchema.safeParse(form.get("name"));
  const requestId = uuidSchema.safeParse(form.get("requestId"));
  if (!name.success || !requestId.success) return { error: t("workspaces.nameLength") };
  const client = await createClient(true);
  const { data, error } = await client.rpc("create_workspace", {
    p_name: name.data,
    p_request_id: requestId.data,
  });
  if (error || !data) return { error: t("workspaces.createFailed") };
  redirect(`/w/${data}`);
}

export async function createInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const workspaceId = uuidSchema.safeParse(form.get("workspaceId"));
  const email = inviteEmailSchema.safeParse(form.get("email"));
  if (!workspaceId.success || !email.success) return { error: t("workspaces.inviteEmail") };
  const client = await createClient(true);
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const { error } = await client.rpc("create_invite", {
    p_workspace_id: workspaceId.data,
    p_email: email.data,
    p_token_hash: hash,
  });
  if (error) return { error: t("workspaces.inviteFailed") };
  revalidatePath(`/w/${workspaceId.data}/members`);
  return {
    message: t("workspaces.inviteCreated"),
    invitationUrl: `${getEnvironment().APP_URL}/join#${token}`,
  };
}

export async function acceptInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const token = invitationTokenSchema.safeParse(form.get("token"));
  if (!token.success) return { error: t("workspaces.invalidInvite") };
  const client = await createClient(true);
  const { data, error } = await client.rpc("accept_invite", { p_token: token.data });
  if (error || !data)
    return {
      error: t("workspaces.acceptFailed"),
    };
  redirect(`/w/${data}`);
}

export async function changeMember(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const workspaceId = uuidSchema.safeParse(form.get("workspaceId"));
  const userId = uuidSchema.safeParse(form.get("userId"));
  const operation = z.enum(["owner", "member", "remove"]).safeParse(form.get("operation"));
  if (!workspaceId.success || !userId.success || !operation.success)
    return { error: t("workspaces.invalidChange") };
  const client = await createClient(true);
  const result =
    operation.data === "remove"
      ? await client.rpc("remove_member", { p_workspace_id: workspaceId.data, p_user_id: userId.data })
      : await client.rpc("set_member_role", {
          p_workspace_id: workspaceId.data,
          p_user_id: userId.data,
          p_role: operation.data,
        });
  if (result.error) return { error: t("workspaces.memberChangeFailed") };
  const {
    data: { user },
  } = await client.auth.getUser();
  if (user?.id === userId.data && operation.data === "remove") redirect("/");
  revalidatePath(`/w/${workspaceId.data}`, "layout");
  return { message: t("workspaces.accessUpdated") };
}
