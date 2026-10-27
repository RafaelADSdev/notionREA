import { Editor } from "@tiptap/core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { BlockText, type BlockTextProps } from "../../src/features/editor/ui/block-text";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const dispose: (() => void)[] = [];
class PasteEvent extends Event {
  readonly clipboardData = null;
}
function pasteHTML(editor: Editor, html: string) {
  editor.view.pasteHTML(html, new PasteEvent("paste"));
}
afterEach(() => {
  for (const cleanup of dispose.splice(0).reverse()) cleanup();
});
function setup() {
  const document = new Y.Doc();
  initializeContentDocument(document);
  const page = new StablePage(document, "text-author");
  page.createBlock({ id: "text", type: "paragraph", parentId: null, position: "a" });
  const editor = new Editor({
    element: globalThis.document.createElement("div"),
    injectCSS: false,
    extensions: [...createTextExtensions(), pageCollaboration(page, "text")],
  });
  dispose.push(() => {
    editor.destroy();
    page.destroy();
    document.destroy();
  });
  return { document, page, editor };
}

describe("canonical block text adapter", () => {
  it.each(["", "Replacement <literal> text"])(
    "persists the first select-all replacement after loading shared text: %j",
    (replacement) => {
      const seed = setup();
      seed.editor.commands.insertContent("Loaded shared content");
      const document = new Y.Doc();
      Y.applyUpdate(document, Y.encodeStateAsUpdate(seed.document));
      const page = new StablePage(document, "loaded-author");
      const host = globalThis.document.createElement("div");
      globalThis.document.body.append(host);
      const root = createRoot(host);
      const ready: Editor[] = [];
      let updates = 0;
      document.on("update", () => {
        updates += 1;
      });
      dispose.push(() => {
        flushSync(() => root.unmount());
        host.remove();
        page.destroy();
        document.destroy();
      });
      flushSync(() =>
        root.render(
          createElement(BlockText, {
            page,
            blockId: "text",
            editable: true,
            onReady: (_id, editor) => {
              if (!editor) return;
              ready.push(editor);
              expect(updates).toBe(0);
              // One transaction models select-all followed immediately by its replacement.
              const chain = editor.chain().selectAll();
              if (replacement) chain.insertContent({ type: "text", text: replacement }).run();
              else chain.deleteSelection().run();
            },
          }),
        ),
      );
      expect(ready[0]?.getText()).toBe(replacement);
      expect(validateContentDocument(document).text).toBe(replacement);
      expect(page.undoManager.undoStack).toHaveLength(1);
      const reload = new Y.Doc();
      try {
        Y.applyUpdate(reload, Y.encodeStateAsUpdate(document));
        expect(validateContentDocument(reload).text).toBe(replacement);
      } finally {
        reload.destroy();
      }
      expect(page.undo()).toBe(true);
      expect(validateContentDocument(document).text).toBe("Loaded shared content");
    },
  );

  it("mounts loaded and blank fragments without canonical writes or extra undo entries", () => {
    const seed = setup();
    seed.editor.commands.insertContent("Loaded content");
    seed.page.createBlock({ id: "blank", type: "paragraph", parentId: null, position: "z" });
    seed.page.undoManager.clear();
    const before = Y.encodeStateAsUpdate(seed.document);
    let updates = 0;
    seed.document.on("update", () => {
      updates += 1;
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    dispose.push(() => {
      flushSync(() => root.unmount());
      host.remove();
    });
    flushSync(() =>
      root.render(
        createElement(
          "div",
          {},
          createElement(BlockText, { page: seed.page, blockId: "text", editable: true }),
          createElement(BlockText, { page: seed.page, blockId: "blank", editable: true }),
        ),
      ),
    );
    expect(Y.encodeStateAsUpdate(seed.document)).toEqual(before);
    expect(seed.page.fragment("blank").length).toBe(0);
    expect(seed.page.undoManager.undoStack).toHaveLength(0);
    expect(updates).toBe(0);
  });
  it("persists only one paragraph with all permitted inline marks", () => {
    const { document, editor } = setup();
    pasteHTML(
      editor,
      '<p><strong>A</strong><em>B</em><u>C</u><s>D</s><code>E</code><a href="https://example.com" target="secret">F</a><span data-content-color="copper" data-content-background="yellow">G</span><br>H</p>',
    );
    const projection = validateContentDocument(document);
    expect(projection.text).toBe("ABCDEFG\nH");
    expect(projection.blocks[0]?.content.content).toHaveLength(1);
    expect(projection.blocks[0]?.content.content[0]?.content).toContainEqual({
      type: "text",
      text: "F",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });
  it("discards unsafe links, arbitrary styling and extra pasted attributes", () => {
    const { document, editor } = setup();
    pasteHTML(
      editor,
      '<p><a href="javascript:alert(1)">unsafe</a><span style="color:red;background:url(javascript:alert(1))" data-content-color="invalid">plain</span></p>',
    );
    expect(validateContentDocument(document).text).toBe("unsafeplain");
    expect(editor.getHTML()).not.toMatch(/javascript|style=/);
  });
  it("keeps fragment and text across transforms and view teardown keeps page history", () => {
    const { document, page, editor } = setup();
    editor.commands.insertContent("preserved");
    const fragment = page.fragment("text");
    page.transformBlock("text", "heading");
    expect(page.fragment("text")).toBe(fragment);
    expect(validateContentDocument(document).text).toBe("preserved");
    const other = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: [...createTextExtensions(), pageCollaboration(page, "text")],
    });
    other.destroy();
    page.stopCapturing();
    editor.commands.insertContent("more");
    expect(page.undo()).toBe(true);
    expect(editor.getText()).toBe("preserved");
  });
  it("renders current authorized mention labels without storing their title", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    let label: { title: string; href: string } | null = { title: "Authorized", href: "/w/page" };
    let listener = () => {};
    const editor = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: createTextExtensions({
        mentionResolver: {
          resolve: () => label,
          subscribe: (next) => {
            listener = next;
            return () => {};
          },
        },
      }),
    });
    dispose.push(() => editor.destroy());
    editor.commands.insertContent({
      type: "pageMention",
      attrs: { pageId: id, title: "Private stale title" },
    });
    expect(editor.view.dom.textContent).toBe("Authorized");
    expect(JSON.stringify(editor.getJSON())).not.toContain("title");
    label = null;
    listener();
    expect(editor.view.dom.textContent).toBe("Referência indisponível");
    expect(editor.view.dom.innerHTML).not.toContain("Authorized");
  });

  it("supports text color without persisting an undefined background", () => {
    const { document, editor } = setup();
    pasteHTML(editor, '<span data-content-color="green">green</span>');
    expect(validateContentDocument(document).blocks[0]?.content.content[0]?.content).toEqual([
      { type: "text", text: "green", marks: [{ type: "textStyle", attrs: { color: "green" } }] },
    ]);
  });

  it("persists a mention only by identity through a collaborative fragment", () => {
    const { document, editor } = setup();
    const pageId = "00000000-0000-4000-8000-000000000002";
    editor.commands.insertContent({ type: "pageMention", attrs: { pageId, title: "Never persist this" } });
    const projection = validateContentDocument(document);
    expect(projection.references).toEqual([pageId]);
    expect(projection.blocks[0]?.content.content[0]?.content).toEqual([
      { type: "pageMention", attrs: { pageId } },
    ]);
    expect(JSON.stringify(projection)).not.toContain("Never persist this");
  });

  it("keeps one mounted editor while callbacks and edit permission change", () => {
    const { page } = setup();
    const editors: Editor[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onReady: BlockTextProps["onReady"] = (_id, editor) => {
      if (editor) editors.push(editor);
    };
    flushSync(() =>
      root.render(createElement(BlockText, { page, blockId: "text", editable: true, onReady })),
    );
    dispose.push(() => {
      flushSync(() => root.unmount());
      host.remove();
    });
    const editor = editors[0];
    if (!editor) throw new Error("Text editor did not mount");
    const fragment = page.fragment("text");
    editor.commands.insertContent("stable");
    flushSync(() =>
      root.render(createElement(BlockText, { page, blockId: "text", editable: false, onReady })),
    );
    expect(editors).toHaveLength(1);
    expect(editor.isEditable).toBe(false);
    expect(editor.view.dom.getAttribute("aria-label")).toBe("Texto do bloco");
    expect(page.fragment("text")).toBe(fragment);
    expect(editor.getText()).toBe("stable");
  });

  it("routes structural keys to the composition and leaves native Tab and AltGr free", () => {
    const { page } = setup();
    const editors: Editor[] = [];
    const calls: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        createElement(BlockText, {
          page,
          blockId: "text",
          editable: true,
          onReady: (_id, editor) => {
            if (editor) editors.push(editor);
          },
          onSplit: () => calls.push("split"),
          onEscape: () => calls.push("escape"),
        }),
      ),
    );
    dispose.push(() => {
      flushSync(() => root.unmount());
      host.remove();
    });
    const editor = editors[0];
    if (!editor) throw new Error("Text editor did not mount");
    const key = (value: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init });
      editor.view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(key("Tab")).toBe(false);
    expect(key("Enter", { isComposing: true })).toBe(false);
    expect(key("b", { ctrlKey: true, altKey: true })).toBe(false);
    expect(key("Enter")).toBe(true);
    expect(key("Escape")).toBe(true);
    expect(calls).toEqual(["split", "escape"]);
    page.transformBlock("text", "code");
    expect(key("Enter")).toBe(true);
    expect(key("Tab")).toBe(true);
    expect(editor.getText()).toBe("\n  ");
    expect(calls).toEqual(["split", "escape"]);
  });
});
