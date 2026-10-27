import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  duplicateBlockSelection,
  indentBlockSelection,
  insertBlock,
  moveBlockSelection,
  orderedBlocks,
  removeBlockSelection,
  transformBlockSelection,
} from "../../src/features/editor/model/block-commands";
import { between, rebalancePositions } from "../../src/features/editor/model/block-order";
import { type BlockType, StablePage } from "../../src/features/editor/model/stable-page";

const peers: { document: Y.Doc; page: StablePage }[] = [];
function peer(update?: Uint8Array) {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  const page = new StablePage(document, "local");
  const result = { document, page };
  peers.push(result);
  return result;
}
function block(
  page: StablePage,
  id: string,
  type: BlockType = "paragraph",
  parentId: string | null = null,
  position = "m",
) {
  page.createBlock({ id, type, parentId, position });
}
function text(page: StablePage, id: string, value: string) {
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  paragraph.insert(0, [content]);
  page.fragment(id).insert(0, [paragraph]);
  content.insert(0, value);
  content.format(0, value.length, { bold: {} });
  return content;
}
function children(page: StablePage, parentId: string | null = null) {
  return orderedBlocks(page)
    .filter((entry) => entry.parentId === parentId)
    .map((entry) => entry.id);
}
function expectAtomicRejection(page: StablePage, action: () => void) {
  const before = Y.encodeStateAsUpdate(page.document);
  expect(action).toThrow();
  expect(Buffer.compare(Y.encodeStateAsUpdate(page.document), before)).toBe(0);
}
afterEach(() => {
  for (const { page, document } of peers.splice(0)) {
    page.destroy();
    document.destroy();
  }
});

describe("ordinal fractional block order", () => {
  it("uses base62 ordinal intervals, including adjacent digits and prefix exhaustion", () => {
    expect(between(null, null)).toBe("U");
    expect(between("A", "B")).toBe("AU");
    expect(between("A", "A0")).toBeNull();
    expect(between(null, "0")).toBeNull();
    expect(between("z".repeat(128), null)).toBeNull();
    expect(between("m", "a")).toBeNull();
    expect(between("a", "a")).toBeNull();
  });

  it("rebalances into deterministic spaced fixed-width ordinal keys", () => {
    const positions = rebalancePositions(1000);
    expect(positions).toHaveLength(1000);
    expect(new Set(positions).size).toBe(1000);
    expect(positions.every((position) => /^[0-9A-Za-z]{13}$/.test(position))).toBe(true);
    expect([...positions].sort()).toEqual(positions);
    expect(rebalancePositions(1000)).toEqual(positions);
    for (let index = 1; index < positions.length; index++) {
      expect(between(positions[index - 1] ?? null, positions[index] ?? null)).not.toBeNull();
    }
  });
});

