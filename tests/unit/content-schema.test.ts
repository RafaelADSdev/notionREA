import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
  validateRichTextContent,
} from "../../src/features/editor/model/content-schema";
import { type BlockType, StablePage } from "../../src/features/editor/model/stable-page";

const pageId = "10000000-0000-4000-8000-000000000001";
const fileId = "20000000-0000-4000-8000-000000000001";
const databaseId = "30000000-0000-4000-8000-000000000001";
const viewId = "40000000-0000-4000-8000-000000000001";
const peers: { document: Y.Doc; page: StablePage }[] = [];
const standaloneDocuments: Y.Doc[] = [];

function peer(update?: Uint8Array) {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  else initializeContentDocument(document);
  const page = new StablePage(document, "local");
  const result = { document, page };
  peers.push(result);
  return result;
}

function block(page: StablePage, id: string, type: BlockType = "paragraph", parentId: string | null = null) {
  page.createBlock({ id, type, parentId, position: "m" });
}

function richText(page: StablePage, id: string, value: string, marks?: Record<string, unknown>) {
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  page.fragment(id).insert(0, [paragraph]);
  text.insert(0, value);
  if (marks) text.format(0, value.length, marks);
  return { paragraph, text };
}

function rawAttributes(document: Y.Doc, id: string, attributes: Record<string, unknown>) {
  document.getMap("attrs").set(id, new Y.Map(Object.entries(attributes)));
}

afterEach(() => {
  for (const { page, document } of peers.splice(0)) {
    page.destroy();
    document.destroy();
  }
  for (const document of standaloneDocuments.splice(0)) document.destroy();
});

describe("canonical content initialization and schema version", () => {
  it("initializes an empty versioned document without inventing a block", () => {
    const { document } = peer();
    expect(document.getMap("meta").get("schemaVersion")).toBe(1);
    expect(validateContentDocument(document)).toMatchObject({
      schemaVersion: 1,
      text: "",
      references: [],
      files: [],
      blocks: [],
    });
    const before = Y.encodeStateAsUpdate(document);
    initializeContentDocument(document);
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
  });

  it("refuses to overwrite an incompatible version during initialization", () => {
    const { document } = peer();
    document.getMap("meta").set("schemaVersion", 99);
    const before = Y.encodeStateAsUpdate(document);
    expect(() => initializeContentDocument(document)).toThrow();
    expect(document.getMap("meta").get("schemaVersion")).toBe(99);
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
    expect(() => validateContentDocument(document)).toThrow();
  });

  it.each([undefined, "1", 0, -1, 1.5, null])("rejects malformed schema version %s", (version) => {
    const { document } = peer();
    if (version === undefined) document.getMap("meta").delete("schemaVersion");
    else document.getMap("meta").set("schemaVersion", version);
    expect(() => validateContentDocument(document)).toThrow();
  });

  it("rejects an unknown root instead of silently discarding its payload", () => {
    const { document } = peer();
    document.getText("unexpected").insert(0, "unrecognized payload");
    expect(() => validateContentDocument(document)).toThrow();
  });

  it("rejects a root with an unexpected shared type", () => {
    const document = new Y.Doc();
    standaloneDocuments.push(document);
    document.getMap("meta").set("schemaVersion", 1);
    document.getArray("blocks").push(["malformed"]);
    expect(() => validateContentDocument(document)).toThrow();
  });
});

