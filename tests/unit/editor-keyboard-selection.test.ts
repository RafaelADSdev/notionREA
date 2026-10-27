import type { Editor } from "@tiptap/core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { BlockText, type BlockTextProps } from "../../src/features/editor/ui/block-text";

const cleanups: (() => void)[] = [];
afterEach(() => {
  globalThis.document.getSelection()?.removeAllRanges();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function loadedText(callbacks: Pick<BlockTextProps, "onLink"> = {}) {
  const document = new Y.Doc();
  initializeContentDocument(document);
  const page = new StablePage(document, "keyboard-selection-author");
  page.createBlock({ id: "subject", type: "paragraph", parentId: null, position: "m" });
  const paragraph = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  paragraph.insert(0, [text]);
  page.fragment("subject").insert(0, [paragraph]);
  text.insert(0, "Texto editado");
  const host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  const root = createRoot(host);
  let editor: Editor | undefined;
  flushSync(() =>
    root.render(
      createElement(BlockText, {
        page,
        blockId: "subject",
        editable: true,
        ...callbacks,
        onReady: (_id, ready) => {
          if (ready) editor = ready;
        },
      }),
    ),
  );
  cleanups.push(() => {
    flushSync(() => root.unmount());
    host.remove();
    page.destroy();
    document.destroy();
  });
  if (!editor) throw new Error("Expected the mounted BlockText editor");
  const ready = editor;
  ready.view.setProps({ handleScrollToSelection: () => true });
  ready.commands.setTextSelection(ready.state.doc.content.size - 1);
  ready.view.focus();
  const domText = ready.view.dom.querySelector("p")?.firstChild;
  if (!(domText instanceof Text)) throw new Error("Expected loaded DOM text");
  const range = globalThis.document.createRange();
  range.setStart(domText, 0);
  range.setEnd(domText, domText.textContent?.length ?? 0);
  const selection = globalThis.document.getSelection();
  if (!selection) throw new Error("Expected native browser selection");
  selection.removeAllRanges();
  selection.addRange(range);
  // Deliberately do not dispatch selectionchange or let its queued task run:
  // native Home/Shift+End can reach the shortcut before ProseMirror catches up.
  expect(selection.toString()).toBe("Texto editado");
  expect(ready.state.selection.empty).toBe(true);
  const key = (value: string) =>
    ready.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        code: `Key${value.toUpperCase()}`,
        keyCode: value.toUpperCase().charCodeAt(0),
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  return { document, page, editor: ready, key };
}
describe("native selection followed immediately by a formatting shortcut", () => {
  it("bolds canonical selected text even when the ProseMirror state still holds the previous caret", () => {
    const { document, key } = loadedText();
    key("b");
    expect(validateContentDocument(document).blocks[0]?.content.content[0]?.content).toEqual([
      { type: "text", text: "Texto editado", marks: [{ type: "bold" }] },
    ]);
  });
  it("opens the selected link range instead of falling through as a collapsed shortcut", () => {
    const selected: { from: number; to: number }[] = [];
    const { key } = loadedText({
      onLink: (_id, editor) =>
        selected.push({ from: editor.state.selection.from, to: editor.state.selection.to }),
    });
    key("k");
    expect(selected).toEqual([{ from: 1, to: 14 }]);
  });
});

describe("native text deletion", () => {
  it("commits the browser deletion range before DOM reconciliation can restore it", () => {
    const { document, page, editor } = loadedText();
    page.undoManager.stopCapturing();
    const node = editor.view.dom.querySelector("p")?.firstChild;
    if (!(node instanceof Text)) throw new Error("Expected text");
    const event = new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "getTargetRanges", {
      value: () => [
        {
          startContainer: node,
          startOffset: 12,
          endContainer: node,
          endOffset: 13,
        },
      ],
    });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(validateContentDocument(document).text).toBe("Texto editad");
    expect(page.undo()).toBe(true);
    expect(validateContentDocument(document).text).toBe("Texto editado");
    expect(page.redo()).toBe(true);
    expect(validateContentDocument(document).text).toBe("Texto editad");
  });
});
