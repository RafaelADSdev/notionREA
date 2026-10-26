"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createWorkspace, createInvitation, changeMember, acceptInvitation } from "./actions";
import type { ActionState } from "@/features/auth/action-state";

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
  const [state, action, pending] = useActionState(createWorkspace, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="field">
        Nome do workspace
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Por exemplo, Estúdio Horizonte"
          autoComplete="organization"
        />
      </label>
      <Feedback state={state} />
      <button type="submit" className="button" disabled={pending}>
        {pending ? "Criando…" : "Criar workspace"}
      </button>
      <p className="notice">
        Você será o administrador. Administradores podem gerenciar os membros e todo o conteúdo deste
        workspace.
      </p>
    </form>
  );
}

export function InvitationForm({ workspaceId }: { workspaceId: string }) {
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
          E-mail da pessoa
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="pessoa@exemplo.com"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Criando…" : "Criar convite"}
        </button>
      </form>
      <div style={{ marginTop: 16 }}>
        <Feedback state={state} />
      </div>
      {state.invitationUrl && (
        <div className="invitation-link">
          <label className="field">
            Link do convite
            <input
              ref={input}
              aria-label="Link do convite"
              readOnly
              value={state.invitationUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button type="button" className="button quiet" onClick={copy} style={{ marginTop: 12 }}>
            {copied ? "Link copiado" : "Copiar link"}
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
  const [state, action, pending] = useActionState(changeMember, {});
  return (
    <>
      <form action={action} className="inline-form">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="userId" value={userId} />
        <select name="operation" defaultValue={role} aria-label={`Acesso de ${email}`}>
          <option value="owner">Administrador</option>
          <option value="member">Membro</option>
          <option value="remove">Remover acesso</option>
        </select>
        <button
          type="submit"
          className="button quiet"
          disabled={pending}
          aria-label={`Salvar acesso de ${email}`}
        >
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </form>
      <Feedback state={state} />
    </>
  );
}

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="token" value={token} />
      <Feedback state={state} />
      <button className="button" type="submit" disabled={pending || !token}>
        {pending ? "Confirmando…" : "Aceitar convite"}
      </button>
    </form>
  );
}