describe("canonical content corpus and projections", () => {
  it("validates clipboard rich text with the canonical inline allowlist", () => {
    const value = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "<literal>",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.test" } }],
            },
            { type: "pageMention", attrs: { pageId } },
          ],
        },
      ],
    };
    expect(validateRichTextContent(value)).toEqual(value);
    for (const malicious of [
      { type: "doc", content: [{ type: "paragraph", attrs: { style: "position:fixed" } }] },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            ],
          },
        ],
      },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "pageMention", attrs: { pageId, label: "Secret old title" } }],
          },
        ],
      },
      { type: "doc", content: [{ type: "rawHTML", content: [] }] },
    ])
      expect(() => validateRichTextContent(malicious)).toThrow();
  });
  it("preserves every block type, stable fragment and validated attribute across reload", () => {
    const { document, page } = peer();
    const corpus: [string, BlockType, string | null, Record<string, unknown>][] = [
      ["paragraph", "paragraph", null, {}],
      ["heading", "heading", null, { level: 2 }],
      ["bullet", "bulletListItem", null, {}],
      ["numbered", "numberListItem", null, {}],
      ["task", "task", null, { checked: true }],
      ["toggle", "toggle", null, {}],
      ["quote", "quote", null, {}],
      ["callout", "callout", null, { tone: "indigo" }],
      ["divider", "divider", null, {}],
      ["code", "code", null, { language: "javascript" }],
      ["image", "image", null, { fileId, alt: "Descrição original", caption: "Legenda", width: 640 }],
      ["file", "file", null, { fileId }],
      ["table", "table", null, { header: true }],
      ["row", "tableRow", "table", {}],
      ["cell", "tableCell", "row", {}],
      ["columns", "columns", null, { widths: [0.5, 0.5] }],
      ["left", "column", "columns", {}],
      ["right", "column", "columns", {}],
      ["nested", "paragraph", "left", {}],
      ["database", "databaseRef", null, { databaseId, viewId }],
    ];
    for (const [id, type, parentId, attributes] of corpus) {
      block(page, id, type, parentId);
      page.setBlockAttributes(id, attributes);
    }
    richText(page, "paragraph", "Texto com acentos");
    richText(page, "heading", "Título");
    richText(page, "cell", "Célula");
    richText(page, "nested", "Coluna");
    richText(page, "code", '<script>alert("literal")</script>');
    const projection = validateContentDocument(document);
    expect(projection.schemaVersion).toBe(1);
    expect(projection.text).toContain("Texto com acentos");
    expect(projection.text).toContain("Célula");
    expect(projection.text).toContain('<script>alert("literal")</script>');
    expect(projection.files).toEqual([fileId]);
    expect(projection.blocks.map((entry) => entry.id).sort()).toEqual(corpus.map(([id]) => id).sort());
    const reloaded = peer(Y.encodeStateAsUpdate(document));
    expect(validateContentDocument(reloaded.document)).toEqual(projection);
    for (const [id, , , attributes] of corpus)
      expect(reloaded.page.getBlockAttributes(id)).toEqual(attributes);
  });

  it("accepts all inline marks, palette colors, hard breaks and opaque page mentions", () => {
    const { document, page } = peer();
    block(page, "subject");
    const { paragraph, text } = richText(page, "subject", "Formatação");
    for (const mark of ["bold", "italic", "underline", "strike", "code"]) text.format(0, 1, { [mark]: {} });
    text.format(1, 1, { link: { href: "https://example.org/path?q=1" } });
    text.format(2, 1, { textStyle: { color: "indigo", background: "copper" } });
    const mention = new Y.XmlElement("pageMention");
    mention.setAttribute("pageId", pageId);
    paragraph.insert(paragraph.length, [new Y.XmlElement("hardBreak"), mention]);
    const projection = validateContentDocument(document);
    expect(projection.text).toContain("Formatação");
    expect(projection.references).toEqual([pageId]);
    expect(projection.text).not.toContain(pageId);
    expect(validateContentDocument(peer(Y.encodeStateAsUpdate(document)).document)).toEqual(projection);
  });

  it("hides a tombstoned subtree from derived text, references and files while retaining its content", () => {
    const { document, page } = peer();
    block(page, "parent", "toggle");
    block(page, "child", "paragraph", "parent");
    block(page, "attachment", "file", "parent");
    page.setBlockAttributes("attachment", { fileId });
    const { paragraph } = richText(page, "child", "Recoverable private text");
    const mention = new Y.XmlElement("pageMention");
    mention.setAttribute("pageId", pageId);
    paragraph.insert(1, [mention]);
    page.removeBlock("parent");
    expect(validateContentDocument(document)).toMatchObject({
      text: "",
      references: [],
      files: [],
      blocks: [],
    });
    expect(page.fragment("child").toString()).toContain("Recoverable private text");
    page.restoreBlock("parent");
    expect(validateContentDocument(document).references).toEqual([pageId]);
    expect(validateContentDocument(document).files).toEqual([fileId]);
  });

  it.each(["default", "indigo", "copper", "green", "red", "yellow"])(
    "accepts the accessible palette entry %s without storing CSS",
    (color) => {
      const { document, page } = peer();
      block(page, "subject");
      richText(page, "subject", "Palette", { textStyle: { color, background: color } });
      expect(validateContentDocument(document).text).toBe("Palette");
    },
  );

  it("validates hidden content before accepting a document", () => {
    const { document, page } = peer();
    block(page, "removed");
    richText(page, "removed", "unsafe", { link: { href: "javascript:alert(1)" } });
    page.removeBlock("removed");
    expect(() => validateContentDocument(document)).toThrow();
  });
});

