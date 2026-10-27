import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";
import { type BlockType, StablePage } from "../../src/features/editor/model/stable-page";
import { mergeTextBlock, splitTextBlock } from "../../src/features/editor/model/text-commands";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function peer(update?: Uint8Array) {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  else initializeContentDocument(document);
  const page = new StablePage(document, "local-text-author");
  const editors = new Map<string, Editor>();
  cleanups.push(() => {
    for (const editor of editors.values()) editor.destroy();
    page.destroy();
    document.destroy();
  });
  const bind = (id: string) => {
    const editor = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: [...createTextExtensions(), pageCollaboration(page, id)],
    });
    editors.set(id, editor);
    return editor;
  };
  const block = (
    id: string,
    text: string | JSONContent[] = "",
    type: BlockType = "paragraph",
    parentId: string | null = null,
    position = "m",
  ) => {
    page.createBlock({ id, type, parentId, position });
    const editor = bind(id);
    if (text.length) editor.commands.insertContent(text);
    return editor;
  };
  return { document, page, bind, block };
}
function textByBlock(document: Y.Doc) {
  return validateContentDocument(document).blocks.map(
    (block) =>
      block.content.content[0]?.content
        .map((inline) => (inline.type === "text" ? inline.text : ""))
        .join("") ?? "",
  );
}
function exchange(first: ReturnType<typeof peer>, second: ReturnType<typeof peer>) {
  const firstUpdate = Y.encodeStateAsUpdate(first.document);
  const secondUpdate = Y.encodeStateAsUpdate(second.document);
  Y.applyUpdate(first.document, secondUpdate, "remote");
  Y.applyUpdate(second.document, firstUpdate, "remote");
}

