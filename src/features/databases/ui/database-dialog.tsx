"use client";
import { type ReactNode, useEffect, useId, useRef } from "react";

export function DatabaseDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    if (element) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      element.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    }
    return () => {
      if (element?.open && typeof element.close === "function") element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="db-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
