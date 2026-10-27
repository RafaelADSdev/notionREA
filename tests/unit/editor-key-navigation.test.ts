import type { Editor } from "@tiptap/core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { BlockText } from "../../src/features/editor/ui/block-text";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

function mountedText() {
  vi.useFakeTimers();
  const doc = new Y.Doc();
  initializeContentDocument(doc);
  const page = new StablePage(doc, "navigation-author");
  page.createBlock({ id: "subject", type: "paragraph", parentId: null, position: "m" });
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "Segunda ideia");
  paragraph.insert(0, [text]);
  page.fragment("subject").insert(0, [paragraph]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let ready: Editor | undefined;
  const links: { from: number; to: number }[] = [];
  flushSync(() =>
    root.render(
      createElement(BlockText, {
        page,
        blockId: "subject",
        editable: true,
        onReady: (_id, editor) => {
          if (editor) ready = editor;
        },
        onLink: (_id, editor) =>
          links.push({ from: editor.state.selection.from, to: editor.state.selection.to }),
      }),
    ),
  );
  cleanups.push(() => {
    flushSync(() => root.unmount());
    host.remove();
    page.destroy();
    doc.destroy();
  });
  if (!ready) throw new Error("Expected a mounted text view");
  const editor = ready;
  // jsdom has no layout; scrolling is unrelated to selection acceptance.
  editor.setOptions({ editorProps: { ...editor.options.editorProps, handleScrollToSelection: () => true } });
  editor.commands.setTextSelection(14);
  editor.view.focus();
  const domText = editor.view.dom.querySelector("p")?.firstChild;
  const selection = document.getSelection();
  if (!(domText instanceof Text) || !selection) throw new Error("Expected native text selection");
  function key(value: string, options: KeyboardEventInit = {}) {
    const codes: Record<string, number> = { Home: 36, End: 35, Shift: 16, b: 66, k: 75 };
    const event = new KeyboardEvent("keydown", {
      key: value,
      keyCode: codes[value] ?? 0,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    editor.view.dom.dispatchEvent(event);
    return event;
  }
  return { doc, editor, domText, selection, key, links };
}

describe("explicit native navigation immediately after focusing a block", () => {
  it("accepts Home at the start instead of restoring the old end caret", () => {
    const { editor, domText, selection, key } = mountedText();
    expect(key("Home").defaultPrevented).toBe(false);
    // jsdom has no default keyboard movement. Model only that browser action,
    // then deliver its native event to the real ProseMirror observer.
    selection.collapse(domText, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(editor.state.selection.head).toBe(1);
    expect(selection.focusOffset).toBe(0);
  });

  it.each(["b", "k"])(
    "preserves immediate Home → Shift+End → Ctrl+%s before queued selection events",
    (shortcut) => {
      const { doc, editor, domText, selection, key, links } = mountedText();
      key("Home");
      selection.collapse(domText, 0);
      document.dispatchEvent(new Event("selectionchange"));
      // Shift can arrive before selectionchange; PM flushes on every keydown.
      key("Shift", { shiftKey: true });
      key("End", { shiftKey: true });
      selection.extend(domText, domText.length);
      expect(selection.toString()).toBe("Segunda ideia");
      key(shortcut, { ctrlKey: true });
      if (shortcut === "k") expect(links).toEqual([{ from: 1, to: 14 }]);
      else
        expect(validateContentDocument(doc).blocks[0]?.content.content[0]?.content).toEqual([
          { type: "text", text: "Segunda ideia", marks: [{ type: "bold" }] },
        ]);
      expect(editor.state.selection.empty).toBe(false);
    },
  );
});
