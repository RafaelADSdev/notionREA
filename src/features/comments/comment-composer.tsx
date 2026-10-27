"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { commentBody } from "./model";

export function CommentComposer({
  label,
  submitLabel,
  disabled = false,
  onSend,
  requestScope = "",
  onDraft,
}: {
  label: string;
  submitLabel: string;
  disabled?: boolean;
  requestScope?: string;
  onDraft?: (body: string) => void;
  onSend: (body: string, requestId: string) => Promise<boolean>;
}) {
  const t = useTranslations();

  const id = useId();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<{ body: string; scope: string; id: string } | null>(null);
  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || sending) return;
        const parsed = commentBody.safeParse(body);
        if (!parsed.success) {
          setError(t("comments.writeLimitSend"));
          return;
        }
        if (operation.current?.body !== body || operation.current.scope !== requestScope)
          operation.current = { body, scope: requestScope, id: crypto.randomUUID() };
        const requestId = operation.current.id;
        setSending(true);
        setError("");
        void onSend(body, requestId)
          .then((accepted) => {
            if (accepted) {
              setBody("");
              onDraft?.("");
              operation.current = null;
            }
          })
          .catch(() => setError(t("comments.sendFailed")))
          .finally(() => setSending(false));
      }}
    >
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={body}
        maxLength={8192}
        readOnly={disabled || sending}
        rows={3}
        onChange={(event) => {
          setBody(event.target.value);
          onDraft?.(event.target.value);
        }}
        aria-describedby={`${id}-limit`}
      />
      <div className="comment-composer-footer">
        <small id={`${id}-limit`}>{t("comments.plainTextLimit")}</small>
        <button type="submit" disabled={disabled || sending}>
          {sending ? t("common.sending") : submitLabel}
        </button>
      </div>
      {disabled && body && (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(body);
              setError(t("editor.draftCopied"));
            } catch {
              setError(t("comments.copyFailed"));
            }
          }}
        >
          {t("comments.copyDraft")}
        </button>
      )}
      {error && <p role="status">{error}</p>}
    </form>
  );
}
