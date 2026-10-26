"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import { credentialsSchema, inviteEmailSchema, safeRedirect } from "./validation";
import type { ActionState } from "./action-state";

export async function signIn(_previous: ActionState, form: FormData): Promise<ActionState> {
  const input = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success)
    return { error: "Confira o e-mail e a senha. A senha deve ter entre 12 e 128 caracteres." };
  const client = await createClient(true);
  const { error } = await client.auth.signInWithPassword(input.data);
  if (error)
    return {
      error:
        "Não foi possível entrar. Confira os dados e confirme seu e-mail; se precisar, redefina a senha.",
    };
  redirect(safeRedirect(typeof form.get("next") === "string" ? String(form.get("next")) : null));
}

export async function signUp(_previous: ActionState, form: FormData): Promise<ActionState> {
  const input = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success) return { error: "Use um e-mail válido e uma senha entre 12 e 128 caracteres." };
  const client = await createClient(true);
  const { error } = await client.auth.signUp({
    ...input.data,
    options: { emailRedirectTo: `${getEnvironment().APP_URL}/auth/callback` },
  });
  if (error) return { error: "Não foi possível criar a conta agora. Tente novamente em alguns instantes." };
  return { message: "Confira seu e-mail para confirmar a conta. Depois, entre com sua senha." };
}

export async function requestPasswordReset(_previous: ActionState, form: FormData): Promise<ActionState> {
  const email = inviteEmailSchema.safeParse(form.get("email"));
  if (!email.success) return { error: "Informe um e-mail válido." };
  const client = await createClient(true);
  const { error } = await client.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${getEnvironment().APP_URL}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: "Não foi possível enviar agora. Aguarde um pouco e tente novamente." };
  return { message: "Se houver uma conta com esse e-mail, você receberá um link para redefinir a senha." };
}

export async function updatePassword(_previous: ActionState, form: FormData): Promise<ActionState> {
  const password = form.get("password");
  if (typeof password !== "string" || password.length < 12 || password.length > 128)
    return { error: "Escolha uma senha entre 12 e 128 caracteres." };
  if (password !== form.get("passwordConfirmation")) return { error: "As senhas precisam ser iguais." };
  const client = await createClient(true);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { error: "Este link expirou. Solicite outro link para redefinir sua senha." };
  const { error } = await client.auth.updateUser({ password });
  if (error) return { error: "Não foi possível alterar a senha. Solicite um novo link e tente novamente." };
  redirect("/");
}

export async function signInGoogle(): Promise<ActionState> {
  const environment = getEnvironment();
  if (environment.GOOGLE_AUTH_ENABLED !== "true")
    return { error: "A entrada com Google está indisponível. Entre com seu e-mail." };
  const client = await createClient(true);
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${environment.APP_URL}/auth/callback` },
  });
  if (error || !data.url || new URL(data.url).origin !== new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin)
    return { error: "Não foi possível iniciar a entrada com Google. Tente novamente." };
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const client = await createClient(true);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error("Não foi possível sair. Tente novamente.");
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
