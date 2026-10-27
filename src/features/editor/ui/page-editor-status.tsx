"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "@/lib/i18n/client";
import type { EditorSession } from "../client/editor-session";
import type { SaveState } from "../model/durable-document-provider";

export function PageEditorStatus({ session }: { session: EditorSession }) {
  const t = useTranslations();

  const labels: Record<SaveState, string> = {
    loading: t("editor.loading"),
    dirty: t("editor.localChanges"),
    saving: t("editor.sending"),
    saved: t("editor.saved"),
    error: t("editor.saveFailedNotice"),
    denied: t("editor.accessUnavailableNotice"),
    unsupported: t("editor.updateRequiredNotice"),
  };
  const status = useSyncExternalStore<SaveState>(session.subscribeStatus, session.getStatus, () => "loading");
  const [message, setMessage] = useState("");
  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(session.draftText());
      setMessage(t("editor.draftCopied"));
    } catch {
      setMessage(t("editor.copyPermissionFailed"));
    }
  };
  return (
    <div className="editor-status" aria-live="polite" data-save-state={status}>
      <span>{labels[status]}</span>
      {status === "error" && (
        <button type="button" onClick={() => void session.provider.retry()}>
          {t("editor.retrySave")}
        </button>
      )}
      {session.provider.hasPendingChanges() && (
        <button type="button" onClick={() => void copyDraft()}>
          {t("editor.copyDraft")}
        </button>
      )}
      {message && <span role="status">{message}</span>}
    </div>
  );
}
