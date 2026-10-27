import { Editor } from "@tiptap/core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { getEditorSession } from "../../src/features/editor/client/editor-session";
import { orderedBlocks } from "../../src/features/editor/model/block-commands";
import { validateContentDocument } from "../../src/features/editor/model/content-schema";
import type {
  DocumentOperation,
  DocumentTransport,
} from "../../src/features/editor/model/durable-document-provider";
import { initialContentUpdate } from "../../src/features/editor/model/initial-content";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { tableGrid } from "../../src/features/editor/model/table-grid";
import { BLOCK_COMMANDS } from "../../src/features/editor/ui/command-catalog";
import { PageEditor } from "../../src/features/editor/ui/page-editor";
import { chooseBlockCommand } from "../../src/features/editor/ui/page-editor-actions";
import {
  CrossPageFilePasteError,
  clipboardPlainText,
  htmlClipboard,
  pasteBlocks,
  pastePlainLines,
  readBlockClipboard,
  selectedClipboard,
} from "../../src/features/editor/ui/page-editor-clipboard";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const transports = vi.hoisted(() => ({ create: vi.fn<(pageId: string) => DocumentTransport>() }));
vi.mock("../../src/features/editor/client/http-transport", () => ({
  HttpDocumentTransport: class {
    private readonly value: DocumentTransport;
    constructor(pageId: string) {
      this.value = transports.create(pageId);
    }
    read() {
      return this.value.read();
    }
    write(operation: DocumentOperation) {
      return this.value.write(operation);
    }
  },
}));
vi.mock("../../src/features/files/block-actions", () => ({
  prepareBlockUpload: vi.fn(),
  finishBlockUpload: vi.fn(),
}));
const cleanups: (() => void)[] = [];
const userId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const pageId = "30000000-0000-4000-8000-000000000001";

function renderEditor(options: { editable?: boolean; schemaVersion?: number; emptyRemote?: boolean } = {}) {
  const remote = new Y.Doc();
  if (!options.emptyRemote) Y.applyUpdate(remote, initialContentUpdate());
  let revision = options.emptyRemote ? 0 : 1;
  const transport: DocumentTransport = {
    read: async () => ({
      revision,
      schemaVersion: options.schemaVersion ?? 1,
      snapshot: Y.encodeStateAsUpdate(remote),
    }),
    write: async (operation) => {
      Y.applyUpdate(remote, operation.payload);
      return { revision: ++revision };
    },
  };
  transports.create.mockReturnValue(transport);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ mentions: [], files: [] }))),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props = { userId, workspaceId, pageId, editable: options.editable ?? true };
  flushSync(() => root.render(createElement(PageEditor, props)));
  const session = getEditorSession(props);
  cleanups.push(() => {
    flushSync(() => root.unmount());
    session.dispose();
    remote.destroy();
    host.remove();
  });
  return { host, session, remote };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function textHarness() {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, initialContentUpdate());
  const page = new StablePage(doc, "clipboard-test");
  const editor = new Editor({
    element: document.createElement("div"),
    injectCSS: false,
    extensions: [...createTextExtensions(), pageCollaboration(page, "initial")],
  });
  cleanups.push(() => {
    editor.destroy();
    page.destroy();
    doc.destroy();
  });
  return { doc, page, editor, registry: new Map([["initial", editor]]) };
}

describe("composed stable page editor", () => {
  it("consumes a structural slash query before transforming the original fragment", () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, initialContentUpdate());
    const page = new StablePage(doc, "slash-test");
    const editor = new Editor({
      element: document.createElement("div"),
      injectCSS: false,
      extensions: [...createTextExtensions(), pageCollaboration(page, "initial")],
    });
    cleanups.push(() => {
      editor.destroy();
      page.destroy();
      doc.destroy();
    });
    editor.commands.insertContent("/tabela");
    const command = BLOCK_COMMANDS.find((entry) => entry.type === "table");
    if (!command) throw new Error("Missing table command");
    chooseBlockCommand(page, new Map([["initial", editor]]), "initial", command, {
      id: "initial",
      from: 1,
      to: 8,
      literal: "/tabela",
    });
    expect(page.getBlock("initial")?.type).toBe("table");
    expect(tableGrid(page, "initial").rows).toHaveLength(2);
    expect(tableGrid(page, "initial").columns).toHaveLength(2);
    expect(page.undo()).toBe(true);
    expect(page.getBlock("initial")?.type).toBe("paragraph");
    expect(page.fragment("initial").toString()).toContain("/tabela");
  });
  it("mounts real fragment editors, splits on Enter and undoes the structural action", async () => {
    const { host, session } = renderEditor();
    await vi.waitFor(() => expect(host.querySelectorAll('[role="textbox"]')).toHaveLength(1));
    const text = host.querySelector('[role="textbox"]');
    if (!(text instanceof HTMLElement)) throw new Error("Missing editor textbox");
    text.focus();
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(host.querySelectorAll('[role="textbox"]')).toHaveLength(2);
    expect(document.activeElement?.closest("[data-block-text]")?.getAttribute("data-block-text")).not.toBe(
      "initial",
    );
    await vi.waitFor(() => expect(host.querySelectorAll('[role="textbox"]')).toHaveLength(2));
    const undo = [...host.querySelectorAll("button")].find((button) => button.textContent === "Desfazer");
    if (!undo) throw new Error("Missing page-owned undo action");
    flushSync(() => undo.click());
    await vi.waitFor(() => expect(host.querySelectorAll('[role="textbox"]')).toHaveLength(1));
    expect(session.page.getBlock("initial")).toBeDefined();
  });

  it("hides incompatible content and offers an explicit update message", async () => {
    const { host } = renderEditor({ schemaVersion: 2 });
    await vi.waitFor(() => expect(host.textContent).toContain("Atualize"));
    expect(host.querySelector('[role="textbox"]')).toBeNull();
  });

  it("uses read-only views when editing is not authorized", async () => {
    const { host } = renderEditor({ editable: false });
    await vi.waitFor(() => expect(host.querySelector('[role="textbox"]')).not.toBeNull());
    expect(host.querySelector('[contenteditable="true"]')).toBeNull();
    expect(host.textContent).toContain("Somente leitura");
  });
  it("renders an empty read-only page without seeding or treating it as a load error", async () => {
    const { host, session, remote } = renderEditor({ editable: false, emptyRemote: true });
    await vi.waitFor(() => expect(host.textContent).toContain("Esta página ainda não tem conteúdo."));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(session.document.getMap("blocks").size).toBe(0);
    expect(remote.getMap("blocks").size).toBe(0);
    expect(session.provider.hasPendingChanges()).toBe(false);
  });

  it("expands structural selection with Shift+arrows and removes it in one undo action", async () => {
    const { host, session } = renderEditor();
    await vi.waitFor(() => expect(host.querySelector('[role="textbox"]')).not.toBeNull());
    flushSync(() =>
      session.page.createBlock({ id: "second", type: "paragraph", parentId: null, position: "z" }),
    );
    const frame = host.querySelector('[data-editor-block="initial"]');
    if (!(frame instanceof HTMLElement)) throw new Error("Missing block frame");
    flushSync(() => frame.focus());
    flushSync(() =>
      frame.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }),
      ),
    );
    await vi.waitFor(() => expect(host.querySelectorAll('[data-selected="true"]')).toHaveLength(2));
    flushSync(() =>
      frame.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })),
    );
    await vi.waitFor(() => expect(host.querySelectorAll('[role="textbox"]')).toHaveLength(0));
    flushSync(() => session.page.undo());
    await vi.waitFor(() => expect(host.querySelectorAll('[role="textbox"]')).toHaveLength(2));
  });
});

