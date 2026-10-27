"use client";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  getRelativeSelection,
  type RelativeSelection,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { encodeCursor, type SharedCursor } from "@/features/collaboration/protocol";
import type { CommentAnchor } from "@/features/comments/model";
import { useTranslations } from "@/lib/i18n/client";
import type { EditorSession } from "../client/editor-session";
import type { DocumentReferences } from "../client/reference-resolver";
import { indentBlockSelection, orderedBlocks } from "../model/block-commands";
import { mergeTextBlock, splitTextBlock } from "../model/text-commands";
import type { BlockTextProps } from "./block-text";
import { BLOCK_COMMANDS, type BlockCommand } from "./command-catalog";
import { chooseBlockCommand, type QueryRange } from "./page-editor-actions";
import { runEditorPlan } from "./page-editor-plan";

export type InlineMenu = QueryRange & {
  kind: "slash" | "mention";
  query: string;
  anchor: { left: number; top: number };
};
type Focus = { id: string; position: number; relative?: RelativeSelection };
export function detectInlineMenu(id: string, editor: Editor, type: string): InlineMenu | null {
  if (
    type === "code" ||
    editor.view.composing ||
    !editor.view.hasFocus() ||
    !editor.state.selection.empty ||
    editor.state.selection.$from.marks().some((mark) => mark.type.name === "code")
  )
    return null;
  const selection = editor.state.selection;
  const prefix = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, "\ufffc");
  const match = /(?:^|\s)([@/])([^\n@/]{0,200})$/u.exec(prefix);
  if (!match || (match[1] === "/" && ["tableCell", "column"].includes(type))) return null;
  const query = match[2] ?? "";
  const literal = `${match[1]}${query}`;
  let anchor: { left: number; top: number };
  try {
    const coordinates = editor.view.coordsAtPos(selection.from);
    anchor = { left: coordinates.left, top: coordinates.bottom + 6 };
  } catch {
    const rect = editor.view.dom.getBoundingClientRect();
    anchor = { left: rect.left, top: rect.bottom + 6 };
  }
  return {
    id,
    kind: match[1] === "/" ? "slash" : "mention",
    query,
    from: selection.from - literal.length,
    to: selection.from,
    literal,
    anchor,
  };
}

