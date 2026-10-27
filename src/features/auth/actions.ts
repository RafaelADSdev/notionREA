"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./action-state";
import { credentialsSchema, inviteEmailSchema, safeRedirect } from "./validation";

export async function signIn(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const input = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success) return { error: t("auth.checkCredentials") };
  const client = await createClient(true);
  const { error } = await client.auth.signInWithPassword(input.data);
  if (error)
    return {
      error: t("auth.signInFailed"),
    };
  redirect(safeRedirect(typeof form.get("next") === "string" ? String(form.get("next")) : null));
}

export async function signUp(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const input = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success) return { error: t("auth.validCredentials") };
  const client = await createClient(true);
  const { error } = await client.auth.signUp({
    ...input.data,
    options: { emailRedirectTo: `${getEnvironment().APP_URL}/auth/callback` },
  });
  if (error) return { error: t("auth.signUpFailed") };
  return { message: t("auth.confirmEmail") };
}

export async function requestPasswordReset(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const email = inviteEmailSchema.safeParse(form.get("email"));
  if (!email.success) return { error: t("auth.validEmail") };
  const client = await createClient(true);
  const { error } = await client.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${getEnvironment().APP_URL}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: t("auth.resetSendFailed") };
  return { message: t("auth.resetSent") };
}

export async function updatePassword(_previous: ActionState, form: FormData): Promise<ActionState> {
  const t = await getTranslations();

  const password = form.get("password");
  if (typeof password !== "string" || password.length < 12 || password.length > 128)
    return { error: t("auth.passwordLength") };
  if (password !== form.get("passwordConfirmation")) return { error: t("auth.passwordsMatch") };
  const client = await createClient(true);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { error: t("auth.resetExpired") };
  const { error } = await client.auth.updateUser({ password });
  if (error) return { error: t("auth.resetFailed") };
  redirect("/");
}

export async function signInGoogle(): Promise<ActionState> {
  const t = await getTranslations();

  const environment = getEnvironment();
  if (environment.GOOGLE_AUTH_ENABLED !== "true") return { error: t("auth.googleUnavailable") };
  const client = await createClient(true);
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${environment.APP_URL}/auth/callback` },
  });
  if (error || !data.url || new URL(data.url).origin !== new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin)
    return { error: t("auth.googleFailed") };
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const t = await getTranslations();

  const client = await createClient(true);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error(t("auth.signOutFailed"));
  redirect("/login");
}

export async function saveTheme(input: "system" | "light" | "dark"): Promise<void> {
  const theme = z.enum(["system", "light", "dark"]).parse(input);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  (await cookies()).set(`bloco-theme-${user?.id ?? "anon"}`, theme, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(getEnvironment().APP_URL).protocol === "https:",
    path: "/",
    maxAge: 31536000,
  });
}
