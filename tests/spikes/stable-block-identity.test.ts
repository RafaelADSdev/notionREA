import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

// Architectural experiment only: placement never replaces the text's CRDT identity.
// This is not the production editor or proof of nested selection/deletion behavior.
type Placement = { parentId: string | null; rank: string };
type Peer = { document: Y.Doc; editor: Editor; placements: Y.Map<Placement> };
const peers: Peer[] = [];

function createPeer(update?: Uint8Array): Peer {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  const placements = document.getMap<Placement>("placements");
  const editor = new Editor({
    element: globalThis.document.createElement("div"),
    injectCSS: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document, field: "block-content:subject" }),
    ],
  });
  const peer = { document, editor, placements };
  peers.push(peer);
  return peer;
}

function sharedPeers(): [Peer, Peer] {
  const seed = createPeer();
  seed.placements.set("first", { parentId: null, rank: "a" });
  seed.placements.set("subject", { parentId: null, rank: "m" });
  seed.placements.set("last", { parentId: null, rank: "z" });
  seed.editor.commands.setContent({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }],
  });
  const update = Y.encodeStateAsUpdate(seed.document);
  return [createPeer(update), createPeer(update)];
}

function exchange(first: Peer, second: Peer) {
  const updates = [Y.encodeStateAsUpdate(second.document), Y.encodeStateAsUpdate(first.document)];
  for (const peer of [first, second]) {
    for (const update of updates) {
      Y.applyUpdate(peer.document, update);
      Y.applyUpdate(peer.document, update);
    }
  }
}

afterEach(() => {
  for (const peer of peers.splice(0)) {
    peer.editor.destroy();
    peer.document.destroy();
  }
});

describe("proposed stable block identity experiment", () => {
  it("preserves a concurrent text edit while moving the block without replacing its content fragment", () => {
    const [first, second] = sharedPeers();
    first.placements.set("subject", { parentId: null, rank: "zz" });
    second.editor.commands.insertContentAt(5, "-remote");
    expect(second.editor.getText()).toBe("Beta-remote");
    exchange(first, second);
    expect(first.editor.getText()).toBe("Beta-remote");
    expect(first.editor.getJSON()).toEqual(second.editor.getJSON());
    expect(first.placements.toJSON()).toEqual(second.placements.toJSON());
    expect(first.placements.get("subject")).toEqual({ parentId: null, rank: "zz" });
    const reloaded = createPeer(Y.encodeStateAsUpdate(first.document));
    expect(reloaded.editor.getText()).toBe("Beta-remote");
    expect(reloaded.placements.get("subject")).toEqual(first.placements.get("subject"));
  });

  it("converges to one placement when both peers move the same identity", () => {
    const [first, second] = sharedPeers();
    first.placements.set("subject", { parentId: null, rank: "00" });
    second.placements.set("subject", { parentId: null, rank: "zz" });
    exchange(first, second);
    expect(first.placements.toJSON()).toEqual(second.placements.toJSON());
    expect([...first.placements.keys()]).toHaveLength(3);
    expect(["00", "zz"]).toContain(first.placements.get("subject")?.rank);
    expect(first.editor.getText()).toBe("Beta");
  });
});
