"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { EditorSession } from "@/features/editor/client/editor-session";
import { useTranslations } from "@/lib/i18n/client";
import { cursorStore } from "./cursor-store";
import { type CollaborationSnapshot, EMPTY_COLLABORATION, PageCollaboration } from "./page-collaboration";
import type { SharedCursor } from "./protocol";
import { createCollaborationTransport } from "./transport";

class CollaborationBinding {
  private active: PageCollaboration | null = null;
  private snapshot = EMPTY_COLLABORATION;
  private readonly listeners = new Set<() => void>();
  constructor(readonly session: EditorSession) {}
  attach(controller: PageCollaboration): void {
    this.active = controller;
  }
  detach(controller: PageCollaboration): void {
    if (this.active === controller) this.active = null;
  }
  publishCursor(cursor: SharedCursor | null): void {
    this.active?.publishCursor(cursor);
  }
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish(snapshot: CollaborationSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
export function usePageCollaboration(session: EditorSession, editable: boolean) {
  const t = useTranslations();
  const binding = useMemo(() => new CollaborationBinding(session), [session]);
  const snapshot = useSyncExternalStore(binding.subscribe, binding.getSnapshot, () => EMPTY_COLLABORATION);
  useEffect(() => {
    let controller: PageCollaboration;
    try {
      controller = new PageCollaboration(session, createCollaborationTransport());
    } catch {
      binding.publish({ connection: "catching-up", presenceAvailable: false, participants: [] });
      return;
    }
    binding.attach(controller);
    const store = cursorStore(session.document);
    const unsubscribe = controller.subscribe(() => {
      const next = controller.getSnapshot();
      binding.publish(next);
    });
    binding.publish(controller.getSnapshot());
    controller.start();
    const focus = () => controller.catchUp();
    const visibility = () => {
      if (document.visibilityState === "visible") controller.catchUp();
      else controller.publishCursor(null);
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      unsubscribe();
      controller.stop();
      store.set([]);
      binding.detach(controller);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session, binding]);
  useEffect(() => {
    cursorStore(session.document).set(
      snapshot.participants.map((participant) => ({
        ...participant,
        label: participant.label || t("common.member"),
      })),
    );
  }, [session.document, snapshot.participants, t]);
  useEffect(() => {
    if (!editable) binding.publishCursor(null);
  }, [editable, binding]);
  const publishCursor = useCallback(
    (cursor: SharedCursor | null) => {
      if (editable) binding.publishCursor(cursor);
    },
    [editable, binding],
  );
  return { ...snapshot, publishCursor };
}
