import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  appendLocalPage,
  assertLocalTree,
  decodeLocalBackup,
  encodeLocalBytes,
  mergeLocalDocument,
} from "../../src/features/local/model";
import { initialContentUpdate } from "../../src/features/editor/model/initial-content";

describe("browser-owned notes", () => {
  it("creates ordered stable identities and rejects cyclic backup hierarchies", () => {
    const first = appendLocalPage([], null).page;
    const second = appendLocalPage([first], null).page;
    expect(first.id).not.toBe(second.id);
    expect(first.position < second.position).toBe(true);
    const child = appendLocalPage([first], first.id).page;
    expect(() => assertLocalTree([{ ...first, parentId: child.id }, child])).toThrow();
  });
  it("merges concurrent Yjs deltas rather than replacing snapshots", () => {
    const seed = mergeLocalDocument(undefined, initialContentUpdate(), crypto.randomUUID());
    const a = new Y.Doc(),
      b = new Y.Doc();
    try {
      Y.applyUpdate(a, seed.snapshot);
      Y.applyUpdate(b, seed.snapshot);
      const vector = Y.encodeStateVector(a);
      const textA = new Y.XmlText();
      textA.insert(0, "Alpha");
      const textB = new Y.XmlText();
      textB.insert(0, "Beta");
      (a.getXmlFragment("block-content:initial").get(0) as Y.XmlElement).insert(0, [textA]);
      (b.getXmlFragment("block-content:initial").get(0) as Y.XmlElement).insert(0, [textB]);
      const one = mergeLocalDocument(seed, Y.encodeStateAsUpdate(a, vector), seed.pageId);
      const both = mergeLocalDocument(one, Y.encodeStateAsUpdate(b, vector), seed.pageId);
      expect(both.text).toContain("Alpha");
      expect(both.text).toContain("Beta");
      expect(both.revision).toBe(3);
    } finally {
      a.destroy();
      b.destroy();
    }
  });
  it("validates full backup content and rejects orphan documents", () => {
    const page = appendLocalPage([], null).page;
    const head = mergeLocalDocument(undefined, initialContentUpdate(), page.id);
    const backup = {
      format: "bloco-local",
      version: 1,
      exportedAt: "now",
      pages: [page],
      documents: [{ pageId: page.id, snapshot: encodeLocalBytes(head.snapshot) }],
    };
    expect(decodeLocalBackup(JSON.stringify(backup)).documents[0]?.snapshot).toEqual(head.snapshot);
    expect(() => decodeLocalBackup(JSON.stringify({ ...backup, pages: [] }))).toThrow();
    expect(() => mergeLocalDocument(head, new Uint8Array([0, 255]), page.id)).toThrow();
  });
});
