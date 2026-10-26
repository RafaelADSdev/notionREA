"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { signIn, signUp, requestPasswordReset, updatePassword, signInGoogle } from "./actions";
import type { ActionState } from "./action-state";

const actions = { login: signIn, register: signUp, forgot: requestPasswordReset, reset: updatePassword };
const labels = {
  login: "Entrar",
  register: "Criar conta",
  forgot: "Enviar link",
  reset: "Salvar nova senha",
};

export function AuthForm({
  mode,
  next = "/",
  googleEnabled = false,
}: {
  mode: keyof typeof actions;
  next?: string;
  googleEnabled?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(actions[mode], {});
  const [googleState, googleAction, googlePending] = useActionState(signInGoogle, {});
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.message) feedback.current?.focus();
  }, [state]);
  return (
    <>
      <form action={action} className="form-stack">
        <input type="hidden" name="next" value={next} />
        {mode !== "reset" && (
          <label className="field">
            E-mail
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="voce@exemplo.com"
              required
              maxLength={254}
            />
          </label>
        )}
        {mode !== "forgot" && (
          <div className="field">
            <label htmlFor="password">{mode === "reset" ? "Nova senha" : "Senha"}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={12}
              maxLength={128}
              aria-describedby={mode === "login" ? undefined : "password-hint"}
            />
            {mode !== "login" && (
              <small id="password-hint">Entre 12 e 128 caracteres. Use uma senha exclusiva.</small>
            )}
          </div>
        )}
        {mode === "reset" && (
          <label className="field">
            Repita a nova senha
            <input
              name="passwordConfirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
        )}
        {(state.error || state.message) && (
          <div
            ref={feedback}
            tabIndex={-1}
            role={state.error ? "alert" : "status"}
            className={`form-feedback${state.error ? " error" : ""}`}
          >
            {state.error ?? state.message}
          </div>
        )}
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Aguarde…" : labels[mode]}
        </button>
      </form>
      {mode === "login" && (
        <>
          <div className="form-links">
            <Link href="/forgot-password">Esqueci minha senha</Link>
            <Link href="/register">Criar uma conta</Link>
          </div>
          {googleEnabled && (
            <>
              <div className="form-divider">ou</div>
              <form action={googleAction}>
                <button
                  type="submit"
                  className="button secondary"
                  style={{ width: "100%" }}
                  disabled={googlePending}
                >
                  {googlePending ? "Abrindo…" : "Continuar com Google"}
                </button>
                {googleState.error && (
                  <p role="alert" className="form-feedback error">
                    {googleState.error}
                  </p>
                )}
              </form>
            </>
          )}
        </>
      )}
      {mode !== "login" && (
        <p className="form-footer">
          <Link href="/login">Voltar para entrar</Link>
        </p>
      )}
    </>
  );
}
