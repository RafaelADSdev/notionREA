import { Editor } from "@tiptap/core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { BlockText } from "../../src/features/editor/ui/block-text";
import { codeHighlightExtension } from "../../src/features/editor/ui/code-highlight";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function editorFor(text: string, language = "javascript", isCode = true) {
  const document = new Y.Doc();
  initializeContentDocument(document);
  const page = new StablePage(document, "highlight-author");
  page.createBlock({ id: "text", type: isCode ? "code" : "paragraph", parentId: null, position: "m" });
  if (isCode) page.setBlockAttributes("text", { language });
  const editor = new Editor({
    element: globalThis.document.createElement("div"),
    injectCSS: false,
    extensions: [
      ...createTextExtensions(),
      pageCollaboration(page, "text"),
      codeHighlightExtension({ isCode: () => isCode, language: () => language }),
    ],
  });
  editor.commands.insertContent({ type: "text", text });
  cleanups.push(() => {
    editor.destroy();
    page.destroy();
    document.destroy();
  });
  return { document, page, editor };
}

describe("safe literal code highlighting", () => {
  it("decorates known token types while preserving canonical text and escaping script markup", () => {
    const text = 'const value = "<script>alert(1)</script>"; // safe\nreturn 42;';
    const view = editorFor(text);
    const before = Y.encodeStateAsUpdate(view.document);
    expect(view.editor.view.dom.querySelector(".code-keyword")?.textContent).toBe("const");
    expect(view.editor.view.dom.querySelector(".code-string")?.textContent).toBe(
      '"<script>alert(1)</script>"',
    );
    expect(view.editor.view.dom.querySelector(".code-comment")?.textContent).toBe("// safe");
    expect(view.editor.view.dom.querySelector(".code-number")?.textContent).toBe("42");
    expect(view.editor.view.dom.querySelector("script")).toBeNull();
    expect(view.editor.getText()).toBe(text);
    expect(validateContentDocument(view.document).text).toBe(text);
    expect(Y.encodeStateAsUpdate(view.document)).toEqual(before);
  });
  it.each([
    ["typescript", "interface Person { count: number }", "code-keyword"],
    ["json", '{"name": 42}', "code-property"],
    ["html", '<img src="x" onerror="alert(1)">', "code-tag"],
    ["css", "body { color: red; }", "code-property"],
    ["python", "def name(): # comment\n  return 1", "code-keyword"],
    ["sql", "SELECT name FROM notes -- comment", "code-keyword"],
    ["bash", "if true; then echo 'safe'; fi", "code-keyword"],
    ["markdown", "# Title\n`literal`", "code-keyword"],
  ])("supports %s without HTML execution or text changes", (language, text, token) => {
    const view = editorFor(text, language);
    expect(view.editor.view.dom.querySelector(`.${token}`)).not.toBeNull();
    expect(view.editor.view.dom.querySelector("img")).toBeNull();
    expect(validateContentDocument(view.document).text).toBe(text);
  });
  it("leaves normal text and plaintext code free of decorations", () => {
    expect(
      editorFor("const normal = 1;", "javascript", false).editor.view.dom.querySelector(".code-token"),
    ).toBeNull();
    expect(
      editorFor("const normal = 1;", "plaintext").editor.view.dom.querySelector(".code-token"),
    ).toBeNull();
  });
  it("reuses cached decorations across selection-only transactions and preserves the caret", () => {
    const view = editorFor("const value = 42;");
    const decorations = view.editor.view.someProp("decorations", (get) => get(view.editor.state));
    view.editor.commands.setTextSelection(7);
    const next = view.editor.view.someProp("decorations", (get) => get(view.editor.state));
    expect(next).toBe(decorations);
    expect(view.editor.state.selection.from).toBe(7);
  });
  it("fills empty highlighted code without repeated insertions before a retained placeholder", () => {
    const view = editorFor("const original = 1;");
    const fragment = view.page.fragment("text");
    view.editor.chain().selectAll().deleteSelection().run();
    const insert = vi.spyOn(globalThis.Node.prototype, "insertBefore");
    const text = "const next = 2; // literal\n";
    view.editor.commands.insertContent({ type: "text", text });
    const placeholderInsertions = insert.mock.calls.filter(
      ([, reference]) =>
        reference instanceof HTMLElement && reference.classList.contains("ProseMirror-trailingBreak"),
    );
    expect(placeholderInsertions).toHaveLength(0);
    expect(view.page.fragment("text")).toBe(fragment);
    expect(view.editor.state.selection.from).toBe(text.length + 1);
    expect(validateContentDocument(view.document).text).toBe(text);
    const paragraph = fragment.get(0);
    const filled = view.editor.view.dom.querySelector("p");
    view.editor.commands.insertContent({ type: "text", text: "return 3;" });
    expect(view.editor.view.dom.querySelector("p")).toBe(filled);
    expect(fragment.get(0)).toBe(paragraph);
  });
  it("keeps native composition and normal paragraph DOM under ProseMirror control", () => {
    const view = editorFor("const original = 1;");
    view.editor.chain().selectAll().deleteSelection().run();
    const composingParagraph = view.editor.view.dom.querySelector("p");
    view.editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(view.editor.view.composing).toBe(true);
    view.editor.commands.insertContent({ type: "text", text: "const composing = 2;" });
    expect(view.editor.view.dom.querySelector("p")).toBe(composingParagraph);
    expect(validateContentDocument(view.document).text).toBe("const composing = 2;");
    view.editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    const normal = editorFor("ordinary text", "javascript", false);
    normal.editor.chain().selectAll().deleteSelection().run();
    const normalParagraph = normal.editor.view.dom.querySelector("p");
    normal.editor.commands.insertContent({ type: "text", text: "const ordinary = 1;" });
    expect(normal.editor.view.dom.querySelector("p")).toBe(normalParagraph);
    expect(normal.editor.view.dom.querySelector(".code-token")).toBeNull();
  });
  it("refreshes a mounted leaf for language and type metadata without remounting or writing content", () => {
    const source = editorFor("const value = 42;", "plaintext");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const mounted: Editor[] = [];
    flushSync(() =>
      root.render(
        createElement(BlockText, {
          page: source.page,
          blockId: "text",
          editable: true,
          onReady: (_id, editor) => {
            if (editor) mounted.push(editor);
          },
        }),
      ),
    );
    cleanups.push(() => {
      flushSync(() => root.unmount());
      host.remove();
    });
    const editor = mounted[0];
    if (!editor) throw new Error("Leaf did not mount");
    editor.commands.setTextSelection(7);
    const fragment = source.page.fragment("text");
    const xml = fragment.toString();
    let styleTransactions = 0;
    editor.on("transaction", () => {
      styleTransactions += 1;
    });
    source.page.createBlock({ id: "unrelated", type: "code", parentId: null, position: "z" });
    source.page.setBlockAttributes("unrelated", { language: "python" });
    expect(styleTransactions).toBe(0);
    let updates = 0;
    source.document.on("update", () => {
      updates += 1;
    });
    source.page.setBlockAttributes("text", { language: "javascript" });
    expect(host.querySelector(".code-keyword")?.textContent).toBe("const");
    expect(updates).toBe(1);
    expect(fragment.toString()).toBe(xml);
    expect(editor.state.selection.from).toBe(7);
    source.page.transformBlock("text", "paragraph");
    expect(host.querySelector(".code-token")).toBeNull();
    expect(mounted).toHaveLength(1);
    expect(validateContentDocument(source.document).text).toBe("const value = 42;");
  });
  it("highlights all 5,000 literal lines without truncating the final tokens", () => {
    const text = Array.from({ length: 5000 }, (_, index) => `const value${index} = ${index}; // line\n`).join(
      "",
    );
    const view = editorFor(text);
    expect(view.editor.getText()).toBe(text);
    expect(view.editor.view.dom.querySelectorAll(".code-keyword")).toHaveLength(5000);
    expect(view.editor.view.dom.querySelectorAll(".code-number").item(4999)?.textContent).toBe("4999");
    expect(validateContentDocument(view.document).text).toBe(text);
  }, 30000);
});