describe("untrusted canonical content rejection", () => {
  it("rejects hidden fields in a structural placement", () => {
    const { document, page } = peer();
    block(page, "subject");
    document.getMap("placements").set("subject", { parentId: null, position: "m", style: "position:fixed" });
    expect(() => validateContentDocument(document)).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>x</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("rejects unsafe link protocol %s", (href) => {
    const { document, page } = peer();
    block(page, "subject");
    richText(page, "subject", "Open", { link: { href } });
    expect(() => validateContentDocument(document)).toThrow();
  });

  it.each([
    { textStyle: { color: "red; background:url(javascript:alert(1))" } },
    { textStyle: { background: "#ffffff" } },
    { textStyle: { color: "indigo", style: "position:fixed" } },
    { link: { href: "https://example.org", onclick: "alert(1)" } },
    { unknownMark: {} },
  ])("rejects arbitrary inline mark attributes %j", (marks) => {
    const { document, page } = peer();
    block(page, "subject");
    richText(page, "subject", "untrusted", marks);
    expect(() => validateContentDocument(document)).toThrow();
  });

  it.each(["script", "iframe", "rawHTML", "heading"])("rejects noncanonical fragment node %s", (name) => {
    const { document, page } = peer();
    block(page, "subject");
    page.fragment("subject").insert(0, [new Y.XmlElement(name)]);
    expect(() => validateContentDocument(document)).toThrow();
  });

  it("rejects styles and event handlers on a canonical paragraph", () => {
    const { document, page } = peer();
    block(page, "subject");
    const { paragraph } = richText(page, "subject", "Text");
    paragraph.setAttribute("style", "color:red");
    paragraph.setAttribute("onclick", "alert(1)");
    expect(() => validateContentDocument(document)).toThrow();
  });

  it.each([
    { pageId: "not-a-uuid" },
    { pageId, label: "Previously private title" },
    { pageId, href: "https://example.org" },
  ])("rejects malformed or denormalized page mention %j", (attributes) => {
    const { document, page } = peer();
    block(page, "subject");
    const { paragraph } = richText(page, "subject", "Reference");
    const mention = new Y.XmlElement("pageMention");
    for (const [key, value] of Object.entries(attributes)) mention.setAttribute(key, value);
    paragraph.insert(1, [mention]);
    expect(() => validateContentDocument(document)).toThrow();
  });

  it.each([
    ["heading", { level: 4 }],
    ["task", { checked: "yes" }],
    ["code", { language: "<script>" }],
    ["image", { fileId: "not-a-uuid", alt: "Description" }],
    ["image", { fileId, alt: "Description", width: -1 }],
    ["file", { fileId, url: "javascript:alert(1)" }],
    ["callout", { tone: "#fff" }],
    ["table", { header: "true" }],
    ["paragraph", { style: "color:red" }],
    ["databaseRef", { databaseId: "not-a-uuid" }],
  ] satisfies [BlockType, Record<string, unknown>][])(
    "rejects invalid %s block attributes %j",
    (type, attributes) => {
      const { document, page } = peer();
      block(page, "subject", type);
      rawAttributes(document, "subject", attributes);
      expect(() => validateContentDocument(document)).toThrow();
    },
  );

  it("rejects attributes encoded as a plain object instead of a collaborative map", () => {
    const { document, page } = peer();
    block(page, "subject");
    document.getMap("attrs").set("subject", { style: "color:red" });
    expect(() => validateContentDocument(document)).toThrow();
  });

  it("rejects content fragments with no canonical block identity", () => {
    const { document } = peer();
    document.getXmlFragment("block-content:missing").insert(0, [new Y.XmlElement("paragraph")]);
    expect(() => validateContentDocument(document)).toThrow();
  });

  it("rejects attribute maps with no canonical block identity", () => {
    const { document } = peer();
    rawAttributes(document, "missing", {});
    expect(() => validateContentDocument(document)).toThrow();
  });

  it("rejects an unknown block type rather than erasing its content", () => {
    const { document, page } = peer();
    block(page, "subject");
    richText(page, "subject", "Retain for compatible client");
    document.getMap("blocks").set("subject", "futureBlock");
    const before = Y.encodeStateAsUpdate(document);
    expect(() => validateContentDocument(document)).toThrow();
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
  });

  it("rejects cycles received through a canonical update", () => {
    const { document, page } = peer();
    block(page, "first", "toggle");
    block(page, "second", "toggle");
    document.getMap("placements").set("first", { parentId: "second", position: "a" });
    document.getMap("placements").set("second", { parentId: "first", position: "a" });
    expect(() => validateContentDocument(document)).toThrow();
  });
});

describe("stable content operations", () => {
  it("retains an immutable block identity through creation undo and redo", () => {
    const { document, page } = peer();
    page.runAction(() => {
      block(page, "new-block");
      richText(page, "new-block", "Retained for redo");
    });
    expect(document.getMap("identities").get("new-block")).toBe(true);
    expect(page.undo()).toBe(true);
    expect(validateContentDocument(document).blocks).toEqual([]);
    expect(validateContentDocument(peer(Y.encodeStateAsUpdate(document)).document).blocks).toEqual([]);
    expect(page.redo()).toBe(true);
    expect(validateContentDocument(document).text).toBe("Retained for redo");
    expect(() =>
      page.createBlock({ id: "new-block", type: "paragraph", parentId: null, position: "z" }),
    ).toThrow();
  });
  it("transforms text without replacing the fragment, identity, text or marks", () => {
    const { document, page } = peer();
    block(page, "subject");
    richText(page, "subject", "Keep formatted text", { bold: {} });
    const fragment = page.fragment("subject");
    const before = fragment.toJSON();
    page.transformBlock("subject", "heading");
    page.setBlockAttributes("subject", { level: 3 });
    expect(page.getBlock("subject")).toMatchObject({ id: "subject", type: "heading", parentId: null });
    expect(page.fragment("subject")).toBe(fragment);
    expect(fragment.toJSON()).toEqual(before);
    expect(validateContentDocument(document).text).toContain("Keep formatted text");
  });

  it("rejects an invalid attribute patch atomically", () => {
    const { document, page } = peer();
    block(page, "subject", "heading");
    page.setBlockAttributes("subject", { level: 2 });
    const before = Y.encodeStateAsUpdate(document);
    expect(() => page.setBlockAttributes("subject", { level: 3, style: "color:red" })).toThrow();
    expect(page.getBlockAttributes("subject")).toEqual({ level: 2 });
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
  });

  it("keeps attribute edits in page-owned local undo and redo", () => {
    const { page } = peer();
    block(page, "subject", "task");
    page.setBlockAttributes("subject", { checked: false });
    page.stopCapturing();
    page.setBlockAttributes("subject", { checked: true });
    page.stopCapturing();
    expect(page.undo()).toBe(true);
    expect(page.getBlockAttributes("subject")).toEqual({ checked: false });
    expect(page.redo()).toBe(true);
    expect(page.getBlockAttributes("subject")).toEqual({ checked: true });
  });
});
