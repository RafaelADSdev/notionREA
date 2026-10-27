import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { validateContentDocument } from "../../src/features/editor/model/content-schema";
import {
  type DocumentSnapshot,
  type DocumentTransport,
  DocumentTransportError,
  DurableDocumentProvider,
} from "../../src/features/editor/model/durable-document-provider";
import { initialContentUpdate } from "../../src/features/editor/model/initial-content";
import { StablePage } from "../../src/features/editor/model/stable-page";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
function document() {
  const value = new Y.Doc();
  Y.applyUpdate(value, initialContentUpdate());
  cleanup.push(() => value.destroy());
  return value;
}
function append(value: Y.Doc, text: string) {
  const fragment = value.getXmlFragment("block-content:initial"),
    paragraph = fragment.get(0);
  if (!(paragraph instanceof Y.XmlElement)) throw new Error("Expected paragraph");
  let content = paragraph.get(0);
  if (!content) {
    content = new Y.XmlText();
    paragraph.insert(0, [content]);
  }
  if (!(content instanceof Y.XmlText)) throw new Error("Expected text");
  content.insert(content.length, text);
}
describe("independent editor access-race review", () => {
  it("keeps canonical content valid when undoing a type change with a later remote attribute contribution", () => {
    const local = document(),
      page = new StablePage(local, "local-history");
    cleanup.push(() => page.destroy());
    page.runAction(() => {
      page.transformBlock("initial", "callout");
      page.setBlockAttributes("initial", { tone: "copper" });
    });
    const remote = document();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    const other = new StablePage(remote, "remote-history");
    cleanup.push(() => other.destroy());
    other.setBlockAttributes("initial", { tone: "green" });
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote), "remote-history");
    // Every part of this transform now supports an accepted remote attribute.
    // There is no remaining local change that can be undone safely.
    expect(page.undo()).toBe(false);
    expect(() => validateContentDocument(local)).not.toThrow();
    expect(page.getBlock("initial")?.type).toBe("callout");
    expect(page.getBlockAttributes("initial").tone).toBe("green");
    page.redo();
    expect(() => validateContentDocument(local)).not.toThrow();
    expect(page.getBlockAttributes("initial").tone).toBe("green");
  });
  it("still undoes and redoes a type change with no later remote attribute write", () => {
    const local = document(),
      page = new StablePage(local, "local-history");
    cleanup.push(() => page.destroy());
    page.runAction(() => {
      page.transformBlock("initial", "callout");
      page.setBlockAttributes("initial", { tone: "copper" });
    });
    expect(page.undo()).toBe(true);
    expect(page.getBlock("initial")?.type).toBe("paragraph");
    expect(() => validateContentDocument(local)).not.toThrow();
    expect(page.redo()).toBe(true);
    expect(page.getBlockAttributes("initial").tone).toBe("copper");
    expect(() => validateContentDocument(local)).not.toThrow();
  });
  it("undoes and redoes its own text while retaining the remotely-dependent transformed wrapper", () => {
    const local = document(),
      page = new StablePage(local, "local-history");
    cleanup.push(() => page.destroy());
    page.fragment("initial");
    page.runAction(() => {
      page.transformBlock("initial", "callout");
      page.setBlockAttributes("initial", { tone: "copper" });
      append(local, "OWN");
    });
    const remote = document();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    const other = new StablePage(remote, "remote-history");
    cleanup.push(() => other.destroy());
    other.setBlockAttributes("initial", { tone: "green" });
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote), "remote-history");
    expect(page.undo()).toBe(true);
    expect(validateContentDocument(local).text).toBe("");
    expect(page.getBlock("initial")?.type).toBe("callout");
    expect(page.getBlockAttributes("initial").tone).toBe("green");
    expect(page.redo()).toBe(true);
    expect(validateContentDocument(local).text).toBe("OWN");
    expect(page.getBlockAttributes("initial").tone).toBe("green");
  });
  it("keeps denial terminal when an earlier synchronize read finishes after a denied write", async () => {
    const local = document(),
      remote = document(),
      lateRead = Promise.withResolvers<DocumentSnapshot>();
    append(remote, "Previously authorized remote text");
    let reads = 0;
    const transport: DocumentTransport = {
      read: async () =>
        ++reads === 1
          ? { revision: 1, schemaVersion: 1, snapshot: initialContentUpdate() }
          : lateRead.promise,
      write: async () => {
        throw new DocumentTransportError("denied");
      },
    };
    const provider = new DurableDocumentProvider({
      document: local,
      transport,
      editable: true,
      debounceMs: 100000,
    });
    cleanup.push(() => provider.dispose());
    await provider.connect();
    const sync = provider.synchronize();
    append(local, "Unconfirmed draft");
    await provider.flush();
    expect(provider.state).toBe("denied");
    lateRead.resolve({ revision: 2, schemaVersion: 1, snapshot: Y.encodeStateAsUpdate(remote) });
    await sync;
    expect(provider.state).toBe("denied");
    expect(local.getXmlFragment("block-content:initial").toString()).not.toContain(
      "Previously authorized remote text",
    );
  });
  it("recomputes undo protection when a blocked top action exposes an older remote-edited creation", () => {
    const local = document(),
      page = new StablePage(local, "local-history");
    cleanup.push(() => page.destroy());
    page.runAction(() => {
      page.createBlock({ id: "earlier", type: "paragraph", parentId: null, position: "z" });
      const paragraph = new Y.XmlElement("paragraph"),
        text = new Y.XmlText();
      paragraph.insert(0, [text]);
      page.fragment("earlier").insert(0, [paragraph]);
      text.insert(0, "OWN");
    });
    page.runAction(() => {
      page.transformBlock("initial", "callout");
      page.setBlockAttributes("initial", { tone: "copper" });
    });
    const remote = document();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    const other = new StablePage(remote, "remote-history");
    cleanup.push(() => other.destroy());
    other.setBlockAttributes("initial", { tone: "green" });
    const paragraph = other.fragment("earlier").get(0);
    if (!(paragraph instanceof Y.XmlElement)) throw new Error("Expected paragraph");
    const text = paragraph.get(0);
    if (!(text instanceof Y.XmlText)) throw new Error("Expected text");
    text.insert(text.length, "REMOTE");
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote), "remote-history");
    page.undo();
    expect(() => validateContentDocument(local)).not.toThrow();
    expect(validateContentDocument(local).text).toContain("REMOTE");
  });
});
