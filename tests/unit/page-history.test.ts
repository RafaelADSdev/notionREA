import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";
import { type BlockType, StablePage } from "../../src/features/editor/model/stable-page";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function peer(update?: Uint8Array) {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  else initializeContentDocument(document);
  const page = new StablePage(document, `history-${crypto.randomUUID()}`);
  const editors: Editor[] = [];
  cleanups.push(() => {
    for (const editor of editors) editor.destroy();
    page.destroy();
    document.destroy();
  });
  const bind = (id: string) => {
    const editor = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: [...createTextExtensions(), pageCollaboration(page, id)],
    });
    editors.push(editor);
    return editor;
  };
  const create = (
    id: string,
    text = "",
    type: BlockType = "paragraph",
    parentId: string | null = null,
    position = "m",
  ) => {
    page.createBlock({ id, type, parentId, position });
    const editor = bind(id);
    if (text) editor.commands.insertContent(text);
    return editor;
  };
  return { document, page, bind, create };
}

function exchange(first: ReturnType<typeof peer>, second: ReturnType<typeof peer>) {
  const firstUpdate = Y.encodeStateAsUpdate(first.document);
  const secondUpdate = Y.encodeStateAsUpdate(second.document);
  Y.applyUpdate(first.document, secondUpdate, "remote-history-update");
  Y.applyUpdate(second.document, firstUpdate, "remote-history-update");
}

function expectCanonicalReload(document: Y.Doc) {
  const projection = validateContentDocument(document);
  const reload = peer(Y.encodeStateAsUpdate(document));
  expect(validateContentDocument(reload.document)).toEqual(projection);
  return projection;
}

