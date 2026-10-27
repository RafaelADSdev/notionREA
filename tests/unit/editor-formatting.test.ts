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
import { FormattingToolbar } from "../../src/features/editor/ui/formatting-toolbar";
import { LinkDialog } from "../../src/features/editor/ui/link-dialog";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup() {
  const document = new Y.Doc();
  initializeContentDocument(document);
  const page = new StablePage(document, "format-author");
  page.createBlock({ id: "text", type: "paragraph", parentId: null, position: "m" });
  const surface = globalThis.document.createElement("div");
  globalThis.document.body.append(surface);
  const editor = new Editor({
    element: surface,
    injectCSS: false,
    extensions: [...createTextExtensions(), pageCollaboration(page, "text")],
  });
  editor.commands.insertContent("Selected text");
  editor.commands.setTextSelection({ from: 1, to: 9 });
  const host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    flushSync(() => root.unmount());
    editor.destroy();
    page.destroy();
    document.destroy();
    host.remove();
    surface.remove();
  });
  const renderToolbar = () =>
    flushSync(() => root.render(createElement(FormattingToolbar, { editor, onLink: () => {} })));
  const renderDialog = () =>
    flushSync(() =>
      root.render(
        createElement(LinkDialog, {
          editor,
          open: true,
          onClose: () => {
            flushSync(() => root.render(null));
          },
        }),
      ),
    );
  return { document, page, editor, host, renderToolbar, renderDialog };
}
function button(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll("button")].find(
    (entry) => entry.getAttribute("aria-label") === label || entry.textContent === label,
  );
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}
function input(host: HTMLElement, label: string): HTMLInputElement {
  const field = [...host.querySelectorAll("input")].find(
    (entry) =>
      entry.getAttribute("aria-label") === label ||
      host.querySelector(`label[for="${entry.id}"]`)?.textContent === label,
  );
  if (!field) throw new Error(`Missing input ${label}`);
  return field;
}
function submit(host: HTMLElement) {
  const form = host.querySelector("form");
  if (!form) throw new Error("Missing form");
  flushSync(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("editor formatting toolbar", () => {
  it("toggles canonical marks and reflects selection and transaction state", () => {
    const view = setup();
    view.renderToolbar();
    const bold = button(view.host, "Negrito");
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    flushSync(() => bold.click());
    expect(view.editor.isActive("bold")).toBe(true);
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    flushSync(() => view.editor.commands.setTextSelection({ from: 10, to: 14 }));
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    expect(validateContentDocument(view.document).blocks[0]?.content.content[0]?.content[0]).toEqual({
      type: "text",
      text: "Selected",
      marks: [{ type: "bold" }],
    });
  });
  it("uses roving toolbar arrows and keeps editor selection on pointer actions", () => {
    const view = setup();
    view.renderToolbar();
    const bold = button(view.host, "Negrito");
    bold.focus();
    flushSync(() =>
      bold.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      ),
    );
    expect(globalThis.document.activeElement).toBe(button(view.host, "Itálico"));
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bold.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(view.editor.state.selection.from).toBe(1);
    expect(view.editor.state.selection.to).toBe(9);
  });
  it("preserves the other color attribute and unsets only the chosen default", () => {
    const view = setup();
    view.editor.commands.setMark("textStyle", { background: "yellow" });
    view.renderToolbar();
    const color = view.host.querySelector('select[aria-label="Cor do texto"]');
    if (!(color instanceof HTMLSelectElement)) throw new Error("Missing color select");
    color.value = "green";
    flushSync(() => color.dispatchEvent(new Event("change", { bubbles: true })));
    expect(view.editor.getAttributes("textStyle")).toMatchObject({ color: "green", background: "yellow" });
    color.value = "default";
    flushSync(() => color.dispatchEvent(new Event("change", { bubbles: true })));
    expect(view.editor.getAttributes("textStyle").color).toBeUndefined();
    expect(view.editor.getAttributes("textStyle").background).toBe("yellow");
    expect(validateContentDocument(view.document).blocks[0]?.content.content[0]?.content[0]).toEqual({
      type: "text",
      text: "Selected",
      marks: [{ type: "textStyle", attrs: { background: "yellow" } }],
    });
  });
});

describe("safe editor link dialog", () => {
  it("rejects unsafe URLs without changing the document and applies only the href attribute", () => {
    const view = setup();
    view.renderDialog();
    const href = input(view.host, "Endereço do link");
    expect(globalThis.document.activeElement).toBe(href);
    const before = Y.encodeStateAsUpdate(view.document);
    href.value = "javascript:alert(1)";
    submit(view.host);
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("endereço");
    expect(Y.encodeStateAsUpdate(view.document)).toEqual(before);
    href.value = "https://example.com";
    submit(view.host);
    expect(validateContentDocument(view.document).blocks[0]?.content.content[0]?.content[0]).toEqual({
      type: "text",
      text: "Selected",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });
  it("extends a cursor inside an existing link and removes its mark without removing its label", () => {
    const view = setup();
    view.editor.commands.setMark("link", { href: "https://example.com" });
    view.editor.commands.setTextSelection(4);
    view.renderDialog();
    flushSync(() => button(view.host, "Remover link").click());
    expect(view.editor.getText()).toBe("Selected text");
    expect(validateContentDocument(view.document).blocks[0]?.content.content[0]?.content[0]).toEqual({
      type: "text",
      text: "Selected text",
    });
  });
  it("inserts an escaped literal label at a cursor without interpreting HTML", () => {
    const view = setup();
    view.editor.commands.setTextSelection(14);
    view.renderDialog();
    input(view.host, "Endereço do link").value = "https://example.com";
    input(view.host, "Texto do link").value = "<img src=x onerror=alert(1)>";
    submit(view.host);
    expect(view.editor.getText()).toBe("Selected text<img src=x onerror=alert(1)>");
    expect(view.editor.view.dom.querySelector("img")).toBeNull();
    expect(validateContentDocument(view.document).blocks[0]?.content.content[0]?.content.at(-1)).toEqual({
      type: "text",
      text: "<img src=x onerror=alert(1)>",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });
  it("cancels with Escape without changing content or the original cursor and returns focus", () => {
    const view = setup();
    view.editor.commands.setMark("link", { href: "https://example.com" });
    view.editor.commands.setTextSelection(4);
    const before = Y.encodeStateAsUpdate(view.document);
    view.renderDialog();
    const dialog = view.host.querySelector("dialog");
    if (!dialog) throw new Error("Missing dialog");
    flushSync(() =>
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    );
    expect(Y.encodeStateAsUpdate(view.document)).toEqual(before);
    expect(view.editor.state.selection.from).toBe(4);
    expect(view.editor.state.selection.to).toBe(4);
    expect(globalThis.document.activeElement).toBe(view.editor.view.dom);
  });
});
