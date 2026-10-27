"use client";
import { type KeyboardEvent, type MouseEvent, type RefObject, useRef } from "react";
import {
  duplicateBlockSelection,
  indentBlockSelection,
  moveBlockSelection,
  orderedBlocks,
  removeBlockSelection,
} from "../model/block-commands";
import type { PageEditorController } from "./page-editor-controller";

export function blockSelectionInterval(ids: readonly string[], anchor: string, head: string): string[] {
  const first = ids.indexOf(anchor);
  const last = ids.indexOf(head);
  return first < 0 || last < 0 ? [] : ids.slice(Math.min(first, last), Math.max(first, last) + 1);
}
function visibleIds(root: HTMLElement | null): string[] {
  return [...(root?.querySelectorAll<HTMLElement>("[data-editor-block]") ?? [])]
    .map((element) => element.dataset.editorBlock ?? "")
    .filter(Boolean);
}
function focusFrame(id: string): void {
  const frame = document.querySelector<HTMLElement>(`[data-editor-block="${id}"]`);
  if (frame) {
    frame.focus();
    return;
  }
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-editor-block="${id}"]`)?.focus());
}
export function usePageEditorSelection(
  controller: PageEditorController,
  root: RefObject<HTMLDivElement | null>,
  editable: boolean,
) {
  const range = useRef<{ anchor: string; head: string; selected: string[] } | null>(null);
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-table-cell-selection]")) return;
    if (
      !editable ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.getModifierState("AltGraph") ||
      !(event.target instanceof Element) ||
      event.target.closest("input,textarea,select")
    )
      return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const target = event.target.closest<HTMLElement>("[data-editor-block]");
    if (!target) return;
    if (mod && (key === "z" || key === "y")) {
      event.preventDefault();
      event.stopPropagation();
      controller.run(() => {
        if (key === "y" || event.shiftKey) controller.session.page.redo();
        else controller.session.page.undo();
      });
      const editor = controller.active ? controller.registry.current.get(controller.active.id) : undefined;
      if (editor && !editor.isDestroyed) editor.view.focus();
      else {
        const next = orderedBlocks(controller.session.page)[0];
        if (next) controller.focus(next.id);
      }
      return;
    }
    if (event.target.closest('[contenteditable="true"]')) return;
    if (event.target.closest("button") && !event.target.closest(".editor-block-handle")) return;
    const selected = controller.selectedRef.current.length
      ? controller.selectedRef.current
      : [target.dataset.editorBlock ?? ""];
    const ids = visibleIds(root.current);
    if (mod && key === "d") {
      event.preventDefault();
      event.stopPropagation();
      const copied = controller.run(() => duplicateBlockSelection(controller.session.page, selected));
      if (copied?.[0]) {
        controller.setSelected(copied);
        focusFrame(copied[0]);
      }
    } else if (event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key) && !mod) {
      event.preventDefault();
      event.stopPropagation();
      const previous = range.current;
      const continued = previous && previous.selected.join("|") === selected.join("|");
      const anchor = continued ? previous.anchor : (selected[0] ?? "");
      const head = continued ? previous.head : (selected.at(-1) ?? anchor);
      const next = ids[ids.indexOf(head) + (event.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      const expanded = blockSelectionInterval(ids, anchor, next);
      range.current = { anchor, head: next, selected: expanded };
      controller.setSelected(expanded);
      focusFrame(next);
    } else if (mod && event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const blocks = orderedBlocks(controller.session.page);
      const first = blocks.find((block) => selected.includes(block.id));
      if (!first) return;
      const siblings = blocks.filter((block) => block.parentId === first.parentId);
      const indices = siblings
        .map((block, index) => (selected.includes(block.id) ? index : -1))
        .filter((index) => index >= 0);
      const lower = Math.min(...indices);
      const upper = Math.max(...indices);
      const before = event.key === "ArrowUp" ? siblings[lower - 1]?.id : (siblings[upper + 2]?.id ?? null);
      if ((event.key === "ArrowUp" && !before) || (event.key === "ArrowDown" && !siblings[upper + 1])) return;
      controller.preserveFocus(
        () => moveBlockSelection(controller.session.page, selected, first.parentId, before ?? null),
        first.id,
      );
    } else if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const index = ids.indexOf(selected[0] ?? "");
      controller.run(() => removeBlockSelection(controller.session.page, selected));
      const remaining = orderedBlocks(controller.session.page).filter((block) => ids.includes(block.id));
      const next = remaining[Math.min(Math.max(0, index), remaining.length - 1)];
      if (next) controller.selectFrame(next.id);
      else {
        controller.setSelected([]);
        requestAnimationFrame(() =>
          root.current?.querySelector<HTMLButtonElement>(".editor-add-block")?.focus(),
        );
      }
    } else if (event.key === "Tab") {
      const changed = controller.run(() =>
        indentBlockSelection(controller.session.page, selected, event.shiftKey ? -1 : 1),
      );
      if (changed) {
        event.preventDefault();
        event.stopPropagation();
        focusFrame(selected[0] ?? "");
      }
    }
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!editable || !event.shiftKey || !(event.target instanceof Element)) return;
    const frame = event.target.closest<HTMLElement>("[data-editor-block]");
    if (!frame || !event.target.closest(".editor-block-handle")) return;
    event.preventDefault();
    event.stopPropagation();
    const head = frame.dataset.editorBlock ?? "";
    const anchor = controller.selectedRef.current[0] ?? head;
    const selected = blockSelectionInterval(visibleIds(root.current), anchor, head);
    controller.setSelected(selected);
    range.current = { anchor, head, selected };
    focusFrame(head);
  };
  return { onKeyDownCapture, onClickCapture };
}
