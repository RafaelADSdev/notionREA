import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { StablePage } from "../../src/features/editor/model/stable-page";

type Peer = { document: Y.Doc; page: StablePage };
const peers: Peer[] = [];

function createPeer(actor: string, update?: Uint8Array): Peer {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  const page = new StablePage(document, actor);
  const peer = { document, page };
  peers.push(peer);
  return peer;
}

function insertText(peer: Peer, id: string, value: string) {
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, value);
  paragraph.insert(0, [text]);
  peer.page.fragment(id).insert(0, [paragraph]);
}

function appendText(peer: Peer, id: string, value: string) {
  const paragraph = peer.page.fragment(id).get(0);
  if (!(paragraph instanceof Y.XmlElement)) throw new Error("Expected paragraph element");
  const text = paragraph.get(0);
  if (!(text instanceof Y.XmlText)) throw new Error("Expected paragraph text");
  text.insert(text.length, value);
}

function exchange(first: Peer, second: Peer) {
  const updates = [Y.encodeStateAsUpdate(first.document), Y.encodeStateAsUpdate(second.document)];
  for (const peer of [first, second]) {
    for (const update of updates) {
      Y.applyUpdate(peer.document, update);
      Y.applyUpdate(peer.document, update);
    }
  }
}

function sharedPeers(): [Peer, Peer] {
  const seed = createPeer("seed");
  seed.page.createBlock({ id: "first", type: "paragraph", parentId: null, position: "a" });
  seed.page.createBlock({ id: "subject", type: "paragraph", parentId: null, position: "m" });
  seed.page.createBlock({ id: "last", type: "paragraph", parentId: null, position: "z" });
  insertText(seed, "subject", "Beta");
  const update = Y.encodeStateAsUpdate(seed.document);
  return [createPeer("first-actor", update), createPeer("second-actor", update)];
}

afterEach(() => {
  for (const peer of peers.splice(0)) {
    peer.page.destroy();
    peer.document.destroy();
  }
});

