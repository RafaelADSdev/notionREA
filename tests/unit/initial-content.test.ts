import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { initialContentUpdate } from "../../src/features/editor/model/initial-content";
import { validateContentDocument } from "../../src/features/editor/model/content-schema";
describe("shared initial content identity", () => {
  it("starts both peers from one canonical empty block without copying mutable bytes", () => {
    const first = new Y.Doc(),
      second = new Y.Doc();
    try {
      const bytes = initialContentUpdate();
      Y.applyUpdate(first, bytes);
      Y.applyUpdate(second, initialContentUpdate());
      bytes.fill(0);
      Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
      expect(validateContentDocument(first).blocks.map((block) => block.id)).toEqual(["initial"]);
      expect(validateContentDocument(second)).toEqual(validateContentDocument(first));
      expect(first.getMap("identities").get("initial")).toBe(true);
    } finally {
      first.destroy();
      second.destroy();
    }
  });
});
