"use client";
import type { Editor } from "@tiptap/core";
import type { ClipboardEvent, RefObject } from "react";
import { removeBlockSelection } from "../model/block-commands";
import { isSafeContentLink, validateContentDocument } from "../model/content-schema";
import {
  BLOCKS_CLIPBOARD_MIME,
  type BlockClipboard,
  CrossPageFilePasteError,
  clipboardPlainText,
  htmlClipboard,
  pasteBlocks,
  pastePlainLines,
  readBlockClipboard,
  selectedClipboard,
} from "./page-editor-clipboard";
import type { PageEditorController } from "./page-editor-controller";
import { runEditorPlan } from "./page-editor-plan";

type TextRange = { value: BlockClipboard; cuts: { id: string; from: number; to: number }[]; media: string[] };
function nativeTextRange(controller: PageEditorController, root: HTMLElement | null): TextRange | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const owner = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-block-text]");
  const first = owner(range.startContainer)?.dataset.blockText;
  const last = owner(range.endContainer)?.dataset.blockText;
  if (!first || !last || first === last) return null;
  const ordered = [...(root?.querySelectorAll<HTMLElement>("[data-block-text]") ?? [])].map(
    (element) => element.dataset.blockText ?? "",
  );
  const fromIndex = ordered.indexOf(first);
  const toIndex = ordered.indexOf(last);
  if (fromIndex < 0 || toIndex < fromIndex) return null;
  const value: BlockClipboard = { version: 1, sourcePageId: controller.session.pageId, blocks: [] };
  const cuts: TextRange["cuts"] = [];
  for (const id of ordered.slice(fromIndex, toIndex + 1)) {
    const editor = controller.registry.current.get(id);
    const paragraph = editor?.state.doc.firstChild;
    if (!editor || !paragraph) continue;
    const from = id === first ? editor.view.posAtDOM(range.startContainer, range.startOffset) : 1;
    const to =
      id === last ? editor.view.posAtDOM(range.endContainer, range.endOffset) : paragraph.content.size + 1;
    value.blocks.push({
      id,
      type: "paragraph",
      parentId: null,
      position: "U",
      attributes: {},
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: paragraph.content.cut(from - 1, to - 1).toJSON() ?? [] }],
      },
    });
    cuts.push({ id, from, to });
  }
  const media: string[] = [];
  const frames = [
    ...(root?.querySelectorAll<HTMLElement>('[data-block-type="image"],[data-block-type="file"]') ?? []),
  ].filter((frame) => range.intersectsNode(frame));
  if (frames.length) {
    const projected = validateContentDocument(controller.session.document).blocks;
    for (const frame of frames) {
      const block = projected.find((block) => block.id === frame.dataset.editorBlock);
      if (block) {
        value.blocks.push({ ...block, parentId: null });
        media.push(block.id);
      }
    }
    const elements = new Map([...controller.registry.current].map(([id, editor]) => [id, editor.view.dom]));
    for (const frame of frames) if (frame.dataset.editorBlock) elements.set(frame.dataset.editorBlock, frame);
    value.blocks.sort((first, second) => {
      const from = elements.get(first.id);
      const to = elements.get(second.id);
      return from && to && from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }
  return { value, cuts, media };
}

export function usePageEditorClipboard(
  controller: PageEditorController,
  root: RefObject<HTMLDivElement | null>,
  editable: boolean,
) {
  const copy = (event: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if (event.target instanceof Element && event.target.closest("[data-table-cell-selection]")) return;
    if (!(event.target instanceof Element) || event.target.closest("input,textarea,select")) return;
    const selected = controller.selectedRef.current;
    try {
      const range = selected.length ? null : nativeTextRange(controller, root.current);
      const value = selected.length
        ? selectedClipboard(controller.session.page, selected, controller.session.pageId)
        : range?.value;
      if (!value?.blocks.length) return;
      event.clipboardData.setData(BLOCKS_CLIPBOARD_MIME, JSON.stringify(value));
      event.clipboardData.setData("text/plain", clipboardPlainText(value));
      event.preventDefault();
      event.stopPropagation();
      if (!cut || !editable) return;
      controller.run(() => {
        if (selected.length) removeBlockSelection(controller.session.page, selected);
        else if (range)
          runEditorPlan(controller.session.page, controller.registry.current, (plan) => {
            for (const edit of range.cuts) plan.edit(edit.id, edit.from, edit.to);
            if (range.media.length) removeBlockSelection(plan.page, range.media);
          });
      });
      controller.setSelected([]);
    } catch {
      controller.setError("Não foi possível copiar a seleção. Seu conteúdo foi preservado.");
    }
  };
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-table-cell-selection]")) return;
    if (!editable || !(event.target instanceof Element) || event.target.closest("input,textarea,select"))
      return;
    const id =
      event.target.closest<HTMLElement>("[data-block-text]")?.dataset.blockText ?? controller.active?.id;
    const editor: Editor | undefined = id ? controller.registry.current.get(id) : undefined;
    if (id && controller.session.page.getBlock(id)?.type === "code") return;
    const custom = event.clipboardData.getData(BLOCKS_CLIPBOARD_MIME);
    const plain = event.clipboardData.getData("text/plain");
    const html = event.clipboardData.getData("text/html");
    const selected = controller.selectedRef.current;
    if (!custom && !plain && !html) return;
    try {
      if (
        !custom &&
        !selected.length &&
        editor &&
        !editor.state.selection.empty &&
        !html &&
        isSafeContentLink(plain)
      ) {
        event.preventDefault();
        event.stopPropagation();
        editor.commands.setMark("link", { href: plain });
        return;
      }
      let value = custom
        ? readBlockClipboard(custom)
        : html && editor
          ? htmlClipboard(html, editor, controller.session.pageId)
          : null;
      if (
        !selected.length &&
        editor &&
        id &&
        value &&
        ((!custom && value.blocks.length <= 1) ||
          (controller.session.page.getBlock(id)?.type === "tableCell" &&
            value.blocks.every((block) => block.type === "paragraph")))
      ) {
        event.preventDefault();
        event.stopPropagation();
        const content = value.blocks.flatMap((block, index) => [
          ...(index ? [{ type: "hardBreak" as const }] : []),
          ...(block.content.content[0]?.content ?? []),
        ]);
        if (!content.length) return;
        const { from, to } = editor.state.selection;
        runEditorPlan(controller.session.page, controller.registry.current, (plan) =>
          plan.edit(id, from, to, content),
        );
        controller.setMenu(null);
        controller.setError("");
        controller.focus(
          id,
          from + content.reduce((size, node) => size + (node.type === "text" ? node.text.length : 1), 0),
        );
        return;
      }
      if (!value && !selected.length && (!editor || !id)) return;
      event.preventDefault();
      event.stopPropagation();
      let next: { id: string; position: number } | null;
      if (!value && selected.length)
        value = {
          version: 1,
          sourcePageId: controller.session.pageId,
          blocks: plain
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .map((line) => ({
              id: crypto.randomUUID(),
              type: "paragraph",
              parentId: null,
              position: "U",
              attributes: {},
              content: {
                type: "doc",
                content: [{ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] }],
              },
            })),
        };
      if (value)
        next = pasteBlocks(
          controller.session.page,
          controller.registry.current,
          value,
          controller.session.pageId,
          id,
          selected,
        );
      else if (id) next = pastePlainLines(controller.session.page, controller.registry.current, id, plain);
      else return;
      controller.setSelected([]);
      controller.setMenu(null);
      controller.setError("");
      if (next) controller.focus(next.id, next.position);
    } catch (error) {
      event.preventDefault();
      event.stopPropagation();
      controller.setError(
        error instanceof CrossPageFilePasteError
          ? "Arquivos de outra página precisam ser enviados novamente. A seleção e os arquivos foram preservados."
          : "Não foi possível colar esse conteúdo. A seleção foi preservada. Confira o formato ou cole em partes menores.",
      );
    }
  };
  return {
    onCopyCapture: (event: ClipboardEvent<HTMLDivElement>) => copy(event, false),
    onCutCapture: (event: ClipboardEvent<HTMLDivElement>) => copy(event, true),
    onPasteCapture: paste,
  };
}
