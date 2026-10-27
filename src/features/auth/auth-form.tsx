"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "@/lib/i18n/client";
import type { ActionState } from "./action-state";
import { requestPasswordReset, signIn, signInGoogle, signUp, updatePassword } from "./actions";

const actions = { login: signIn, register: signUp, forgot: requestPasswordReset, reset: updatePassword };

export function AuthForm({
  mode,
  next = "/",
  googleEnabled = false,
}: {
  mode: keyof typeof actions;
  next?: string;
  googleEnabled?: boolean;
}) {
  const t = useTranslations();

  const labels = {
    login: t("auth.signIn"),
    register: t("auth.createAccount"),
    forgot: t("auth.sendLink"),
    reset: t("auth.savePassword"),
  };
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
            {t("common.email")}
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t("auth.emailPlaceholder")}
              required
              maxLength={254}
            />
          </label>
        )}
        {mode !== "forgot" && (
          <div className="field">
            <label htmlFor="password">{mode === "reset" ? t("auth.newPassword") : t("auth.password")}</label>
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
            {mode !== "login" && <small id="password-hint">{t("auth.passwordHint")}</small>}
          </div>
        )}
        {mode === "reset" && (
          <label className="field">
            {t("auth.repeatPassword")}
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
          {pending ? t("common.wait") : labels[mode]}
        </button>
      </form>
      {mode === "login" && (
        <>
          <div className="form-links">
            <Link href="/forgot-password">{t("auth.forgotPassword")}</Link>
            <Link href="/register">{t("auth.createAnAccount")}</Link>
          </div>
          {googleEnabled && (
            <>
              <div className="form-divider">{t("common.or")}</div>
              <form action={googleAction}>
                <button
                  type="submit"
                  className="button secondary"
                  style={{ width: "100%" }}
                  disabled={googlePending}
                >
                  {googlePending ? t("common.opening") : t("auth.continueGoogle")}
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
          <Link href="/login">{t("auth.backToSignIn")}</Link>
        </p>
      )}
    </>
  );
}
