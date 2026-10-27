"use client";

import { Editor } from "@tiptap/core";
import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { pageCollaboration } from "../model/page-collaboration";
import type { StablePage } from "../model/stable-page";
import { codeHighlightExtension } from "./code-highlight";
import { createTextExtensions, type MentionResolver } from "./text-extensions";
import { installTextNavigation, synchronizeNativeSelection } from "./text-navigation";

export type BlockTextProps = {
  page: StablePage;
  blockId: string;
  editable: boolean;
  mentionResolver?: MentionResolver;
  onReady?: (id: string, editor: Editor | null) => void;
  onSelection?: (id: string, editor: Editor) => void;
  onChange?: (id: string, editor: Editor) => void;
  onSplit?: (id: string, position: number, editor: Editor) => void;
  onMerge?: (id: string, editor: Editor) => boolean;
  onEscape?: (id: string) => void;
  onIndent?: (id: string, direction: 1 | -1) => boolean;
  onPattern?: (id: string, pattern: string, editor: Editor) => boolean;
  onLink?: (id: string, editor: Editor) => void;
};

const patterns = new Set(["#", "##", "###", "-", "*", "+", "1.", "[]", "[ ]", ">", '"', "```"]);

/** Each view binds the existing fragment; neither view lifecycle nor transforms replace it. */
export function BlockText(props: BlockTextProps) {
  const { page, blockId, editable, mentionResolver } = props;
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<Editor | null>(null);
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  });

  useEffect(() => {
    if (!host.current) return;
    const isCode = () => page.getBlock(blockId)?.type === "code";
    const editor: Editor = new Editor({
      element: host.current,
      injectCSS: false,
      editable: callbacks.current.editable,
      extensions: [
        ...createTextExtensions(mentionResolver ? { mentionResolver } : {}),
        pageCollaboration(page, blockId),
        codeHighlightExtension({
          isCode,
          language: () =>
            isCode() ? String(page.getBlockAttributes(blockId).language ?? "plaintext") : "plaintext",
        }),
      ],
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Texto do bloco",
          "aria-multiline": "true",
          class: "block-text min-h-6 outline-none whitespace-pre-wrap break-words",
        },
        handleTextInput(view, from, to, text) {
          if (!isCode()) return false;
          // A code block keeps literal input and never runs rich-text input rules.
          view.dispatch(view.state.tr.insertText(text, from, to));
          return true;
        },
        handlePaste(view, event) {
          if (!isCode() || !event.clipboardData) return false;
          view.dispatch(view.state.tr.insertText(event.clipboardData.getData("text/plain")));
          return true;
        },
        handleKeyDown(view, event): boolean {
          if (
            !view.editable ||
            event.isComposing ||
            view.composing ||
            event.keyCode === 229 ||
            event.altKey ||
            event.getModifierState("AltGraph")
          )
            return false;
          const current = callbacks.current;
          const mod = event.ctrlKey || event.metaKey;
          if (mod && ["b", "i", "u", "e", "k", "s"].includes(event.key.toLowerCase()))
            synchronizeNativeSelection(view);
          const selection = view.state.selection;
          if (mod) {
            const key = event.key.toLowerCase();
            if (
              isCode() &&
              (["b", "i", "u", "e", "k"].includes(key) || (event.shiftKey && ["s", "x"].includes(key)))
            )
              return true;
            if (key === "k") {
              if (selection.empty) return false;
              current.onLink?.(blockId, editor);
              return true;
            }
            const mark = !event.shiftKey
              ? ({ b: "bold", i: "italic", u: "underline", e: "code" } as const)[key as "b" | "i" | "u" | "e"]
              : key === "s"
                ? "strike"
                : undefined;
            if (mark) return editor.commands.toggleMark(mark);
            return false;
          }
          if (event.key === "Escape") {
            current.onEscape?.(blockId);
            return true;
          }
          if (event.key === "Tab") {
            if (isCode()) {
              if (event.shiftKey) {
                const prefix = selection.$from.parent.textBetween(0, selection.$from.parentOffset);
                const spaces = prefix.match(/(?:^|\n)( {1,2})$/)?.[1]?.length ?? 0;
                if (spaces) view.dispatch(view.state.tr.delete(selection.from - spaces, selection.from));
              } else view.dispatch(view.state.tr.insertText("  "));
              return true;
            }
            const type = page.getBlock(blockId)?.type;
            return type && ["bulletListItem", "numberListItem", "task"].includes(type)
              ? (current.onIndent?.(blockId, event.shiftKey ? -1 : 1) ?? false)
              : false;
          }
          if (event.key === "Enter") {
            if (isCode()) {
              view.dispatch(view.state.tr.insertText("\n"));
              return true;
            }
            if (event.shiftKey) return editor.commands.setHardBreak();
            const prefix = selection.$from.parent.textBetween(0, selection.$from.parentOffset);
            if (
              selection.empty &&
              ["---", "```"].includes(prefix) &&
              current.onPattern?.(blockId, prefix, editor)
            )
              return true;
            current.onSplit?.(blockId, selection.from, editor);
            return true;
          }
          if (
            event.key === "Backspace" &&
            !event.shiftKey &&
            selection.empty &&
            selection.$from.parentOffset === 0
          )
            return current.onMerge?.(blockId, editor) ?? false;
          if (event.key === " " && !event.shiftKey && !isCode() && selection.empty) {
            const prefix = selection.$from.parent.textBetween(0, selection.$from.parentOffset);
            if (patterns.has(prefix)) return current.onPattern?.(blockId, prefix, editor) ?? false;
          }
          return false;
        },
      },
      onSelectionUpdate: ({ editor: changed }) => callbacks.current.onSelection?.(blockId, changed),
      onFocus: ({ editor: changed }) => callbacks.current.onSelection?.(blockId, changed),
      onUpdate: ({ editor: changed }) => callbacks.current.onChange?.(blockId, changed),
    });
    const uninstallNavigation = installTextNavigation(editor.view);
    // Let the public binding observe loaded content before a first action can erase it.
    // Blank fragments retain the binding's placeholder guard and are not materialized here.
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
    active.current = editor;
    const blocks = page.document.getMap("blocks");
    const attributes = page.document.getMap("attrs");
    const refresh = () => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("bloco:code-style", true));
    };
    const onBlocks: Parameters<typeof blocks.observe>[0] = (event) => {
      if (event.keysChanged.has(blockId)) refresh();
    };
    const onAttributes: Parameters<typeof attributes.observeDeep>[0] = (events) => {
      if (
        events.some(
          (event) =>
            event.path[0] === blockId ||
            (event.target === attributes && event instanceof Y.YMapEvent && event.keysChanged.has(blockId)),
        )
      )
        refresh();
    };
    blocks.observe(onBlocks);
    attributes.observeDeep(onAttributes);
    callbacks.current.onReady?.(blockId, editor);
    return () => {
      uninstallNavigation();
      callbacks.current.onReady?.(blockId, null);
      active.current = null;
      blocks.unobserve(onBlocks);
      attributes.unobserveDeep(onAttributes);
      editor.destroy();
    };
  }, [page, blockId, mentionResolver]);

  useEffect(() => {
    active.current?.setEditable(editable);
  }, [editable]);
  return <div ref={host} id={`editor-text-${blockId}`} data-block-text={blockId} />;
}