describe("block selection commands", () => {
  it("returns visible preorder with stable ordinal position and identity tie breaks", () => {
    const { page } = peer();
    block(page, "last", "paragraph", null, "a");
    block(page, "parent", "toggle", null, "A");
    block(page, "child", "paragraph", "parent", "Z");
    block(page, "alpha", "paragraph", null, "a");
    block(page, "removed", "toggle", null, "0");
    block(page, "hidden", "paragraph", "removed");
    page.removeBlock("removed");
    expect(orderedBlocks(page).map((entry) => entry.id)).toEqual(["parent", "child", "alpha", "last"]);
  });

  it("inserts with a fresh UUID and atomically rebalances an exhausted sibling interval", () => {
    const { page } = peer();
    block(page, "first", "paragraph", null, "0");
    const fragment = page.fragment("first");
    const id = insertBlock(page, {
      type: "heading",
      parentId: null,
      beforeId: "first",
      attributes: { level: 2 },
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(children(page)).toEqual([id, "first"]);
    expect(page.getBlockAttributes(id)).toEqual({ level: 2 });
    expect(page.fragment("first")).toBe(fragment);
    expect(page.undo()).toBe(true);
    expect(children(page)).toEqual(["first"]);
    expect(page.getBlock("first")?.position).toBe("0");
  });

  it("validates attributes and destination compatibility before insertion or rebalance", () => {
    const { page } = peer();
    block(page, "first", "paragraph", null, "0");
    expectAtomicRejection(page, () =>
      insertBlock(page, { type: "heading", parentId: null, beforeId: "first", attributes: { level: 9 } }),
    );
    expectAtomicRejection(page, () => insertBlock(page, { type: "tableCell", parentId: null }));
  });

  it("moves selection roots from multiple parents in preorder without rewriting descendant content", () => {
    const { page } = peer();
    block(page, "left", "toggle", null, "a");
    block(page, "right", "toggle", null, "b");
    block(page, "target", "toggle", null, "c");
    block(page, "first", "toggle", "left", "a");
    block(page, "nested", "paragraph", "first");
    block(page, "second", "paragraph", "right");
    text(page, "nested", "Keep remote-compatible identity");
    const fragment = page.fragment("nested");
    const xml = fragment.toJSON();
    moveBlockSelection(page, ["second", "nested", "first", "first"], "target", null);
    expect(children(page, "target")).toEqual(["first", "second"]);
    expect(page.getBlock("nested")?.parentId).toBe("first");
    expect(page.fragment("nested")).toBe(fragment);
    expect(fragment.toJSON()).toEqual(xml);
    expect(page.undo()).toBe(true);
    expect(page.getBlock("first")?.parentId).toBe("left");
    expect(page.getBlock("second")?.parentId).toBe("right");
  });

  it("rejects cycles, invalid siblings and incompatible members without moving an earlier member", () => {
    const { page } = peer();
    block(page, "parent", "toggle", null, "a");
    block(page, "child", "paragraph", "parent");
    block(page, "table", "table", null, "b");
    block(page, "row", "tableRow", "table");
    expectAtomicRejection(page, () => moveBlockSelection(page, ["parent"], "child", null));
    expectAtomicRejection(page, () => moveBlockSelection(page, ["parent", "missing"], null, null));
    expectAtomicRejection(page, () => moveBlockSelection(page, ["child", "row"], null, null));
    expectAtomicRejection(page, () => moveBlockSelection(page, ["child"], null, "row"));
    expectAtomicRejection(page, () => moveBlockSelection(page, ["parent"], null, "parent"));
  });

  it("removes parent selections once and restores the whole visible selection in one undo", () => {
    const { page } = peer();
    block(page, "parent", "toggle", null, "a");
    block(page, "child", "paragraph", "parent");
    block(page, "other", "paragraph", null, "b");
    removeBlockSelection(page, ["other", "child", "parent"]);
    expect(orderedBlocks(page)).toEqual([]);
    expect(page.document.getMap("removed").has("child")).toBe(false);
    expect(page.undo()).toBe(true);
    expect(orderedBlocks(page).map((entry) => entry.id)).toEqual(["parent", "child", "other"]);
  });

  it("duplicates visible subtrees with new identities, cloned marks and shared authorized file identities", () => {
    const { page } = peer();
    block(page, "parent", "toggle");
    block(page, "child", "paragraph", "parent", "a");
    block(page, "file", "file", "parent", "b");
    block(page, "deleted", "paragraph", "parent", "c");
    page.removeBlock("deleted");
    const fileId = "20000000-0000-4000-8000-000000000001";
    page.setBlockAttributes("file", { fileId, displayName: "Anexo.pdf" });
    const originalText = text(page, "child", "Original marked text");
    const fragment = page.fragment("child");
    const [duplicate] = duplicateBlockSelection(page, ["child", "parent"]);
    expect(duplicate).toBeDefined();
    if (!duplicate) throw new Error("Missing duplicate root");
    const copied = orderedBlocks(page).filter((entry) => entry.parentId === duplicate);
    expect(copied).toHaveLength(2);
    expect(copied.every((entry) => !["child", "file", "deleted"].includes(entry.id))).toBe(true);
    const copiedText = copied.find((entry) => entry.type === "paragraph");
    const copiedFile = copied.find((entry) => entry.type === "file");
    if (!copiedText || !copiedFile) throw new Error("Missing duplicate descendants");
    expect(page.fragment(copiedText.id)).not.toBe(fragment);
    expect(page.fragment(copiedText.id).toJSON()).toEqual(fragment.toJSON());
    expect(page.getBlockAttributes(copiedFile.id)).toEqual({ fileId, displayName: "Anexo.pdf" });
    originalText.insert(originalText.length, " original only");
    expect(page.fragment(copiedText.id).toString()).not.toContain("original only");
    expect(page.fragment("child")).toBe(fragment);
    expect(page.undo()).toBe(true);
    expect(children(page)).toEqual(["parent"]);
  });

  it("requires explicit child promotion to transform a container and groups promotion with type change", () => {
    const { page } = peer();
    block(page, "parent", "toggle", null, "a");
    block(page, "first", "paragraph", "parent", "a");
    block(page, "second", "paragraph", "parent", "b");
    block(page, "last", "paragraph", null, "z");
    text(page, "parent", "Keep this title and marks");
    const fragment = page.fragment("parent");
    const before = fragment.toJSON();
    expectAtomicRejection(page, () => transformBlockSelection(page, ["parent"], "paragraph"));
    transformBlockSelection(page, ["parent"], "paragraph", { promoteChildren: true });
    expect(children(page)).toEqual(["parent", "first", "second", "last"]);
    expect(page.getBlock("parent")?.type).toBe("paragraph");
    expect(page.fragment("parent")).toBe(fragment);
    expect(fragment.toJSON()).toEqual(before);
    expect(page.undo()).toBe(true);
    expect(page.getBlock("parent")?.type).toBe("toggle");
    expect(children(page, "parent")).toEqual(["first", "second"]);
  });

  it("does not turn text into a structural media block and conceal its rich content", () => {
    const { page } = peer();
    block(page, "subject");
    text(page, "subject", "Do not lose this content");
    expectAtomicRejection(page, () => transformBlockSelection(page, ["subject"], "image"));
  });

  it.each([
    ["image", { fileId: "20000000-0000-4000-8000-000000000001", alt: "Descrição original" }],
    ["file", { fileId: "20000000-0000-4000-8000-000000000001" }],
    ["databaseRef", { databaseId: "30000000-0000-4000-8000-000000000001" }],
  ] satisfies [BlockType, Record<string, unknown>][])(
    "does not discard a %s payload by transforming it to text",
    (type, attributes) => {
      const { page } = peer();
      block(page, "subject", type);
      page.setBlockAttributes("subject", attributes);
      expectAtomicRejection(page, () => transformBlockSelection(page, ["subject"], "paragraph"));
    },
  );

  it("can transform a paragraph whose remaining collaborative text node is empty", () => {
    const { page } = peer();
    block(page, "subject");
    const content = text(page, "subject", "Removed text");
    content.delete(0, content.length);
    const fragment = page.fragment("subject");
    transformBlockSelection(page, ["subject"], "divider");
    expect(page.getBlock("subject")?.type).toBe("divider");
    expect(page.fragment("subject")).toBe(fragment);
  });

  it("preflights every transformation before changing an earlier valid member", () => {
    const { page } = peer();
    block(page, "first", "toggle", null, "a");
    block(page, "second", "toggle", null, "b");
    block(page, "nested", "paragraph", "second");
    expectAtomicRejection(page, () => transformBlockSelection(page, ["first", "second"], "paragraph"));
    expect(page.getBlock("first")?.type).toBe("toggle");
  });

  it("preserves independently tombstoned children when explicitly promoting a container's children", () => {
    const { page } = peer();
    block(page, "parent", "toggle");
    block(page, "visible", "paragraph", "parent", "a");
    block(page, "removed", "paragraph", "parent", "b");
    page.removeBlock("removed");
    transformBlockSelection(page, ["parent"], "paragraph", { promoteChildren: true });
    expect(children(page)).toEqual(["parent", "visible"]);
    expect(page.getBlock("removed")?.parentId).toBeNull();
    expect(page.document.getMap("removed").get("removed")).toBe(true);
    expect(() => page.validate()).not.toThrow();
    expect(page.undo()).toBe(true);
    expect(page.getBlock("removed")?.parentId).toBe("parent");
    expect(page.document.getMap("removed").get("removed")).toBe(true);
  });

  it("duplicates selected sibling roots together after the last selected sibling", () => {
    const { page } = peer();
    block(page, "first", "paragraph", null, "a");
    block(page, "second", "paragraph", null, "b");
    block(page, "last", "paragraph", null, "z");
    const duplicates = duplicateBlockSelection(page, ["second", "first"]);
    expect(duplicates).toHaveLength(2);
    expect(children(page)).toEqual(["first", "second", ...duplicates, "last"]);
  });

  it("traverses and duplicates deep visible chains without imposing a page depth limit", () => {
    const { page } = peer();
    for (let index = 0; index < 250; index++) {
      block(page, `level-${index}`, "toggle", index === 0 ? null : `level-${index - 1}`);
    }
    const original = orderedBlocks(page);
    expect(original).toHaveLength(250);
    const [duplicate] = duplicateBlockSelection(page, ["level-0", "level-249"]);
    const result = orderedBlocks(page);
    expect(result).toHaveLength(500);
    expect(result[250]?.id).toBe(duplicate);
    expect(new Set(result.map((entry) => entry.id)).size).toBe(500);
  });

  it("rejects duplication exceeding the canonical 8MiB budget before creating any identity", () => {
    const { page } = peer();
    block(page, "subject");
    text(page, "subject", "v".repeat(4 * 1024 * 1024 + 1000));
    expectAtomicRejection(page, () => duplicateBlockSelection(page, ["subject"]));
    expect(children(page)).toEqual(["subject"]);
  });

  it("indents list/task roots under their previous sibling and outdents them in one undoable action", () => {
    const { page } = peer();
    block(page, "first", "bulletListItem", null, "a");
    block(page, "second", "task", null, "b");
    block(page, "third", "numberListItem", null, "c");
    expect(indentBlockSelection(page, ["third", "second"], 1)).toBe(true);
    expect(children(page, "first")).toEqual(["second", "third"]);
    expect(indentBlockSelection(page, ["second", "third"], -1)).toBe(true);
    expect(children(page)).toEqual(["first", "second", "third"]);
    expect(page.undo()).toBe(true);
    expect(children(page, "first")).toEqual(["second", "third"]);
    expect(page.undo()).toBe(true);
    expect(children(page)).toEqual(["first", "second", "third"]);
  });

  it("does not indent paragraphs or a first list item and rejects unknown selections atomically", () => {
    const { page } = peer();
    block(page, "first", "bulletListItem", null, "a");
    block(page, "paragraph", "paragraph", null, "b");
    const before = Y.encodeStateAsUpdate(page.document);
    expect(indentBlockSelection(page, ["first"], 1)).toBe(false);
    expect(indentBlockSelection(page, ["paragraph"], 1)).toBe(false);
    expect(Y.encodeStateAsUpdate(page.document)).toEqual(before);
    expectAtomicRejection(page, () => indentBlockSelection(page, ["missing"], 1));
  });

  it("converges after peers insert into the same exhausted ordinal interval", () => {
    const seed = peer();
    block(seed.page, "first", "paragraph", null, "0");
    const snapshot = Y.encodeStateAsUpdate(seed.document);
    const first = peer(snapshot);
    const second = peer(snapshot);
    const firstId = insertBlock(first.page, { type: "paragraph", parentId: null, beforeId: "first" });
    const secondId = insertBlock(second.page, { type: "paragraph", parentId: null, beforeId: "first" });
    const updates = [Y.encodeStateAsUpdate(first.document), Y.encodeStateAsUpdate(second.document)];
    for (const instance of [first, second])
      for (const update of updates) Y.applyUpdate(instance.document, update);
    const expected = [firstId, secondId].sort().concat("first");
    expect(children(first.page)).toEqual(expected);
    expect(children(second.page)).toEqual(expected);
    expect(first.page.getBlock("first")?.position).toBe(second.page.getBlock("first")?.position);
  });
});
