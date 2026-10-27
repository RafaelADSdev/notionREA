"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { CommentsPanel } from "./comments-panel";
import type { CommentAnchor } from "./model";

export function BlockCommentsDialog({
  pageId,
  blockId,
  anchor,
  onClose,
}: {
  pageId: string;
  blockId: string;
  anchor?: CommentAnchor;
  onClose: () => void;
}) {
  const t = useTranslations();

  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="block-comments-dialog"
      aria-label={t("comments.blockComments")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button type="button" onClick={onClose}>
        {t("comments.close")}
      </button>
      <CommentsPanel pageId={pageId} blockId={blockId} {...(anchor ? { anchor } : {})} />
    </dialog>
  );
}
