"use client";
import { useState, useSyncExternalStore } from "react";
import type { EditorSession } from "../client/editor-session";
import type { SaveState } from "../model/durable-document-provider";

const labels: Record<SaveState, string> = {
  loading: "Carregando",
  dirty: "Alterações locais",
  saving: "Enviando",
  saved: "Salvo",
  error: "Falha ao salvar. Seu rascunho continua nesta sessão.",
  denied: "Acesso indisponível. Seu rascunho não foi descartado.",
  unsupported: "Atualize o aplicativo para abrir esta versão do documento.",
};
export function PageEditorStatus({ session }: { session: EditorSession }) {
  const status = useSyncExternalStore<SaveState>(session.subscribeStatus, session.getStatus, () => "loading");
  const [message, setMessage] = useState("");
  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(session.draftText());
      setMessage("Rascunho copiado.");
    } catch {
      setMessage("Não foi possível copiar. Confira a permissão de cópia do navegador.");
    }
  };
  return (
    <div className="editor-status" aria-live="polite" data-save-state={status}>
      <span>{labels[status]}</span>
      {status === "error" && (
        <button type="button" onClick={() => void session.provider.retry()}>
          Tentar salvar novamente
        </button>
      )}
      {session.provider.hasPendingChanges() && (
        <button type="button" onClick={() => void copyDraft()}>
          Copiar rascunho
        </button>
      )}
      {message && <span role="status">{message}</span>}
    </div>
  );
}