describe("StablePage structural invariants", () => {
  it("moves a block without replacing its collaborative content identity", () => {
    const [peer] = sharedPeers();
    const originalFragment = peer.page.fragment("subject");
    peer.page.moveBlock("subject", null, "zz");
    expect(peer.page.fragment("subject")).toBe(originalFragment);
    expect(originalFragment.toString()).toContain("Beta");
    expect(peer.page.visibleChildren().map((block) => block.id)).toEqual(["first", "last", "subject"]);
    expect(() => peer.page.validate()).not.toThrow();
  });

  it("rejects a local ancestry cycle without changing the document", () => {
    const peer = createPeer("local");
    peer.page.createBlock({ id: "parent", type: "toggle", parentId: null, position: "a" });
    peer.page.createBlock({ id: "child", type: "toggle", parentId: "parent", position: "a" });
    const before = Y.encodeStateAsUpdate(peer.document);
    expect(() => peer.page.moveBlock("parent", "child", "a")).toThrow();
    expect(Y.encodeStateAsUpdate(peer.document)).toEqual(before);
    expect(peer.page.visibleChildren().map((block) => block.id)).toEqual(["parent"]);
    expect(peer.page.visibleChildren("parent").map((block) => block.id)).toEqual(["child"]);
  });

  it("rejects a parent that is not present in the canonical page", () => {
    const peer = createPeer("local");
    expect(() => {
      peer.page.createBlock({ id: "orphan", type: "paragraph", parentId: "missing", position: "a" });
      peer.page.validate();
    }).toThrow();
  });

  it("detects a cycle introduced by individually valid concurrent moves", () => {
    const seed = createPeer("seed");
    seed.page.createBlock({ id: "north", type: "toggle", parentId: null, position: "a" });
    seed.page.createBlock({ id: "south", type: "toggle", parentId: null, position: "z" });
    const update = Y.encodeStateAsUpdate(seed.document);
    const first = createPeer("first-actor", update);
    const second = createPeer("second-actor", update);
    first.page.moveBlock("north", "south", "a");
    second.page.moveBlock("south", "north", "a");
    expect(() => first.page.validate()).not.toThrow();
    expect(() => second.page.validate()).not.toThrow();
    exchange(first, second);
    expect(() => first.page.validate()).toThrow();
    expect(() => second.page.validate()).toThrow();
  });

  it("orders positions ordinally with stable identities as the tie breaker", () => {
    const peer = createPeer("local");
    peer.page.createBlock({ id: "charlie", type: "paragraph", parentId: null, position: "m" });
    peer.page.createBlock({ id: "bravo", type: "paragraph", parentId: null, position: "a" });
    peer.page.createBlock({ id: "alpha", type: "paragraph", parentId: null, position: "a" });
    expect(peer.page.visibleChildren().map((block) => block.id)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("converges on a deterministic order when peers insert into the same position", () => {
    const [first, second] = sharedPeers();
    first.page.createBlock({ id: "alpha", type: "paragraph", parentId: null, position: "b" });
    second.page.createBlock({ id: "bravo", type: "paragraph", parentId: null, position: "b" });
    exchange(first, second);
    const expected = ["first", "alpha", "bravo", "subject", "last"];
    expect(first.page.visibleChildren().map((block) => block.id)).toEqual(expected);
    expect(second.page.visibleChildren().map((block) => block.id)).toEqual(expected);
  });
});

describe("StablePage deletion and recovery", () => {
  it("retains a concurrent edit to a removed block and reveals it on explicit restoration", () => {
    const [first, second] = sharedPeers();
    first.page.removeBlock("subject");
    appendText(second, "subject", "-remote");
    exchange(first, second);
    expect(first.page.visibleChildren().map((block) => block.id)).not.toContain("subject");
    expect(second.page.visibleChildren().map((block) => block.id)).not.toContain("subject");
    expect(first.page.fragment("subject").toString()).toContain("Beta-remote");
    expect(second.page.fragment("subject").toString()).toContain("Beta-remote");
    first.page.restoreBlock("subject");
    exchange(first, second);
    expect(first.page.visibleChildren().map((block) => block.id)).toEqual(["first", "subject", "last"]);
    expect(second.page.fragment("subject").toString()).toContain("Beta-remote");
  });

  it("hides descendants of a removed parent without erasing their content", () => {
    const peer = createPeer("local");
    peer.page.createBlock({ id: "parent", type: "toggle", parentId: null, position: "a" });
    peer.page.createBlock({ id: "child", type: "paragraph", parentId: "parent", position: "a" });
    insertText(peer, "child", "Retained child");
    const originalFragment = peer.page.fragment("child");
    peer.page.removeBlock("parent");
    expect(peer.page.visibleChildren()).toEqual([]);
    expect(peer.page.visibleChildren("parent")).toEqual([]);
    expect(peer.page.fragment("child")).toBe(originalFragment);
    expect(originalFragment.toString()).toContain("Retained child");
    peer.page.restoreBlock("parent");
    expect(peer.page.visibleChildren("parent").map((block) => block.id)).toEqual(["child"]);
    expect(originalFragment.toString()).toContain("Retained child");
  });

  it("does not restore an independently removed child when its parent is restored", () => {
    const peer = createPeer("local");
    peer.page.createBlock({ id: "parent", type: "toggle", parentId: null, position: "a" });
    peer.page.createBlock({ id: "child", type: "paragraph", parentId: "parent", position: "a" });
    insertText(peer, "child", "Hidden child");
    peer.page.removeBlock("child");
    peer.page.removeBlock("parent");
    peer.page.restoreBlock("parent");
    expect(peer.page.visibleChildren().map((block) => block.id)).toEqual(["parent"]);
    expect(peer.page.visibleChildren("parent")).toEqual([]);
    expect(peer.page.fragment("child").toString()).toContain("Hidden child");
  });
});

describe("StablePage local history and durability", () => {
  it("undoes a local move without undoing a remote text contribution", () => {
    const [first, second] = sharedPeers();
    first.page.stopCapturing();
    first.page.moveBlock("subject", null, "zz");
    first.page.stopCapturing();
    appendText(second, "subject", "-remote");
    exchange(first, second);
    expect(first.page.undo()).toBe(true);
    expect(first.page.visibleChildren().map((block) => block.id)).toEqual(["first", "subject", "last"]);
    expect(first.page.fragment("subject").toString()).toContain("Beta-remote");
    exchange(first, second);
    expect(second.page.visibleChildren().map((block) => block.id)).toEqual(["first", "subject", "last"]);
    expect(second.page.fragment("subject").toString()).toContain("Beta-remote");
    expect(first.page.redo()).toBe(true);
    expect(first.page.visibleChildren().map((block) => block.id)).toEqual(["first", "last", "subject"]);
    expect(first.page.fragment("subject").toString()).toContain("Beta-remote");
  });

  it("reconstructs identity, hierarchy, position, content and deletion state from a snapshot", () => {
    const seed = createPeer("seed");
    seed.page.createBlock({ id: "container", type: "toggle", parentId: null, position: "m" });
    seed.page.createBlock({ id: "subject", type: "paragraph", parentId: "container", position: "a" });
    seed.page.createBlock({ id: "removed", type: "paragraph", parentId: null, position: "z" });
    insertText(seed, "subject", "Nested content");
    insertText(seed, "removed", "Recoverable content");
    seed.page.removeBlock("removed");
    const reloaded = createPeer("reloaded", Y.encodeStateAsUpdate(seed.document));
    expect(() => reloaded.page.validate()).not.toThrow();
    expect(reloaded.page.visibleChildren()).toEqual(seed.page.visibleChildren());
    expect(reloaded.page.visibleChildren("container")).toEqual(seed.page.visibleChildren("container"));
    expect(reloaded.page.fragment("subject").toString()).toContain("Nested content");
    expect(reloaded.page.visibleChildren().map((block) => block.id)).not.toContain("removed");
    expect(reloaded.page.fragment("removed").toString()).toContain("Recoverable content");
    reloaded.page.restoreBlock("removed");
    expect(reloaded.page.visibleChildren().map((block) => block.id)).toEqual(["container", "removed"]);
  });
});
