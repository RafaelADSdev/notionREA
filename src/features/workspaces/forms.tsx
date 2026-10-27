"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/features/auth/action-state";
import { useTranslations } from "@/lib/i18n/client";
import { acceptInvitation, changeMember, createInvitation, createWorkspace } from "./actions";

function Feedback({ state }: { state: ActionState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.message) ref.current?.focus();
  }, [state]);
  return state.error || state.message ? (
    <div
      ref={ref}
      tabIndex={-1}
      role={state.error ? "alert" : "status"}
      className={`form-feedback${state.error ? " error" : ""}`}
    >
      {state.error ?? state.message}
    </div>
  ) : null;
}

export function WorkspaceForm({ requestId }: { requestId: string }) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(createWorkspace, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="field">
        {t("workspaces.name")}
        <input
          name="name"
          required
          maxLength={80}
          placeholder={t("workspaces.namePlaceholder")}
          autoComplete="organization"
        />
      </label>
      <Feedback state={state} />
      <button type="submit" className="button" disabled={pending}>
        {pending ? t("common.creating") : t("workspaces.create")}
      </button>
      <p className="notice">{t("workspaces.ownerNotice")}</p>
    </form>
  );
}

export function InvitationForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(createInvitation, {});
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    if (!state.invitationUrl) return;
    try {
      await navigator.clipboard.writeText(state.invitationUrl);
      setCopied(true);
    } catch {
      input.current?.focus();
      input.current?.select();
    }
  }
  return (
    <>
      <form action={action} className="inline-form">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <label className="field">
          {t("workspaces.personEmail")}
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder={t("workspaces.personEmailPlaceholder")}
            autoComplete="off"
          />
        </label>
        <button type="submit" className="button" disabled={pending}>
          {pending ? t("common.creating") : t("workspaces.createInvite")}
        </button>
      </form>
      <div style={{ marginTop: 16 }}>
        <Feedback state={state} />
      </div>
      {state.invitationUrl && (
        <div className="invitation-link">
          <label className="field">
            {t("workspaces.inviteLink")}
            <input
              ref={input}
              aria-label={t("workspaces.inviteLink")}
              readOnly
              value={state.invitationUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button type="button" className="button quiet" onClick={copy} style={{ marginTop: 12 }}>
            {copied ? t("common.linkCopied") : t("common.copyLink")}
          </button>
        </div>
      )}
    </>
  );
}

export function MemberForm({
  workspaceId,
  userId,
  email,
  role,
}: {
  workspaceId: string;
  userId: string;
  email: string;
  role: string;
}) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(changeMember, {});
  return (
    <>
      <form action={action} className="inline-form">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="userId" value={userId} />
        <select
          name="operation"
          defaultValue={role}
          aria-label={t("workspaces.memberAccessName", { name: email })}
        >
          <option value="owner">{t("common.administrator")}</option>
          <option value="member">{t("common.member")}</option>
          <option value="remove">{t("workspaces.removeAccess")}</option>
        </select>
        <button
          type="submit"
          className="button quiet"
          disabled={pending}
          aria-label={t("workspaces.saveMemberAccessName", { name: email })}
        >
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </form>
      <Feedback state={state} />
    </>
  );
}

export function AcceptInvitationForm({ token }: { token: string }) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(acceptInvitation, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="token" value={token} />
      <Feedback state={state} />
      <button className="button" type="submit" disabled={pending || !token}>
        {pending ? "Confirmando…" : t("workspaces.acceptInvite")}
      </button>
    </form>
  );
}
