import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { decodePosition, encodeCursor, participantsFromState, revisionSchema, validCursor } from "@/features/collaboration/protocol";

const participantId = "d1549361-8c97-4db5-923a-69fc0f381401";
const blockId = "8b09a58b-c323-400c-a0c3-ac560f035762";
describe("bounded collaboration metadata", () => {
  it("accepts only revision and the documented optional transport id", () => {
    expect(revisionSchema.safeParse({ revision: 2 }).success).toBe(true);
    expect(revisionSchema.safeParse({ revision: 2, id: participantId }).success).toBe(true);
    expect(revisionSchema.safeParse({ revision: 2, body: "private" }).success).toBe(false);
    expect(revisionSchema.safeParse({ revision: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });
  it("encodes relative identities that rebase after concurrent insertions without sending text", () => {
    const doc = new Y.Doc();
    const text = doc.getText("fixture");
    const position = Y.createRelativePositionFromTypeIndex(text, 0);
    // A root name that is not a block fragment cannot enter presence.
    expect(encodeCursor(blockId, { anchor: position, head: position })).toBeNull();
    const fragment = doc.getXmlFragment(`block-content:${blockId}`);
    const element = new Y.XmlElement("paragraph");
    const inline = new Y.XmlText();
    element.insert(0, [inline]);
    fragment.insert(0, [element]);
    inline.insert(0, "sample");
    const relative = Y.createRelativePositionFromTypeIndex(inline, 2);
    const cursor = encodeCursor(blockId, { anchor: relative, head: relative });
    expect(cursor).not.toBeNull();
    expect(JSON.stringify(cursor)).not.toContain("sample");
    inline.insert(0, "new");
    const decoded = decodePosition(cursor?.anchor ?? "", blockId);
    expect(decoded && Y.createAbsolutePositionFromRelativePosition(decoded, doc)?.index).toBe(5);
    doc.destroy();
  });
  it("rejects appended bytes, arbitrary payload keys and malformed positions", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(`block-content:${blockId}`);
    const position = Y.createRelativePositionFromTypeIndex(fragment, 0);
    const cursor = encodeCursor(blockId, { anchor: position, head: position });
    expect(cursor).not.toBeNull();
    const bytes = Uint8Array.from(atob(cursor?.anchor ?? ""), (c) => c.charCodeAt(0));
    const extra = btoa(String.fromCharCode(...bytes, 0, 1));
    expect(validCursor({ ...cursor, anchor: extra })).toBeNull();
    expect(validCursor({ ...cursor, text: "not allowed" })).toBeNull();
    expect(validCursor({ ...cursor, anchor: "////" })).toBeNull();
    doc.destroy();
  });
  it("uses only live authorized roster labels and ignores injected identity fields", () => {
    const now = Date.now();
    const expiresAt = new Date(now + 20_000).toISOString();
    const lease = {
      epoch: 3,
      expiresAt,
      participants: [{ participantId, label: "Pessoa autorizada", expiresAt }],
    };
    const valid = { participantId, color: "copper", cursor: null, presence_ref: "reference" };
    expect(participantsFromState(lease, { [participantId]: [valid] }, "self", now)[0]?.label).toBe(
      "Pessoa autorizada",
    );
    expect(
      participantsFromState(lease, { [participantId]: [{ ...valid, label: "Forged" }] }, "self", now),
    ).toEqual([]);
    expect(participantsFromState(lease, { [participantId]: [valid] }, "self", now + 21_000)).toEqual([]);
    expect(participantsFromState(lease, { unknown: [valid] }, "self", now)).toEqual([]);
  });
});
