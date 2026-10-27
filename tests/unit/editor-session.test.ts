import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  clearOtherEditorSessions,
  getEditorSession,
  getPendingDraftSession,
  getPendingDrafts,
  subscribePendingDrafts,
} from "../../src/features/editor/client/editor-session";
import {
  type DocumentOperation,
  type DocumentTransport,
  DocumentTransportError,
} from "../../src/features/editor/model/durable-document-provider";
import { initialContentUpdate } from "../../src/features/editor/model/initial-content";
import { PendingDrafts } from "../../src/features/editor/ui/pending-drafts";

const bindings = vi.hoisted(() => ({ create: vi.fn<(pageId: string) => DocumentTransport>() }));
vi.mock("../../src/features/editor/client/http-transport", () => ({
  HttpDocumentTransport: class {
    private readonly transport: DocumentTransport;
    constructor(pageId: string) {
      this.transport = bindings.create(pageId);
    }
    read() {
      return this.transport.read();
    }
    write(operation: DocumentOperation) {
      return this.transport.write(operation);
    }
  },
}));
const pageId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";
const transports: MemoryTransport[] = [];
const views: (() => void)[] = [];

class MemoryTransport implements DocumentTransport {
  readonly document = new Y.Doc();
  revision = 1;
  handler: ((operation: DocumentOperation) => Promise<{ revision: number }>) | undefined;
  read = vi.fn(async () => ({
    revision: this.revision,
    schemaVersion: 1,
    snapshot: Y.encodeStateAsUpdate(this.document),
  }));
  write = vi.fn(async (operation: DocumentOperation) =>
    this.handler ? this.handler(operation) : this.accept(operation),
  );
  constructor() {
    Y.applyUpdate(this.document, initialContentUpdate());
    transports.push(this);
  }
  accept(operation: DocumentOperation) {
    Y.applyUpdate(this.document, operation.payload);
    return { revision: ++this.revision };
  }
}

function session() {
  return getEditorSession({ userId, workspaceId, pageId, editable: true });
}
function text(value: ReturnType<typeof session>) {
  const paragraph = value.page.fragment("initial").get(0);
  if (!(paragraph instanceof Y.XmlElement)) throw new Error("Expected a paragraph");
  let content = paragraph.get(0);
  if (!content) {
    content = new Y.XmlText();
    paragraph.insert(0, [content]);
  }
  if (!(content instanceof Y.XmlText)) throw new Error("Expected inline text");
  return content;
}

