"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import {
  getPendingDraftSession,
  getPendingDrafts,
  type PendingDraft,
  subscribePendingDrafts,
} from "../client/editor-session";
import type { SaveState } from "../model/durable-document-provider";

const empty: readonly PendingDraft[] = Object.freeze([]);
const labels: Record<SaveState, string> = {
  loading: "Carregando",
  dirty: "Alterações locais",
  saving: "Enviando",
  saved: "Salvo",
  error: "Falha ao salvar",
  denied: "Acesso indisponível",
  unsupported: "Atualização necessária",
};

export function PendingDrafts({ userId }: { userId: string }) {
  const drafts = useSyncExternalStore(
    subscribePendingDrafts,
    () => getPendingDrafts(userId),
    () => empty,
  );
  const [message, setMessage] = useState("");
  async function copy(pageId: string) {
    const session = getPendingDraftSession(userId, pageId);
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.draftText());
      setMessage("Rascunho copiado.");
    } catch {
      setMessage("Não foi possível copiar. Volte ao rascunho e tente novamente.");
    }
  }
  if (!drafts.length) return null;
  return (
    <aside className="pending-drafts" aria-label="Rascunhos não confirmados">
      <p>Há alterações não confirmadas em outra página.</p>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.pageId}>
            <span>{labels[draft.state]}</span>
            <Link href={`/w/${draft.workspaceId}/p/${draft.pageId}`}>Voltar ao rascunho</Link>
            <button type="button" onClick={() => void copy(draft.pageId)}>
              Copiar rascunho
            </button>
          </li>
        ))}
      </ul>
      <p role="status">{message}</p>
    </aside>
  );
}
