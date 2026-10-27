"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { signOut } from "@/features/auth/actions";
import { useTranslations } from "@/lib/i18n/client";

export function SafeSignOut({ userId }: { userId: string }) {
  const t = useTranslations();

  const identity = useRef(userId);
  const active = useRef(true);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    identity.current = userId;
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [userId]);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    const actor = userId;
    const current = () => active.current && identity.current === actor;
    try {
      const { flushAllEditorSessions, hasUnconfirmedEditorSessions } = await import(
        "../client/editor-session"
      );
      await flushAllEditorSessions(actor);
      if (!current()) return;
      if (hasUnconfirmedEditorSessions(actor) && !window.confirm(t("editor.signOutDrafts"))) return;
      if (current()) await signOut();
    } finally {
      submitting.current = false;
      if (current()) setPending(false);
    }
  }

  return (
    <form action={submit}>
      <button
        type="submit"
        className="nav-link"
        style={{ width: "100%", border: 0, background: "transparent" }}
        disabled={pending}
        aria-busy={pending}
      >
        <Icon name="exit" />
        {t("auth.signOut")}
      </button>
    </form>
  );
}
