"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { contentToneSchema } from "../model/block-schema";
import { contentToneLabels } from "./content-labels";

export type FormattingToolbarProps = { editor: Editor | null; disabled?: boolean; onLink: () => void };
const marks = [
  { name: "bold", label: "editor.bold", short: "N" },
  { name: "italic", label: "editor.italic", short: "I" },
  { name: "underline", label: "editor.underline", short: "S" },
  { name: "strike", label: "editor.strike", short: "T" },
  { name: "code", label: "editor.inlineCode", short: "</>" },
] as const;

function tone(value: unknown): string | undefined {
  const parsed = contentToneSchema.safeParse(value);
  return parsed.success && parsed.data !== "default" ? parsed.data : undefined;
}

export function FormattingToolbar({ editor, disabled = false, onLink }: FormattingToolbarProps) {
  const t = useTranslations();
  const CONTENT_TONE_LABELS = contentToneLabels(t);
  const [active, setActive] = useState(0);
  const controls = useRef<(HTMLButtonElement | HTMLSelectElement | null)[]>([]);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!editor) return () => {};
      editor.on("transaction", notify);
      editor.on("update", notify);
      editor.on("selectionUpdate", notify);
      editor.on("destroy", notify);
      return () => {
        editor.off("transaction", notify);
        editor.off("update", notify);
        editor.off("selectionUpdate", notify);
        editor.off("destroy", notify);
      };
    },
    [editor],
  );
  const snapshot = useCallback(() => {
    if (!editor || editor.isDestroyed) return "unavailable";
    const attrs = editor.getAttributes("textStyle");
    return [
      editor.isEditable,
      ...marks.map(({ name }) => editor.isActive(name)),
      editor.isActive("link"),
      tone(attrs.color),
      tone(attrs.background),
    ].join("|");
  }, [editor]);
  useSyncExternalStore(subscribe, snapshot, () => "unavailable");
  const unavailable = disabled || !editor || editor.isDestroyed || !editor.isEditable;
  const attrs = !editor || editor.isDestroyed ? {} : editor.getAttributes("textStyle");
  const changeTone = (field: "color" | "background", value: string) => {
    if (unavailable || !editor || !contentToneSchema.safeParse(value).success) return;
    const current = editor.getAttributes("textStyle");
    const next = {
      color: tone(current.color),
      background: tone(current.background),
      [field]: value === "default" ? undefined : value,
    };
    if (next.color === undefined && next.background === undefined) editor.commands.unsetMark("textStyle");
    else editor.commands.setMark("textStyle", next);
  };

  return (
    <div
      role="toolbar"
      aria-label={t("editor.formatText")}
      className="editor-formatting-toolbar"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        if (event.target instanceof HTMLSelectElement && ["Home", "End"].includes(event.key)) return;
        const available = controls.current.filter((control) => control && !control.disabled);
        if (!available.length) return;
        const target = event.target;
        const current =
          target instanceof HTMLButtonElement || target instanceof HTMLSelectElement
            ? available.indexOf(target)
            : -1;
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? available.length - 1
              : (Math.max(0, current) + (event.key === "ArrowRight" ? 1 : -1) + available.length) %
                available.length;
        event.preventDefault();
        event.stopPropagation();
        available[index]?.focus();
      }}
    >
      {marks.map((mark, index) => (
        <button
          type="button"
          key={mark.name}
          aria-label={t(mark.label)}
          title={t(mark.label)}
          aria-pressed={Boolean(editor && !editor.isDestroyed && editor.isActive(mark.name))}
          disabled={unavailable}
          className="editor-format-button"
          tabIndex={active === index ? 0 : -1}
          ref={(element) => {
            controls.current[index] = element;
          }}
          onFocus={() => setActive(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!unavailable) editor.commands.toggleMark(mark.name);
          }}
        >
          <span aria-hidden="true" data-format={mark.name}>
            {t.locale === "en"
              ? ({ bold: "B", italic: "I", underline: "U", strike: "S", code: "</>" } as const)[mark.name]
              : mark.short}
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-label={t("common.link")}
        title={t("common.link")}
        aria-pressed={Boolean(editor && !editor.isDestroyed && editor.isActive("link"))}
        disabled={unavailable}
        className="editor-format-button"
        tabIndex={active === 5 ? 0 : -1}
        ref={(element) => {
          controls.current[5] = element;
        }}
        onFocus={() => setActive(5)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onLink}
      >
        {t("common.link")}
      </button>
      {(["color", "background"] as const).map((field, ordinal) => (
        <label key={field} className="editor-format-color-field">
          <span>{field === "color" ? t("editor.textColor") : t("editor.backgroundColor")}</span>
          <select
            key={field}
            aria-label={field === "color" ? t("editor.textColor") : t("editor.backgroundColor")}
            className="editor-format-color"
            disabled={unavailable}
            value={tone(attrs[field]) ?? "default"}
            tabIndex={active === ordinal + 6 ? 0 : -1}
            ref={(element) => {
              controls.current[ordinal + 6] = element;
            }}
            onFocus={() => setActive(ordinal + 6)}
            onChange={(event) => changeTone(field, event.currentTarget.value)}
          >
            {contentToneSchema.options.map((value) => (
              <option key={value} value={value}>
                {CONTENT_TONE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
