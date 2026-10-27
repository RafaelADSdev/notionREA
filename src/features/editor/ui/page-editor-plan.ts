import type { Editor } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { ySyncPlugin } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { MAX_UPDATE_BYTES } from "../model/content-limits";
import { validateContentDocument } from "../model/content-schema";
import { StablePage } from "../model/stable-page";

type TextEdit = { id: string; from: number; to: number; content: unknown };
export type EditorPlan = {
  page: StablePage;
  edit: (id: string, from: number, to: number, content?: unknown) => void;
};

/** Preview a compound action; apply only model operations and text deltas, never an old document snapshot. */
export function runEditorPlan<T>(
  page: StablePage,
  editors: ReadonlyMap<string, Editor>,
  action: (plan: EditorPlan) => T,
): T {
  const document = new Y.Doc();
  const before = Y.encodeStateVector(page.document);
  Y.applyUpdate(document, Y.encodeStateAsUpdate(page.document));
  const copy = new StablePage(document, "editor-action-preflight");
  const views = new Map<string, EditorView>();
  const edits: TextEdit[] = [];
  try {
    const output = {
      value: action({
        page: copy,
        edit(id, from, to, content = []) {
          const original = editors.get(id);
          if (!original || original.isDestroyed) throw new Error("Text view is unavailable");
          let view = views.get(id);
          if (!view) {
            view = new EditorView(original.view.dom.ownerDocument.createElement("div"), {
              state: EditorState.create({
                schema: original.schema,
                plugins: [ySyncPlugin(copy.fragment(id))],
              }),
            });
            // Prime the binding with its populated document before a first edit can make it empty.
            view.dispatch(view.state.tr.setMeta("addToHistory", false));
            views.set(id, view);
          }
          const fragment = Fragment.fromJSON(original.schema, content);
          view.dispatch(view.state.tr.replaceWith(from, to, fragment));
          edits.push({ id, from, to, content });
        },
      }),
    };
    validateContentDocument(document);
    if (Y.encodeStateAsUpdate(document, before).byteLength > MAX_UPDATE_BYTES)
      throw new Error("Paste or action is too large");
    const existing = new Set(page.document.getMap("blocks").keys());
    const all = [...document.getMap("blocks").keys()].map((id) => {
      const block = copy.getBlock(id);
      if (!block) throw new Error("Missing planned block");
      return block;
    });
    page.runAction(() => {
      for (const edit of edits) {
        const editor = editors.get(edit.id);
        if (!editor || editor.isDestroyed) throw new Error("Text view is unavailable");
        editor.view.dispatch(
          editor.state.tr.replaceWith(edit.from, edit.to, Fragment.fromJSON(editor.schema, edit.content)),
        );
      }
      for (const block of all) {
        const original = page.getBlock(block.id);
        if (original && (original.parentId !== block.parentId || original.position !== block.position))
          page.moveBlock(block.id, block.parentId, block.position);
      }
      for (const block of all) {
        if (existing.has(block.id) && page.getBlock(block.id)?.type !== block.type)
          page.transformBlock(block.id, block.type);
      }
      const pending = all.filter((block) => !existing.has(block.id));
      while (pending.length) {
        const index = pending.findIndex((block) => block.parentId === null || page.getBlock(block.parentId));
        if (index < 0) throw new Error("Invalid planned ancestry");
        const [block] = pending.splice(index, 1);
        if (!block) throw new Error("Missing new block");
        page.createBlock(block);
        const nodes = copy
          .fragment(block.id)
          .toArray()
          .map((node) => {
            if (!(node instanceof Y.XmlText) && !(node instanceof Y.XmlElement))
              throw new Error("Invalid planned text node");
            return node.clone();
          });
        if (nodes.length) page.fragment(block.id).insert(0, nodes);
      }
      for (const block of all) {
        const attributes = copy.getBlockAttributes(block.id);
        if (JSON.stringify(attributes) !== JSON.stringify(page.getBlockAttributes(block.id)))
          page.setBlockAttributes(block.id, attributes);
        if (
          document.getMap("removed").get(block.id) === true &&
          page.document.getMap("removed").get(block.id) !== true
        )
          page.removeBlock(block.id);
      }
    });
    return output.value;
  } finally {
    for (const view of views.values()) view.destroy();
    copy.destroy();
    document.destroy();
  }
}