describe("page-owned author-local history", () => {
  it("retains a newly created column origin referenced by a remote row", () => {
    const creator = peer();
    creator.page.runAction(() => {
      creator.page.createBlock({ id: "table", type: "table", parentId: null, position: "m" });
      creator.page.createBlock({ id: "origin-row", type: "tableRow", parentId: "table", position: "m" });
      creator.create("column-origin", "OWN HEADER", "tableCell", "origin-row");
      creator.page.setBlockAttributes("column-origin", { columnId: "column-origin" });
    });
    const remote = peer(Y.encodeStateAsUpdate(creator.document));
    remote.page.runAction(() => {
      remote.page.createBlock({ id: "remote-row", type: "tableRow", parentId: "table", position: "z" });
      remote.create("remote-cell", "REMOTE CELL", "tableCell", "remote-row");
      remote.page.setBlockAttributes("remote-cell", { columnId: "column-origin" });
    });
    exchange(creator, remote);
    expect(creator.page.undo()).toBe(true);
    expect(creator.page.getBlock("column-origin")).toMatchObject({
      type: "tableCell",
      parentId: "origin-row",
    });
    expect(expectCanonicalReload(creator.document).text).toBe("REMOTE CELL");
  });
  it("undoes a creation's own characters while keeping later remote characters visible and redo restores without duplicates", () => {
    const creator = peer();
    let editor: Editor | undefined;
    creator.page.runAction(() => {
      editor = creator.create("created", "OWN", "heading");
      creator.page.setBlockAttributes("created", { level: 2 });
    });
    expect(creator.page.undoManager.undoStack).toHaveLength(1);
    const remote = peer(Y.encodeStateAsUpdate(creator.document));
    remote.bind("created").commands.insertContentAt(4, "REMOTE");
    exchange(creator, remote);
    expect(validateContentDocument(creator.document).text).toBe("OWNREMOTE");

    expect(creator.page.undo()).toBe(true);
    expect(expectCanonicalReload(creator.document).text).toBe("REMOTE");
    expect(editor?.getText()).toBe("REMOTE");
    expect(creator.page.visibleChildren().map((block) => block.id)).toEqual(["created"]);
    exchange(creator, remote);
    expect(expectCanonicalReload(remote.document).text).toBe("REMOTE");

    expect(creator.page.redo()).toBe(true);
    expect(expectCanonicalReload(creator.document).text).toBe("OWNREMOTE");
    expect(creator.page.visibleChildren().map((block) => block.id)).toEqual(["created"]);
    exchange(creator, remote);
    expect(expectCanonicalReload(remote.document).text).toBe("OWNREMOTE");
  });

  it("keeps a remote-created child and its necessary locally-created container ancestors when the creator undoes creation", () => {
    const creator = peer();
    creator.page.runAction(() => {
      creator.create("outer", "OWN OUTER", "toggle");
      creator.create("inner", "OWN INNER", "quote", "outer");
    });
    expect(creator.page.undoManager.undoStack).toHaveLength(1);
    const remote = peer(Y.encodeStateAsUpdate(creator.document));
    remote.page.runAction(() => {
      remote.create("remote-child", "REMOTE CHILD", "paragraph", "inner");
    });
    exchange(creator, remote);

    expect(creator.page.undo()).toBe(true);
    const undone = expectCanonicalReload(creator.document);
    expect(undone.text).toBe("REMOTE CHILD");
    expect(undone.blocks.map((block) => block.id)).toEqual(["outer", "inner", "remote-child"]);
    expect(creator.page.getBlock("inner")?.parentId).toBe("outer");
    expect(creator.page.getBlock("remote-child")?.parentId).toBe("inner");
    exchange(creator, remote);
    expect(expectCanonicalReload(remote.document)).toEqual(undone);

    expect(creator.page.redo()).toBe(true);
    const redone = expectCanonicalReload(creator.document);
    expect(redone.text).toBe("OWN OUTER\nOWN INNER\nREMOTE CHILD");
    expect(redone.blocks.map((block) => block.id)).toEqual(["outer", "inner", "remote-child"]);
    exchange(creator, remote);
    expect(expectCanonicalReload(remote.document)).toEqual(redone);
  });

  it("still removes an ordinary local creation that has no remote contribution", () => {
    const creator = peer();
    creator.page.runAction(() => {
      creator.create("only-local", "OWN ONLY");
    });
    expect(creator.page.undo()).toBe(true);
    expect(expectCanonicalReload(creator.document).blocks).toEqual([]);
    expect(creator.page.redo()).toBe(true);
    expect(expectCanonicalReload(creator.document).text).toBe("OWN ONLY");
  });

  it("undoes and redoes ordinary placements despite an existing remote text baseline", () => {
    const seed = peer();
    seed.create("container", "", "toggle", null, "b");
    seed.create("entry", "REMOTE BASELINE", "paragraph", null, "m");
    const local = peer(Y.encodeStateAsUpdate(seed.document));
    local.bind("entry");
    local.page.runAction(() => local.page.moveBlock("entry", "container", "m"));
    expect(local.page.getBlock("entry")?.parentId).toBe("container");
    expect(local.page.undo()).toBe(true);
    expect(local.page.getBlock("entry")?.parentId).toBeNull();
    expect(expectCanonicalReload(local.document).text).toBe("REMOTE BASELINE");
    expect(local.page.redo()).toBe(true);
    expect(local.page.getBlock("entry")?.parentId).toBe("container");
    expect(expectCanonicalReload(local.document).text).toBe("REMOTE BASELINE");
  });

  it("undoes and redoes a type transformation of an old block with remote text", () => {
    const seed = peer();
    seed.create("entry", "REMOTE BASELINE");
    const local = peer(Y.encodeStateAsUpdate(seed.document));
    local.bind("entry");
    local.page.runAction(() => {
      local.page.transformBlock("entry", "heading");
      local.page.setBlockAttributes("entry", { level: 3 });
    });
    expect(local.page.undo()).toBe(true);
    expect(local.page.getBlock("entry")?.type).toBe("paragraph");
    expect(local.page.getBlockAttributes("entry")).toEqual({});
    expect(expectCanonicalReload(local.document).text).toBe("REMOTE BASELINE");
    expect(local.page.redo()).toBe(true);
    expect(local.page.getBlock("entry")?.type).toBe("heading");
    expect(local.page.getBlockAttributes("entry")).toEqual({ level: 3 });
    expect(expectCanonicalReload(local.document).text).toBe("REMOTE BASELINE");
  });

  it("undoes and redoes only the changed attribute of an existing remotely-authored block", () => {
    const seed = peer();
    seed.create("entry", "REMOTE BASELINE", "callout");
    seed.page.setBlockAttributes("entry", { tone: "copper" });
    const local = peer(Y.encodeStateAsUpdate(seed.document));
    local.bind("entry");
    local.page.runAction(() => local.page.setBlockAttributes("entry", { tone: "green" }));
    expect(local.page.undo()).toBe(true);
    expect(local.page.getBlockAttributes("entry")).toEqual({ tone: "copper" });
    expect(expectCanonicalReload(local.document).text).toBe("REMOTE BASELINE");
    expect(local.page.redo()).toBe(true);
    expect(local.page.getBlockAttributes("entry")).toEqual({ tone: "green" });
    expect(expectCanonicalReload(local.document).text).toBe("REMOTE BASELINE");
  });
});
