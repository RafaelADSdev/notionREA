import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addColumn,
  columnLayout,
  removeColumn,
  setColumnWeight,
} from "../../src/features/editor/model/column-layout";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function peer(update?: Uint8Array) {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  else initializeContentDocument(document);
  const page = new StablePage(document, "column-author");
  const editors: Editor[] = [];
  cleanups.push(() => {
    for (const editor of editors) editor.destroy();
    page.destroy();
    document.destroy();
  });
  const edit = (id: string, text: string) => {
    const editor = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: [...createTextExtensions(), pageCollaboration(page, id)],
    });
    editors.push(editor);
    editor.commands.insertContentAt(1, { type: "text", text, marks: [{ type: "bold" }] });
    return editor;
  };
  return { document, page, edit };
}
function group(page: StablePage, id = "group") {
  page.runAction(() => {
    page.createBlock({ id, type: "columns", parentId: null, position: "U" });
    page.createBlock({ id: `${id}-a`, type: "column", parentId: id, position: "F" });
    page.createBlock({ id: `${id}-b`, type: "column", parentId: id, position: "U" });
    page.setBlockAttributes(id, { widths: [2, 1] });
  });
  return id;
}
function paragraph(page: StablePage, id: string, parentId: string, position: string) {
  page.createBlock({ id, type: "paragraph", parentId, position });
}

describe("column composition", () => {
  it("adds a stable column and updates weights in one undo group", () => {
    const source = peer();
    const id = group(source.page);
    paragraph(source.page, "kept", "group-a", "U");
    source.edit("kept", "kept");
    const fragment = source.page.fragment("kept");
    source.page.undoManager.clear();
    const added = addColumn(source.page, id);
    expect(columnLayout(source.page, id).columns.map((column) => column.id)).toEqual([
      "group-a",
      "group-b",
      added,
    ]);
    expect(columnLayout(source.page, id).weights).toEqual([2, 1, 1]);
    expect(source.page.fragment("kept")).toBe(fragment);
    expect(source.page.undoManager.undoStack).toHaveLength(1);
    source.page.undo();
    expect(columnLayout(source.page, id).weights).toEqual([2, 1]);
    source.page.redo();
    expect(columnLayout(source.page, id).columns[2]?.id).toBe(added);
    validateContentDocument(source.document);
  });
  it("moves every child, including hidden children, before tombstoning a removed column", () => {
    const source = peer();
    const id = group(source.page);
    const third = addColumn(source.page, id);
    paragraph(source.page, "existing", "group-b", "U");
    paragraph(source.page, "first", third, "F");
    paragraph(source.page, "hidden", third, "M");
    paragraph(source.page, "last", third, "U");
    source.edit("first", "first bold");
    source.edit("hidden", "hidden bold");
    source.edit("last", "last bold");
    source.page.removeBlock("hidden");
    const fragments = ["first", "hidden", "last"].map((child) => source.page.fragment(child));
    source.page.undoManager.clear();
    expect(removeColumn(source.page, id, third)).toBe("group-b");
    expect(source.page.visibleChildren("group-b").map((child) => child.id)).toEqual([
      "existing",
      "first",
      "last",
    ]);
    expect(source.page.getBlock("hidden")?.parentId).toBe("group-b");
    expect(source.page.undoManager.undoStack).toHaveLength(1);
    for (const [index, child] of ["first", "hidden", "last"].entries())
      expect(source.page.fragment(child)).toBe(fragments[index]);
    source.page.undo();
    expect(source.page.getBlock("hidden")?.parentId).toBe(third);
    expect(columnLayout(source.page, id).columns).toHaveLength(3);
    source.page.redo();
    source.page.restoreBlock("hidden");
    expect(source.page.visibleChildren("group-b").map((child) => child.id)).toEqual([
      "existing",
      "first",
      "hidden",
      "last",
    ]);
    const reload = peer(Y.encodeStateAsUpdate(source.document));
    expect(validateContentDocument(reload.document).text).toContain("hidden bold");
    const first = validateContentDocument(reload.document).blocks.find((block) => block.id === "first");
    expect(first?.content.content[0]?.content[0]).toEqual({
      type: "text",
      text: "first bold",
      marks: [{ type: "bold" }],
    });
  });
  it("keeps accepted remote text through removal, undo and reload", () => {
    const left = peer();
    const id = group(left.page);
    const third = addColumn(left.page, id);
    paragraph(left.page, "edited", third, "U");
    left.edit("edited", "local");
    const right = peer(Y.encodeStateAsUpdate(left.document));
    right.edit("edited", "REMOTE ");
    left.page.undoManager.clear();
    removeColumn(left.page, id, third);
    const a = Y.encodeStateAsUpdate(left.document);
    const b = Y.encodeStateAsUpdate(right.document);
    Y.applyUpdate(left.document, b, "remote");
    Y.applyUpdate(right.document, a, "remote");
    expect(validateContentDocument(left.document).text).toBe("REMOTE local");
    expect(columnLayout(left.page, id)).toEqual(columnLayout(right.page, id));
    left.page.undo();
    expect(left.page.getBlock("edited")?.parentId).toBe(third);
    expect(validateContentDocument(left.document).text).toBe("REMOTE local");
    left.page.redo();
    const reload = peer(Y.encodeStateAsUpdate(left.document));
    expect(validateContentDocument(reload.document).text).toBe("REMOTE local");
  });
  it("uses actual visible columns for stale widths after duplicate, reorder or deletion", () => {
    const source = peer();
    const id = group(source.page);
    source.page.createBlock({ id: "duplicate", type: "column", parentId: id, position: "Z" });
    expect(columnLayout(source.page, id).weights).toEqual([1, 1, 1]);
    source.page.moveBlock("duplicate", id, "A");
    expect(columnLayout(source.page, id).columns.map((column) => column.id)).toEqual([
      "duplicate",
      "group-a",
      "group-b",
    ]);
    source.page.removeBlock("group-a");
    expect(columnLayout(source.page, id).columns.map((column) => column.id)).toEqual([
      "duplicate",
      "group-b",
    ]);
    validateContentDocument(source.document);
  });
  it("validates weights, group membership, minimum and maximum before any mutation", () => {
    const source = peer();
    const id = group(source.page);
    group(source.page, "other");
    const unchanged = () => Y.encodeStateAsUpdate(source.document);
    for (const operation of [
      () => removeColumn(source.page, id, "group-a"),
      () => removeColumn(source.page, id, "other-a"),
      () => setColumnWeight(source.page, id, "other-a", 2),
      ...[0, -1, 100.01, Number.NaN, Number.POSITIVE_INFINITY].map(
        (weight) => () => setColumnWeight(source.page, id, "group-a", weight),
      ),
    ]) {
      const before = unchanged();
      expect(operation).toThrow();
      expect(unchanged()).toEqual(before);
    }
    setColumnWeight(source.page, id, "group-a", 0.01);
    expect(columnLayout(source.page, id).weights).toEqual([0.01, 1]);
    for (let count = 2; count < 12; count++) addColumn(source.page, id);
    const before = unchanged();
    expect(() => addColumn(source.page, id)).toThrow();
    expect(unchanged()).toEqual(before);
    expect(columnLayout(source.page, id).columns).toHaveLength(12);
  });
});
