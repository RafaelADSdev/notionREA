import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { templateContentUpdates } from "../../src/features/databases/model/template-content";
import { validateContentDocument } from "../../src/features/editor/model/content-schema";

describe("independent template documents", () => {
  it("copies rich text in bounded causal updates with new identities and authorized file replacements", () => {
    const text = "Ideias 🌿 ".repeat(25000);
    const source = {
      schemaVersion: 1,
      blocks: [
        {
          id: "old",
          type: "paragraph",
          parentId: null,
          position: "U",
          attributes: {},
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "bold" }] }] }],
          },
        },
        {
          id: "attachment",
          type: "file",
          parentId: null,
          position: "V",
          attributes: { fileId: "00000000-0000-4000-8000-000000000001" },
          content: { type: "doc", content: [] },
        },
      ],
    };
    const replacement = "00000000-0000-4000-8000-000000000002";
    const updates = templateContentUpdates(
      source,
      new Map([[source.blocks[1]?.attributes.fileId ?? "", replacement]]),
    );
    const document = new Y.Doc();
    try {
      expect(updates.length).toBeGreaterThan(1);
      for (const update of updates) {
        expect(update.length).toBeLessThanOrEqual(262144);
        Y.applyUpdate(document, update);
        validateContentDocument(document);
      }
      const result = validateContentDocument(document);
      expect(result.text).toBe(text);
      expect(result.blocks.map((block) => block.id)).not.toContain("old");
      expect(result.files).toEqual([replacement]);
      expect(result.blocks[0]?.content.content[0]?.content[0]).toMatchObject({
        type: "text",
        marks: [{ type: "bold" }],
      });
    } finally {
      document.destroy();
    }
  });
});
