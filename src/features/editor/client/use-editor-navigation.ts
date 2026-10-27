"use client";
import { useEffect } from "react";
import type { EditorSession } from "./editor-session";
import type { DocumentReferences } from "./reference-resolver";

/** Save before soft navigation while retained sessions continue to own unconfirmed drafts. */
export function useEditorNavigation(session: EditorSession, references: DocumentReferences): void {
  useEffect(() => {
    const bypass = new WeakSet<Element>();
    const replays = new Set<ReturnType<typeof setTimeout>>();
    let active = true;
    let synchronizing = false;
    const flush = () => session.provider.flush().catch(() => undefined);
    const replayAfterFlush = (replay: () => void) => {
      void flush().then(() => {
        if (!active) return;
        // A microtask can still run within native form submission. The browser
        // ignores requestSubmit reentry until that original task has completed.
        const task = setTimeout(() => {
          replays.delete(task);
          if (active) replay();
        }, 0);
        replays.add(task);
      });
    };
    const synchronize = async () => {
      if (synchronizing || session.getStatus() === "loading" || document.visibilityState === "hidden") return;
      synchronizing = true;
      try {
        await session.provider.synchronize();
        references.refresh();
      } finally {
        synchronizing = false;
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.provider.hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = "";
      void flush();
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !(event.target instanceof Element)
      )
        return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      if (bypass.delete(anchor)) return;
      const target = new URL(anchor.href, location.href);
      if (
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self") ||
        target.origin !== location.origin ||
        (target.pathname === location.pathname && target.search === location.search) ||
        !session.provider.hasPendingChanges()
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      replayAfterFlush(() => {
        if (anchor.isConnected) {
          bypass.add(anchor);
          anchor.click();
        }
      });
    };
    const submit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      if (form.hasAttribute("data-editor-local-form")) return;
      if (bypass.delete(form) || !session.provider.hasPendingChanges()) return;
      const submitter = event.submitter;
      event.preventDefault();
      event.stopImmediatePropagation();
      replayAfterFlush(() => {
        if (!form.isConnected) return;
        bypass.add(form);
        form.requestSubmit(
          submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
            ? submitter
            : undefined,
        );
      });
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") void flush();
      else void synchronize();
    };
    const blur = () => {
      void flush();
    };
    const focus = () => {
      void synchronize();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    return () => {
      active = false;
      for (const replay of replays) clearTimeout(replay);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
    };
  }, [session, references]);
}
