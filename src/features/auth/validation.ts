import { z } from "zod";

export const inviteEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const credentialsSchema = z.object({
  email: inviteEmailSchema,
  password: z.string().min(12).max(128),
});
export const workspaceNameSchema = z.string().trim().min(1).max(80);
export const uuidSchema = z.uuid();
export const invitationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

export function safeRedirect(value: string | null): "/" | "/reset-password" | "/join" {
  return value === "/reset-password" || value === "/join" ? value : "/";
}
