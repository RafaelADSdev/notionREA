"use client";

import { type Editor, getMarkRange } from "@tiptap/core";
import { type Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { isSafeContentLink } from "../model/content-schema";

export type LinkDialogProps = { editor: Editor | null; open: boolean; onClose: () => void };

function OpenLinkDialog({ editor, onClose }: Omit<LinkDialogProps, "open">) {
  const t = useTranslations();

  const dialog = useRef<HTMLDialogElement>(null);
  const hrefInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const selection = useRef<Selection | null>(editor?.state.selection ?? null);
  const existing = editor && !editor.isDestroyed ? editor.getAttributes("link").href : undefined;
  const [initial] = useState(() => ({
    href: typeof existing === "string" ? existing : "",
    insert: Boolean(editor?.state.selection.empty && !existing),
  }));
  const [error, setError] = useState("");
  const id = useId();
  const close = () => {
    const element = dialog.current;
    if (element?.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
    if (editor && !editor.isDestroyed) editor.view.focus();
    onClose();
  };

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      selection.current = editor.state.selection;
      const link = editor.schema.marks.link;
      if (editor.state.selection.empty && initial.href && link) {
        const range = getMarkRange(editor.state.selection.$from, link);
        if (range) selection.current = TextSelection.create(editor.state.doc, range.from, range.to);
      }
    }
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    hrefInput.current?.focus();
    const listener = ({ transaction }: { transaction: Transaction }) => {
      selection.current = selection.current?.map(transaction.doc, transaction.mapping) ?? null;
    };
    editor?.on("transaction", listener);
    return () => {
      editor?.off("transaction", listener);
      if (element?.open) {
        if (typeof element.close === "function") element.close();
        else element.removeAttribute("open");
      }
    };
  }, [editor, initial.href]);

  const restoreSelection = () => {
    if (!editor || editor.isDestroyed || !editor.isEditable || !selection.current) return false;
    editor.view.dispatch(editor.state.tr.setSelection(selection.current));
    return true;
  };

  return (
    <dialog
      ref={dialog}
      className="editor-link-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <form
        data-editor-local-form
        className="editor-link-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const href = hrefInput.current?.value ?? "";
          if (href.length > 4096 || !isSafeContentLink(href)) {
            setError(t("editor.validLink"));
            hrefInput.current?.focus();
            return;
          }
          if (!restoreSelection() || !editor || !selection.current) return;
          if (initial.insert) {
            const text = labelInput.current?.value || href;
            editor.commands.insertContentAt(
              { from: selection.current.from, to: selection.current.to },
              { type: "text", text, marks: [{ type: "link", attrs: { href } }] },
            );
          } else editor.commands.setMark("link", { href });
          close();
        }}
      >
        <h2 id={`${id}-title`}>{initial.href ? t("editor.editLink") : t("editor.addLink")}</h2>
        <label htmlFor={`${id}-href`}>{t("editor.linkAddress")}</label>
        <input
          ref={hrefInput}
          id={`${id}-href`}
          name="href"
          type="text"
          inputMode="url"
          autoComplete="off"
          maxLength={4096}
          defaultValue={initial.href}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {initial.insert && (
          <>
            <label htmlFor={`${id}-label`}>{t("editor.linkText")}</label>
            <input
              ref={labelInput}
              id={`${id}-label`}
              name="label"
              type="text"
              maxLength={4096}
              placeholder={t("editor.linkTextPlaceholder")}
            />
          </>
        )}
        {error && (
          <p id={`${id}-error`} className="editor-link-error" role="alert">
            {error}
          </p>
        )}
        <div className="editor-link-actions">
          {initial.href && (
            <button
              type="button"
              onClick={() => {
                if (restoreSelection() && editor) editor.commands.unsetMark("link");
                close();
              }}
            >
              {t("editor.removeLink")}
            </button>
          )}
          <button type="button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={!editor || editor.isDestroyed || !editor.isEditable}>
            {t("editor.saveLink")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function LinkDialog({ editor, open, onClose }: LinkDialogProps) {
  return open ? <OpenLinkDialog editor={editor} onClose={onClose} /> : null;
}
