import type { Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { prosemirrorToYXmlFragment, ySyncPlugin, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { insertBlock, orderedBlocks, transformBlockSelection } from "./block-commands";
import type { BlockAttributes, BlockType } from "./block-schema";
import { validateContentDocument } from "./content-schema";
import { type BlockInput, StablePage } from "./stable-page";

export type TextCommandPosition = { id: string; position: number };
const listTypes = new Set<BlockType>(["bulletListItem", "numberListItem", "task"]);
const containerTypes = new Set<BlockType>(["toggle", "quote", "callout"]);
const textTypes = new Set<BlockType>(["paragraph", "heading", ...listTypes, ...containerTypes]);

function requireText(page: StablePage, id: string, editor: Editor): BlockInput {
  if (editor.isDestroyed || ySyncPluginKey.getState(editor.state)?.type !== page.fragment(id))
    throw new Error("Editor is not bound to this block");
  editor.state.doc.check();
  if (editor.state.doc.childCount !== 1 || editor.state.doc.firstChild?.type.name !== "paragraph")
    throw new Error("A text block must contain one paragraph");
  validateContentDocument(page.document);
  const block = orderedBlocks(page).find((entry) => entry.id === id);
  if (!block || !textTypes.has(block.type)) throw new Error("This block cannot use structural text commands");
  return block;
}

function hasChildren(page: StablePage, id: string): boolean {
  // Include hidden children: a later restore must never revive invalid nesting.
  return [...page.document.getMap("blocks").keys()].some((child) => page.getBlock(child)?.parentId === id);
}

function previewView(page: StablePage, id: string, schema: Schema, owner: Document): EditorView {
  return new EditorView(owner.createElement("div"), {
    state: EditorState.create({ schema, plugins: [ySyncPlugin(page.fragment(id))] }),
  });
}

function preview<T>(page: StablePage, action: (copy: StablePage) => T): T {
  const document = new Y.Doc();
  Y.applyUpdate(document, Y.encodeStateAsUpdate(page.document));
  const copy = new StablePage(document, "text-command-preflight");
  try {
    const result = action(copy);
    validateContentDocument(document);
    return result;
  } finally {
    copy.destroy();
    document.destroy();
  }
}

function copyParagraph(document: ProseMirrorNode, content: Fragment): ProseMirrorNode {
  const paragraph = document.firstChild;
  if (!paragraph) throw new Error("Missing stable paragraph");
  const result = document.copy(Fragment.from(paragraph.copy(content)));
  result.check();
  return result;
}

type InsertionPlan = { block: BlockInput; attributes: BlockAttributes; moves: BlockInput[] };
function planInsertion(
  page: StablePage,
  copy: StablePage,
  input: Parameters<typeof insertBlock>[1],
): InsertionPlan {
  const id = insertBlock(copy, input);
  const block = copy.getBlock(id);
  if (!block) throw new Error("Missing new text block");
  const moves = orderedBlocks(copy).filter((entry) => {
    const original = page.getBlock(entry.id);
    return original && (original.parentId !== entry.parentId || original.position !== entry.position);
  });
  return { block, attributes: copy.getBlockAttributes(id), moves };
}

function applyInsertion(page: StablePage, plan: InsertionPlan, content: ProseMirrorNode): void {
  page.createBlock(plan.block);
  if (Object.keys(plan.attributes).length) page.setBlockAttributes(plan.block.id, plan.attributes);
  for (const move of plan.moves) page.moveBlock(move.id, move.parentId, move.position);
  // This converter writes exclusively to a new fragment. The original paragraph is never replaced.
  prosemirrorToYXmlFragment(content, page.fragment(plan.block.id));
}

export function splitTextBlock(
  page: StablePage,
  id: string,
  editor: Editor,
  position: number,
): TextCommandPosition {
  const block = requireText(page, id, editor);
  const paragraph = editor.state.doc.firstChild;
  if (!paragraph) throw new Error("Missing stable paragraph");
  const end = paragraph.content.size + 1;
  if (!Number.isSafeInteger(position) || position < 1 || position > end)
    throw new Error("Invalid text split position");
  const selection = editor.state.selection;
  if (!selection.empty && (selection.from !== position || selection.from < 1 || selection.to > end))
    throw new Error("Split position must match the selected text");
  const from = selection.empty ? position : selection.from;
  const to = selection.empty ? position : selection.to;

  if (listTypes.has(block.type) && paragraph.content.size === 0) {
    if (hasChildren(page, id)) throw new Error("Choose how to preserve children before leaving this list");
    page.runAction(() => transformBlockSelection(page, [id], "paragraph"));
    return { id, position: 1 };
  }

  const container = containerTypes.has(block.type);
  const nextType = container || (block.type === "heading" && to === end) ? "paragraph" : block.type;
  const attributes =
    nextType === "task" ? { checked: false } : nextType === block.type ? page.getBlockAttributes(id) : {};
  const siblings = page.visibleChildren(block.parentId);
  const nextSibling = siblings[siblings.findIndex((entry) => entry.id === id) + 1];
  const content = copyParagraph(editor.state.doc, container ? Fragment.empty : paragraph.content.cut(to - 1));
  // Build and validate every operation on a separate binding before changing canonical state.
  const plan = preview(page, (copy) => {
    const view = previewView(copy, id, editor.schema, editor.view.dom.ownerDocument);
    try {
      let insertion: InsertionPlan | undefined;
      copy.runAction(() => {
        insertion = planInsertion(page, copy, {
          type: nextType,
          parentId: container ? id : block.parentId,
          beforeId: container ? (copy.visibleChildren(id)[0]?.id ?? null) : (nextSibling?.id ?? null),
          attributes,
        });
        prosemirrorToYXmlFragment(content, copy.fragment(insertion.block.id));
        if (!container) view.dispatch(view.state.tr.delete(from, end));
      });
      if (!insertion) throw new Error("Missing text insertion plan");
      return insertion;
    } finally {
      view.destroy();
    }
  });
  page.runAction(() => {
    applyInsertion(page, plan, content);
    if (!container) editor.view.dispatch(editor.state.tr.delete(from, end));
  });
  return { id: plan.block.id, position: 1 };
}

export function mergeTextBlock(
  page: StablePage,
  id: string,
  editor: Editor,
  previousEditor: Editor | undefined,
): TextCommandPosition | null {
  const block = requireText(page, id, editor);
  const selection = editor.state.selection;
  if (!selection.empty || selection.from !== 1 || hasChildren(page, id)) return null;
  if (block.type !== "paragraph") {
    page.runAction(() => transformBlockSelection(page, [id], "paragraph"));
    return { id, position: 1 };
  }
  const siblings = page.visibleChildren(block.parentId);
  const previous = siblings[siblings.findIndex((entry) => entry.id === id) - 1];
  if (!previous || !textTypes.has(previous.type) || !previousEditor) return null;
  requireText(page, previous.id, previousEditor);
  const source = editor.state.doc.firstChild;
  const target = previousEditor.state.doc.firstChild;
  if (!source || !target) throw new Error("Missing stable paragraph");
  // Separate leaf views own distinct Schema/NodeType instances, including their inline marks.
  const content = Fragment.fromJSON(previousEditor.schema, source.content.toJSON());
  const position = target.content.size + 1;
  previousEditor.state.tr.insert(position, content).doc.check();
  preview(page, (copy) => {
    const view = previewView(copy, previous.id, previousEditor.schema, previousEditor.view.dom.ownerDocument);
    try {
      copy.runAction(() => {
        view.dispatch(view.state.tr.insert(position, content));
        copy.removeBlock(id);
      });
    } finally {
      view.destroy();
    }
  });
  page.runAction(() => {
    previousEditor.view.dispatch(previousEditor.state.tr.insert(position, content));
    page.removeBlock(id);
  });
  return { id: previous.id, position };
}