describe("stable block text commands", () => {
  it("splits a formatted selection without replacing the original paragraph and survives reload", () => {
    const source = peer();
    const editor = source.block("first", [
      { type: "text", text: "ab", marks: [{ type: "bold" }] },
      { type: "text", text: "cd", marks: [{ type: "strike" }] },
      { type: "text", text: "ef", marks: [{ type: "italic" }] },
    ]);
    const paragraph = source.page.fragment("first").get(0);
    editor.commands.setTextSelection({ from: 3, to: 5 });
    const next = splitTextBlock(source.page, "first", editor, 3);
    expect(next.position).toBe(1);
    expect(source.page.fragment("first").get(0)).toBe(paragraph);
    expect(textByBlock(source.document)).toEqual(["ab", "ef"]);
    const reloaded = peer(Y.encodeStateAsUpdate(source.document));
    expect(textByBlock(reloaded.document)).toEqual(["ab", "ef"]);
    expect(validateContentDocument(reloaded.document).blocks[1]?.content.content[0]?.content[0]).toEqual({
      type: "text",
      text: "ef",
      marks: [{ type: "italic" }],
    });
  });
  it("groups a split into one undo step", () => {
    const source = peer();
    const editor = source.block("first", "abcd");
    source.page.undoManager.clear();
    const result = splitTextBlock(source.page, "first", editor, 3);
    expect(source.page.undoManager.undoStack).toHaveLength(1);
    source.page.undo();
    expect(editor.getText()).toBe("abcd");
    expect(source.page.visibleChildren().map((block) => block.id)).toEqual(["first"]);
    expect(textByBlock(source.document)).toEqual(["abcd"]);
    source.page.redo();
    expect(textByBlock(source.document)).toEqual(["ab", "cd"]);
    expect(source.page.getBlock(result.id)).toBeDefined();
  });
  it("returns to paragraph at a heading end and preserves its level when splitting inside", () => {
    const source = peer();
    const editor = source.block("heading", "Title", "heading");
    source.page.setBlockAttributes("heading", { level: 3 });
    const end = splitTextBlock(source.page, "heading", editor, 6);
    expect(source.page.getBlock(end.id)?.type).toBe("paragraph");
    const middle = splitTextBlock(source.page, "heading", editor, 3);
    expect(source.page.getBlock(middle.id)?.type).toBe("heading");
    expect(source.page.getBlockAttributes(middle.id)).toEqual({ level: 3 });
  });
  it("preserves a stable empty left wrapper and inline atoms in the new fragment", () => {
    const source = peer();
    const pageId = "00000000-0000-4000-8000-000000000003";
    const editor = source.block("first", [
      { type: "text", text: "A", marks: [{ type: "underline" }] },
      { type: "hardBreak" },
      { type: "pageMention", attrs: { pageId } },
      { type: "text", text: "B" },
    ]);
    const wrapper = source.page.fragment("first").get(0);
    const result = splitTextBlock(source.page, "first", editor, 1);
    expect(source.page.fragment("first").get(0)).toBe(wrapper);
    expect(editor.getText()).toBe("");
    const projection = validateContentDocument(source.document);
    expect(projection.references).toEqual([pageId]);
    expect(projection.blocks.find((block) => block.id === result.id)?.content.content[0]?.content).toEqual([
      { type: "text", text: "A", marks: [{ type: "underline" }] },
      { type: "hardBreak" },
      { type: "pageMention", attrs: { pageId } },
      { type: "text", text: "B" },
    ]);
  });
  it("turns an empty list item into a paragraph with the same identity", () => {
    const source = peer();
    const editor = source.block("empty", "", "task");
    source.page.setBlockAttributes("empty", { checked: true });
    expect(splitTextBlock(source.page, "empty", editor, 1)).toEqual({ id: "empty", position: 1 });
    expect(source.page.getBlock("empty")?.type).toBe("paragraph");
    expect(source.page.visibleChildren()).toHaveLength(1);
  });
  it("creates an unchecked task and a paragraph child for a container title", () => {
    const source = peer();
    const task = source.block("task", "Done", "task", null, "b");
    source.page.setBlockAttributes("task", { checked: true });
    const next = splitTextBlock(source.page, "task", task, 5);
    expect(source.page.getBlockAttributes(next.id)).toEqual({ checked: false });
    const toggle = source.block("toggle", "Title", "toggle", null, "z");
    source.block("child", "Keep", "paragraph", "toggle", "m");
    const child = splitTextBlock(source.page, "toggle", toggle, 3);
    expect(toggle.getText()).toBe("Title");
    expect(source.page.visibleChildren("toggle").map((block) => block.id)).toEqual([child.id, "child"]);
  });
  it("appends inline marks minimally and tombstones the source without replacing fragments", () => {
    const source = peer();
    const previous = source.block("previous", "A", "paragraph", null, "b");
    const current = source.block(
      "current",
      [{ type: "text", text: "B", marks: [{ type: "bold" }] }],
      "paragraph",
      null,
      "m",
    );
    current.commands.setTextSelection(1);
    const wrapper = source.page.fragment("previous").get(0);
    const oldCurrent = source.page.fragment("current");
    source.page.undoManager.clear();
    expect(mergeTextBlock(source.page, "current", current, previous)).toEqual({
      id: "previous",
      position: 2,
    });
    expect(source.page.fragment("previous").get(0)).toBe(wrapper);
    expect(source.page.fragment("current")).toBe(oldCurrent);
    expect(current.getText()).toBe("B");
    expect(textByBlock(source.document)).toEqual(["AB"]);
    expect(source.page.undoManager.undoStack).toHaveLength(1);
    source.page.undo();
    expect(textByBlock(source.document)).toEqual(["A", "B"]);
  });
  it("preserves a concurrent insertion into the original right text during a split", () => {
    const local = peer();
    const editor = local.block("first", "abcd");
    local.page.undoManager.clear();
    const remote = peer(Y.encodeStateAsUpdate(local.document));
    const remoteEditor = remote.bind("first");
    splitTextBlock(local.page, "first", editor, 3);
    remoteEditor.commands.insertContentAt(4, "X");
    exchange(local, remote);
    expect(textByBlock(local.document).join("").split("").sort().join("")).toBe("Xabcd");
    expect(textByBlock(remote.document)).toEqual(textByBlock(local.document));
    local.page.undo();
    expect(editor.getText()).toBe("abcXd");
    expect(textByBlock(local.document)).toEqual(["abcXd"]);
  });
  it("undoes a merge without removing an accepted remote contribution", () => {
    const local = peer();
    const previous = local.block("previous", "A", "paragraph", null, "b");
    const current = local.block("current", "B", "paragraph", null, "m");
    current.commands.setTextSelection(1);
    local.page.undoManager.clear();
    const remote = peer(Y.encodeStateAsUpdate(local.document));
    const remotePrevious = remote.bind("previous");
    mergeTextBlock(local.page, "current", current, previous);
    remotePrevious.commands.insertContentAt(1, "R");
    exchange(local, remote);
    local.page.undo();
    expect(textByBlock(local.document)).toEqual(["RA", "B"]);
  });
  it("refuses code, wrong bounds, incompatible bindings and unsafe child deletion atomically", () => {
    const source = peer();
    const code = source.block("code", "literal", "code", null, "a");
    const list = source.block("list", "", "task", null, "b");
    source.block("child", "Keep", "paragraph", "list");
    const paragraph = source.block("paragraph", "text", "paragraph", null, "z");
    const before = Y.encodeStateAsUpdate(source.document);
    expect(() => splitTextBlock(source.page, "code", code, 2)).toThrow();
    expect(() => splitTextBlock(source.page, "paragraph", paragraph, 100)).toThrow();
    expect(() => splitTextBlock(source.page, "paragraph", list, 1)).toThrow();
    expect(() => splitTextBlock(source.page, "list", list, 1)).toThrow();
    list.commands.setTextSelection(1);
    expect(mergeTextBlock(source.page, "list", list, code)).toBeNull();
    expect(Y.encodeStateAsUpdate(source.document)).toEqual(before);
  });
  it("converts text containers on Backspace only when no child would be discarded", () => {
    const source = peer();
    const heading = source.block("heading", "Keep text", "heading", null, "b");
    const title = source.block("toggle", "Keep title", "toggle", null, "m");
    source.block("child", "Keep child", "paragraph", "toggle");
    heading.commands.setTextSelection(1);
    title.commands.setTextSelection(1);
    expect(mergeTextBlock(source.page, "heading", heading, undefined)).toEqual({
      id: "heading",
      position: 1,
    });
    expect(source.page.getBlock("heading")?.type).toBe("paragraph");
    expect(heading.getText()).toBe("Keep text");
    expect(mergeTextBlock(source.page, "toggle", title, heading)).toBeNull();
    expect(source.page.getBlock("toggle")?.type).toBe("toggle");
    expect(source.page.visibleChildren("toggle")[0]?.id).toBe("child");
  });
});