describe("composed editor clipboard", () => {
  it("pastes multiple plain lines without losing an empty line, tail marks or original fragment identity", () => {
    const { doc, page, editor, registry } = textHarness();
    editor.commands.insertContent({ type: "text", text: "leftRight", marks: [{ type: "bold" }] });
    editor.commands.setTextSelection(5);
    const fragment = page.fragment("initial");
    const next = pastePlainLines(page, registry, "initial", "A\n\nB");
    const projection = validateContentDocument(doc);
    expect(projection.blocks).toHaveLength(3);
    expect(projection.blocks[0]?.content.content[0]?.content[0]).toMatchObject({
      type: "text",
      text: "leftA",
    });
    expect(projection.blocks[1]?.content.content[0]?.content).toEqual([]);
    expect(projection.blocks[2]?.content.content[0]?.content[0]).toMatchObject({
      type: "text",
      text: "BRight",
      marks: [{ type: "bold" }],
    });
    expect(next.position).toBe(2);
    expect(page.fragment("initial")).toBe(fragment);
    expect(page.undo()).toBe(true);
    expect(orderedBlocks(page)).toHaveLength(1);
    expect(editor.state.doc.textContent).toBe("leftRight");
  });

  it("converts safe HTML through the inline schema and keeps every paragraph", () => {
    const { doc, page, editor, registry } = textHarness();
    const value = htmlClipboard(
      '<p><strong>Bold</strong><script>evil()</script><a href="javascript:alert(1)">Link</a><span style="color:red" onclick="bad()">Text</span></p><p>Second</p>',
      editor,
      pageId,
    );
    expect(value.blocks).toHaveLength(2);
    expect(JSON.stringify(value)).not.toMatch(/evil|javascript|onclick|style/);
    expect(value.blocks[0]?.content.content[0]?.content[0]).toMatchObject({
      text: "Bold",
      marks: [{ type: "bold" }],
    });
    pasteBlocks(page, registry, value, pageId, "initial", []);
    expect(validateContentDocument(doc).text).toBe("BoldLinkText\nSecond");
    expect(orderedBlocks(page).every((block) => block.id !== "initial")).toBe(true);
  });

  it("retains strict rich text and fresh identities in the versioned custom block format", () => {
    const { doc, page, editor, registry } = textHarness();
    editor.commands.insertContent({ type: "text", text: "Marked", marks: [{ type: "italic" }] });
    const value = readBlockClipboard(JSON.stringify(selectedClipboard(page, ["initial"], pageId)));
    pasteBlocks(page, registry, value, pageId, "initial", []);
    const blocks = validateContentDocument(doc).blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.id).not.toBe("initial");
    expect(blocks[1]?.content).toEqual(blocks[0]?.content);
    expect(clipboardPlainText(value)).toBe("Marked");
    expect(() => readBlockClipboard(JSON.stringify({ ...value, html: "<script>bad</script>" }))).toThrow();
  });

  it("refuses cross-page file references without changing the target document", () => {
    const { doc, page, registry } = textHarness();
    const value = readBlockClipboard(
      JSON.stringify({
        version: 1,
        sourcePageId: workspaceId,
        blocks: [
          {
            id: "file",
            type: "file",
            parentId: null,
            position: "U",
            attributes: { fileId: "40000000-0000-4000-8000-000000000001" },
            content: { type: "doc", content: [] },
          },
        ],
      }),
    );
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => pasteBlocks(page, registry, value, pageId, "initial", [])).toThrow(CrossPageFilePasteError);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