export function usePageEditorController(
  session: EditorSession,
  references: DocumentReferences,
  editable: boolean,
  publishCursor?: (cursor: SharedCursor | null) => void,
) {
  const t = useTranslations();

  const registry = useRef(new Map<string, Editor>());
  const pending = useRef<Focus | null>(null);
  const selectedRef = useRef<string[]>([]);
  const [selected, setSelectedState] = useState<string[]>([]);
  const [active, setActive] = useState<{ id: string; editor: Editor } | null>(null);
  const [menu, setMenu] = useState<InlineMenu | null>(null);
  const [link, setLink] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState<{ blockId: string; anchor?: CommentAnchor } | null>(null);
  const openComments = (blockId: string) => {
    const editor = registry.current.get(blockId);
    const binding = editor ? ySyncPluginKey.getState(editor.state)?.binding : undefined;
    const relative =
      binding && editor ? encodeCursor(blockId, getRelativeSelection(binding, editor.state)) : null;
    const url = (value: string) => value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    setComment({
      blockId,
      ...(relative
        ? {
            anchor: {
              type: "relative",
              start: url(relative.anchor),
              end: url(relative.head),
            } as CommentAnchor,
          }
        : {}),
    });
  };
  const setSelected = useCallback((ids: string[]) => {
    selectedRef.current = ids;
    setSelectedState(ids);
  }, []);
  const run = useCallback(
    <T>(action: () => T): T | undefined => {
      if (!editable || !session.isEditable()) return;
      try {
        let result: T | undefined;
        flushSync(() => {
          result = action();
          setError("");
        });
        return result;
      } catch {
        setError(t("editor.actionFailed"));
        return undefined;
      }
    },
    [editable, session, t],
  );
  const applyFocus = useCallback(
    (target: Focus, editor: Editor) => {
      let from = target.position;
      let to = from;
      const binding = ySyncPluginKey.getState(editor.state)?.binding;
      if (target.relative && binding) {
        from =
          relativePositionToAbsolutePosition(
            session.document,
            session.page.fragment(target.id),
            target.relative.anchor,
            binding.mapping,
          ) ?? from;
        to =
          relativePositionToAbsolutePosition(
            session.document,
            session.page.fragment(target.id),
            target.relative.head,
            binding.mapping,
          ) ?? from;
      }
      const end = editor.state.doc.content.size - 1;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(
            editor.state.doc,
            Math.max(1, Math.min(from, end)),
            Math.max(1, Math.min(to, end)),
          ),
        ),
      );
      editor.view.focus();
      pending.current = null;
    },
    [session],
  );
  const focus = useCallback(
    (id: string, position = 1, relative?: RelativeSelection) => {
      const target: Focus = { id, position, ...(relative ? { relative } : {}) };
      pending.current = target;
      document.dispatchEvent(
        new CustomEvent("bloco:reveal-block", { detail: { pageId: session.pageId, blockId: id } }),
      );
      const mounted = registry.current.get(id);
      if (mounted && !mounted.isDestroyed) {
        applyFocus(target, mounted);
        return;
      }
      requestAnimationFrame(() => {
        if (pending.current !== target) return;
        const ready = registry.current.get(id);
        if (ready?.view.hasFocus()) pending.current = null;
        else if (ready && !ready.isDestroyed) applyFocus(target, ready);
        else document.querySelector<HTMLElement>(`[data-editor-block="${id}"]`)?.focus();
      });
    },
    [applyFocus, session.pageId],
  );
  const preserveFocus = useCallback(
    (action: () => void, id = active?.id) => {
      const editor = id ? registry.current.get(id) : undefined;
      const binding = editor ? ySyncPluginKey.getState(editor.state)?.binding : undefined;
      const relative = editor && binding ? getRelativeSelection(binding, editor.state) : undefined;
      const position = editor?.state.selection.head ?? 1;
      run(action);
      if (id) focus(id, position, relative);
    },
    [active?.id, run, focus],
  );
  const captureFocus = (id: string): (() => void) => {
    const editor = registry.current.get(id);
    const binding = editor ? ySyncPluginKey.getState(editor.state)?.binding : undefined;
    const relative = editor && binding ? getRelativeSelection(binding, editor.state) : undefined;
    const position = editor?.state.selection.head ?? 1;
    return () => focus(id, position, relative);
  };
  const selectFrame = useCallback(
    (id: string) => {
      pending.current = null;
      let frame = session.page.getBlock(id);
      if (frame?.type === "tableCell")
        frame = frame.parentId ? session.page.getBlock(frame.parentId) : undefined;
      if (frame?.type === "tableRow")
        frame = frame.parentId ? session.page.getBlock(frame.parentId) : undefined;
      if (!frame) return;
      document.dispatchEvent(
        new CustomEvent("bloco:reveal-block", { detail: { pageId: session.pageId, blockId: frame.id } }),
      );
      setMenu(null);
      setSelected([frame.id]);
      const element = document.querySelector<HTMLElement>(`[data-editor-block="${frame.id}"]`);
      if (element) {
        element.focus();
        return;
      }
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-editor-block="${frame.id}"]`)?.focus(),
      );
    },
    [session, setSelected],
  );
  const ensureMentions = useCallback(
    (editor: Editor) => {
      editor.state.doc.descendants((node) => {
        if (node.type.name === "pageMention" && typeof node.attrs.pageId === "string")
          references.ensureMention(node.attrs.pageId);
      });
    },
    [references],
  );
  const callbacks: Pick<
    BlockTextProps,
    | "onReady"
    | "onSelection"
    | "onChange"
    | "onSplit"
    | "onMerge"
    | "onEscape"
    | "onIndent"
    | "onPattern"
    | "onLink"
  > = {
    onReady(id, editor) {
      if (!editor) {
        const previous = registry.current.get(id);
        const binding =
          previous && !previous.isDestroyed ? ySyncPluginKey.getState(previous.state)?.binding : undefined;
        if (!pending.current && previous?.isFocused && binding)
          pending.current = {
            id,
            position: previous.state.selection.head,
            relative: getRelativeSelection(binding, previous.state),
          };
        registry.current.delete(id);
        setActive((previous) => (previous?.id === id ? null : previous));
        return;
      }
      registry.current.set(id, editor);
      ensureMentions(editor);
      if (pending.current?.id === id) applyFocus(pending.current, editor);
    },
    onSelection(id, editor) {
      if (editor.view.hasFocus()) {
        const binding = ySyncPluginKey.getState(editor.state)?.binding;
        if (binding) publishCursor?.(encodeCursor(id, getRelativeSelection(binding, editor.state)));
        setActive((previous) =>
          previous?.id === id && previous.editor === editor ? previous : { id, editor },
        );
        if (selectedRef.current.length) setSelected([]);
        const next = detectInlineMenu(id, editor, session.page.getBlock(id)?.type ?? "code");
        setMenu((previous) =>
          previous?.id === next?.id &&
          previous?.literal === next?.literal &&
          previous?.from === next?.from &&
          previous?.to === next?.to
            ? previous
            : next,
        );
      }
    },
    onChange(id, editor) {
      if (editor.view.hasFocus()) {
        const binding = ySyncPluginKey.getState(editor.state)?.binding;
        if (binding) publishCursor?.(encodeCursor(id, getRelativeSelection(binding, editor.state)));
      }
      ensureMentions(editor);
      if (pending.current?.id === id && editor.view.hasFocus()) {
        const binding = ySyncPluginKey.getState(editor.state)?.binding;
        pending.current.position = editor.state.selection.head;
        if (binding) pending.current.relative = getRelativeSelection(binding, editor.state);
      }
      const next = detectInlineMenu(id, editor, session.page.getBlock(id)?.type ?? "code");
      setMenu((previous) =>
        previous?.id === next?.id &&
        previous?.literal === next?.literal &&
        previous?.from === next?.from &&
        previous?.to === next?.to
          ? previous
          : next,
      );
    },
    onSplit(id, position, editor) {
      const next = run(() => splitTextBlock(session.page, id, editor, position));
      if (next) focus(next.id, next.position);
    },
    onMerge(id, editor) {
      const current = session.page.getBlock(id);
      const siblings = orderedBlocks(session.page).filter((block) => block.parentId === current?.parentId);
      const previous = siblings[siblings.findIndex((block) => block.id === id) - 1];
      const next = run(() =>
        mergeTextBlock(session.page, id, editor, previous ? registry.current.get(previous.id) : undefined),
      );
      if (next) {
        focus(next.id, next.position);
        return true;
      }
      return false;
    },
    onEscape: selectFrame,
    onIndent(id, direction) {
      let changed = false;
      preserveFocus(() => {
        changed = indentBlockSelection(session.page, [id], direction);
      }, id);
      return changed;
    },
    onPattern(id, pattern, editor) {
      const commandId = (
        {
          "#": "h1",
          "##": "h2",
          "###": "h3",
          "-": "bulletListItem",
          "*": "bulletListItem",
          "+": "bulletListItem",
          "1.": "numberListItem",
          "[]": "task",
          "[ ]": "task",
          ">": "toggle",
          '"': "quote",
          "```": "code",
          "---": "divider",
        } as Record<string, string>
      )[pattern];
      const command = BLOCK_COMMANDS.find((item) => item.id === commandId);
      if (!command) return false;
      const next = run(() =>
        chooseBlockCommand(session.page, registry.current, id, command, {
          id,
          from: 1,
          to: 1 + pattern.length,
          literal: pattern,
        }),
      );
      if (next) {
        setMenu(null);
        focus(next);
        return true;
      }
      editor.view.focus();
      return false;
    },
    onLink(_id, editor) {
      setLink(editor);
    },
  };
  const choose = (command: BlockCommand, id = menu?.id ?? active?.id, promoteChildren = false) => {
    if (!id) return;
    const requested =
      !menu && selectedRef.current.includes(id) ? new Set(selectedRef.current) : new Set([id]);
    const all = orderedBlocks(session.page);
    const byId = new Map(all.map((block) => [block.id, block]));
    const targets = all.filter((block) => {
      if (!requested.has(block.id)) return false;
      let parent = block.parentId;
      while (parent) {
        if (requested.has(parent)) return false;
        parent = byId.get(parent)?.parentId ?? null;
      }
      return true;
    });
    const next = run(() =>
      targets.length > 1
        ? runEditorPlan(session.page, registry.current, (plan) => {
            let focused = id;
            for (const target of targets)
              focused = chooseBlockCommand(
                plan.page,
                registry.current,
                target.id,
                command,
                undefined,
                promoteChildren,
              );
            return focused;
          })
        : chooseBlockCommand(
            session.page,
            registry.current,
            id,
            command,
            menu?.id === id ? menu : undefined,
            promoteChildren,
          ),
    );
    if (next) {
      setMenu(null);
      setSelected([]);
      focus(next);
    }
  };
  const chooseMention = (item: { id: string }) => {
    const editor = menu ? registry.current.get(menu.id) : undefined;
    if (!menu || !editor || editor.state.doc.textBetween(menu.from, menu.to) !== menu.literal) return;
    const range = menu;
    run(() =>
      session.page.runAction(() =>
        editor.commands.insertContentAt(
          { from: range.from, to: range.to },
          { type: "pageMention", attrs: { pageId: item.id } },
        ),
      ),
    );
    references.ensureMention(item.id);
    setMenu(null);
    editor.view.focus();
  };
  return {
    session,
    references,
    registry,
    callbacks,
    active,
    menu,
    link,
    error,
    selected,
    selectedRef,
    setSelected,
    setError,
    comment,
    setComment,
    openComments,
    setMenu,
    setLink,
    selectFrame,
    focus,
    preserveFocus,
    captureFocus,
    choose,
    chooseMention,
    run,
  };
}
export type PageEditorController = ReturnType<typeof usePageEditorController>;