beforeEach(() => {
  vi.useFakeTimers();
  bindings.create.mockImplementation(() => new MemoryTransport());
});
afterEach(() => {
  for (const cleanup of views.splice(0)) cleanup();
  clearOtherEditorSessions("cleanup");
  for (const transport of transports.splice(0)) transport.document.destroy();
  bindings.create.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("retained browser editor sessions", () => {
  it("shares two view leases without destroying page history when one closes", async () => {
    const value = session();
    const first = value.mount();
    const second = value.mount();
    await value.connect();
    expect(session()).toBe(value);
    const destroy = vi.spyOn(value.document, "destroy");
    const content = text(value);
    value.document.transact(() => content.insert(0, "history"), value.actor);
    value.page.stopCapturing();
    await value.provider.flush();
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(destroy).not.toHaveBeenCalled();
    expect(value.page.undo()).toBe(true);
    expect(content.toString()).toBe("");
    second();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("flushes the last view in background and disposes only after its durable ACK", async () => {
    const value = session();
    const release = value.mount();
    await value.connect();
    const transport = transports[0];
    if (!transport) throw new Error("Expected transport");
    const ack = Promise.withResolvers<void>();
    transport.handler = async (operation) => {
      const receipt = transport.accept(operation);
      await ack.promise;
      return receipt;
    };
    text(value).insert(0, "unconfirmed");
    const destroy = vi.spyOn(value.document, "destroy");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.write).toHaveBeenCalledOnce();
    expect(getPendingDrafts(userId)).toEqual([{ pageId, workspaceId, state: "saving" }]);
    expect(destroy).not.toHaveBeenCalled();
    ack.resolve();
    await value.provider.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(destroy).toHaveBeenCalledOnce();
    expect(getPendingDrafts(userId)).toEqual([]);
    expect(session()).not.toBe(value);
  });

  it("keeps failed draft text/history cached for copying and reacquiring without storage", async () => {
    const value = session();
    const release = value.mount();
    await value.connect();
    const transport = transports[0];
    if (!transport) throw new Error("Expected transport");
    transport.handler = async () => {
      throw new DocumentTransportError("transient");
    };
    const content = text(value);
    value.document.transact(() => content.insert(0, "Keep this draft"), value.actor);
    await value.provider.flush();
    release();
    await vi.advanceTimersByTimeAsync(0);
    const drafts = getPendingDrafts(userId);
    expect(drafts).toEqual([{ pageId, workspaceId, state: "error" }]);
    expect(getPendingDrafts(userId)).toBe(drafts);
    expect(getPendingDraftSession(userId, pageId)?.draftText()).toBe("Keep this draft");
    expect(getPendingDraftSession("another-user", pageId)).toBeUndefined();
    const reused = session();
    expect(reused).toBe(value);
    const close = reused.mount();
    expect(getPendingDrafts(userId)).toEqual([]);
    expect(reused.document).toBe(value.document);
    transport.handler = undefined;
    await reused.provider.retry();
    close();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keys cache by both user and page and clears old-user retained data", async () => {
    const first = session();
    const second = getEditorSession({ userId: "another-user", workspaceId, pageId, editable: true });
    expect(second).not.toBe(first);
    expect(
      getEditorSession({
        userId,
        workspaceId,
        pageId: "10000000-0000-4000-8000-000000000002",
        editable: true,
      }),
    ).not.toBe(first);
    const destroyed = vi.spyOn(first.document, "destroy");
    clearOtherEditorSessions("another-user");
    expect(destroyed).toHaveBeenCalledOnce();
    expect(getEditorSession({ userId: "another-user", workspaceId, pageId, editable: true })).toBe(second);
  });

  it("notifies status separately from structure and does not render structure per character", async () => {
    const value = session();
    const structure = vi.fn();
    const status = vi.fn();
    const unsubscribeStructure = value.subscribeStructure(structure);
    const unsubscribeStatus = value.subscribeStatus(status);
    const release = value.mount();
    await value.connect();
    const version = value.getStructureVersion();
    structure.mockClear();
    const content = text(value);
    content.insert(0, "a");
    content.insert(1, "b");
    content.insert(2, "c");
    expect(value.getStructureVersion()).toBe(version);
    expect(structure).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalled();
    value.page.createBlock({ id: "second", type: "paragraph", parentId: null, position: "n" });
    expect(value.getStructureVersion()).toBeGreaterThan(version);
    expect(structure).toHaveBeenCalled();
    unsubscribeStructure();
    unsubscribeStatus();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("survives StrictMode release/reacquire before cleanup and leaves no timers after dispose", async () => {
    const value = session();
    const release = value.mount();
    release();
    const remount = value.mount();
    await value.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(session()).toBe(value);
    expect(transports[0]?.read).toHaveBeenCalledOnce();
    text(value).insert(0, "draft");
    const structure = vi.fn();
    const status = vi.fn();
    const pending = vi.fn();
    value.subscribeStructure(structure);
    value.subscribeStatus(status);
    const unsubscribe = subscribePendingDrafts(pending);
    value.dispose();
    structure.mockClear();
    status.mockClear();
    pending.mockClear();
    remount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(structure).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();
  });

  it("does not share browser cache across SSR requests", () => {
    vi.stubGlobal("window", undefined);
    const first = session();
    const second = session();
    expect(first).not.toBe(second);
    first.dispose();
    second.dispose();
  });

  it("honors cached role changes without replacing the document or dropping its pending edits", async () => {
    const value = session();
    const release = value.mount();
    await value.connect();
    text(value).insert(0, "pending before downgrade");
    expect(getEditorSession({ userId, workspaceId, pageId, editable: false })).toBe(value);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transports[0]?.write).not.toHaveBeenCalled();
    expect(value.provider.hasPendingChanges()).toBe(true);
    expect(getEditorSession({ userId, workspaceId, pageId, editable: true })).toBe(value);
    await vi.advanceTimersByTimeAsync(500);
    expect(transports[0]?.write).toHaveBeenCalledOnce();
    expect(value.getStatus()).toBe("saved");
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("retains an unconfirmed denied draft for copying and stops further auto-writes", async () => {
    const value = session();
    const release = value.mount();
    await value.connect();
    const transport = transports[0];
    if (!transport) throw new Error("Expected transport");
    transport.handler = async () => {
      throw new DocumentTransportError("denied");
    };
    const version = value.getStructureVersion();
    text(value).insert(0, "Denied local draft");
    await value.provider.flush();
    expect(value.getStatus()).toBe("denied");
    expect(value.getStructureVersion()).toBeGreaterThan(version);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    await value.provider.retry();
    expect(transport.write).toHaveBeenCalledOnce();
    expect(getPendingDraftSession(userId, pageId)?.draftText()).toBe("Denied local draft");
  });

  it("shows only unmounted draft metadata and copies plain text on an explicit click", async () => {
    const value = session();
    const release = value.mount();
    await value.connect();
    const transport = transports[0];
    if (!transport) throw new Error("Expected transport");
    transport.handler = async () => {
      throw new DocumentTransportError("transient");
    };
    const content = text(value);
    content.insert(0, "Recover <draft> safely");
    content.format(0, content.length, { bold: {} });
    await value.provider.flush();
    release();
    await vi.advanceTimersByTimeAsync(0);
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    views.push(() => {
      flushSync(() => root.unmount());
      host.remove();
    });
    flushSync(() => root.render(createElement(PendingDrafts, { userId })));
    expect(host.textContent).toContain("Falha ao salvar");
    expect(host.textContent).not.toContain("Recover <draft> safely");
    expect(host.querySelector("a")?.getAttribute("href")).toBe(`/w/${workspaceId}/p/${pageId}`);
    const button = host.querySelector("button");
    if (!button) throw new Error("Expected copy button");
    flushSync(() => button.click());
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Recover <draft> safely");
    expect(host.textContent).toContain("Rascunho copiado.");
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    flushSync(() => button.click());
    await vi.advanceTimersByTimeAsync(0);
    expect(host.textContent).toContain("Não foi possível copiar.");
    expect(getPendingDraftSession(userId, pageId)).toBe(value);
    expect(value.provider.hasPendingChanges()).toBe(true);
    let close: () => void = () => undefined;
    flushSync(() => {
      close = value.mount();
    });
    expect(host.textContent).toBe("");
    close();
    await vi.advanceTimersByTimeAsync(0);
  });
});
