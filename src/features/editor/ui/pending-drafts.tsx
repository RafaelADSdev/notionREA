"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "@/lib/i18n/client";
import {
  getPendingDraftSession,
  getPendingDrafts,
  type PendingDraft,
  subscribePendingDrafts,
} from "../client/editor-session";
import type { SaveState } from "../model/durable-document-provider";

const empty: readonly PendingDraft[] = Object.freeze([]);

export function PendingDrafts({ userId }: { userId: string }) {
  const t = useTranslations();

  const labels: Record<SaveState, string> = {
    loading: t("editor.loading"),
    dirty: t("editor.localChanges"),
    saving: t("editor.sending"),
    saved: t("editor.saved"),
    error: t("editor.saveFailed"),
    denied: t("editor.accessUnavailable"),
    unsupported: t("editor.updateRequired"),
  };
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
      setMessage(t("editor.draftCopied"));
    } catch {
      setMessage(t("editor.copyDraftFailed"));
    }
  }
  if (!drafts.length) return null;
  return (
    <aside className="pending-drafts" aria-label={t("editor.unconfirmedDrafts")}>
      <p>{t("editor.otherDrafts")}</p>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.pageId}>
            <span>{labels[draft.state]}</span>
            <Link href={`/w/${draft.workspaceId}/p/${draft.pageId}`}>{t("editor.returnDraft")}</Link>
            <button type="button" onClick={() => void copy(draft.pageId)}>
              {t("editor.copyDraft")}
            </button>
          </li>
        ))}
      </ul>
      <p role="status">{message}</p>
    </aside>
  );
}
