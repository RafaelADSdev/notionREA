import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { StablePage, type BlockInput } from "../../src/features/editor/model/stable-page";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";

type Scenario = "paragraph" | "toggle" | "table" | "columns";
type Peer = { document: Y.Doc; page: StablePage; editor: Editor };
const peers: Peer[] = [];

function createPeer(document: Y.Doc, actor: string): Peer {
  const page = new StablePage(document, actor);
  const editor = new Editor({
    element: globalThis.document.createElement("div"),
    injectCSS: false,
    extensions: [StarterKit.configure({ undoRedo: false }), pageCollaboration(page, "subject")],
  });
  const peer = { document, page, editor };
  peers.push(peer);
  return peer;
}

function sharedPeers(scenario: Scenario = "paragraph"): [Peer, Peer, string] {
  const document = new Y.Doc();
  const page = new StablePage(document, "seed");
  const blocks: BlockInput[] = [
    { id: "first", type: "paragraph", parentId: null, position: "a" },
    { id: "last", type: "paragraph", parentId: null, position: "z" },
  ];
  if (scenario !== "paragraph")
    blocks.push({ id: "container", type: scenario, parentId: null, position: "m" });
  let parentId: string | null = scenario === "paragraph" ? null : "container";
  if (scenario === "table") {
    blocks.push({ id: "row", type: "tableRow", parentId, position: "a" });
    blocks.push({ id: "cell", type: "tableCell", parentId: "row", position: "a" });
    parentId = "cell";
  } else if (scenario === "columns") {
    blocks.push({ id: "column-one", type: "column", parentId, position: "a" });
    blocks.push({ id: "column-two", type: "column", parentId, position: "z" });
    parentId = "column-one";
  }
  blocks.push({ id: "subject", type: "paragraph", parentId, position: "m" });
  for (const block of blocks) page.createBlock(block);
  page.destroy();
  const seed = createPeer(document, "seed-editor");
  seed.editor.commands.setContent({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }],
  });
  const update = Y.encodeStateAsUpdate(document);
  const firstDocument = new Y.Doc();
  const secondDocument = new Y.Doc();
  Y.applyUpdate(firstDocument, update);
  Y.applyUpdate(secondDocument, update);
  return [
    createPeer(firstDocument, "first"),
    createPeer(secondDocument, "second"),
    scenario === "paragraph" ? "subject" : "container",
  ];
}

function move(peer: Peer, id: string, destination: "start" | "end") {
  peer.page.moveBlock(id, null, destination === "start" ? "00" : "zz");
}

function append(editor: Editor, text: string) {
  editor.view.dispatch(editor.state.tr.insertText(text, editor.state.doc.content.size - 1));
}

function exchange(first: Peer, second: Peer) {
  const updates = [Y.encodeStateAsUpdate(first.document), Y.encodeStateAsUpdate(second.document)];
  for (const peer of [first, second]) {
    for (const update of updates) {
      Y.applyUpdate(peer.document, update);
      Y.applyUpdate(peer.document, update);
    }
    peer.page.validate();
  }
}

afterEach(() => {
  for (const peer of peers.splice(0)) {
    peer.editor.destroy();
    peer.page.destroy();
    peer.document.destroy();
  }
});

describe("ADR-001/002/012 collaboration acceptance spike", () => {
  it("preserves both concurrent text contributions and converges under repeated updates", () => {
    const [first, second] = sharedPeers();
    append(first.editor, "-local");
    append(second.editor, "-remote");
    exchange(first, second);
    expect(first.editor.getJSON()).toEqual(second.editor.getJSON());
    expect(first.editor.getText()).toContain("-local");
    expect(first.editor.getText()).toContain("-remote");
  });

  it.each<Scenario>(["paragraph", "toggle", "table", "columns"])(
    "preserves a concurrent text edit when moving a %s block",
    (scenario) => {
      const [first, second, movingId] = sharedPeers(scenario);
      const contentIdentity = first.page.fragment("subject");
      move(first, movingId, "end");
      append(second.editor, "-remote");
      expect(second.editor.getText()).toBe("Beta-remote");
      exchange(first, second);
      expect(first.editor.getJSON()).toEqual(second.editor.getJSON());
      expect(first.editor.getText()).toContain("-remote");
      expect(first.editor.getText()).toBe("Beta-remote");
      expect(first.page.fragment("subject")).toBe(contentIdentity);
      expect(first.page.visibleChildren().at(-1)?.id).toBe(movingId);
    },
  );

  it("retains one identity when both peers move the same block", () => {
    const [first, second] = sharedPeers();
    move(first, "subject", "end");
    move(second, "subject", "start");
    exchange(first, second);
    expect(first.editor.getJSON()).toEqual(second.editor.getJSON());
    expect(first.editor.getText()).toBe("Beta");
    expect(first.page.visibleChildren()).toEqual(second.page.visibleChildren());
    expect(first.page.visibleChildren().filter((block) => block.id === "subject")).toHaveLength(1);
    expect(first.page.visibleChildren()).toHaveLength(3);
  });

  it("keeps page history alive when another block view is destroyed", () => {
    const [first] = sharedPeers();
    const extra = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: [StarterKit.configure({ undoRedo: false }), pageCollaboration(first.page, "first")],
    });
    first.page.undoManager.clear();
    extra.destroy();
    move(first, "subject", "end");
    expect(first.page.undo()).toBe(true);
    expect(first.page.visibleChildren().map((block) => block.id)).toEqual(["first", "subject", "last"]);
    expect(first.page.redo()).toBe(true);
    expect(first.page.visibleChildren().at(-1)?.id).toBe("subject");
  });

  it("undoes local text without removing a remote edit after another view is destroyed", () => {
    const [first, second] = sharedPeers();
    const extra = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: [StarterKit.configure({ undoRedo: false }), pageCollaboration(first.page, "first")],
    });
    first.page.undoManager.clear();
    extra.destroy();
    append(first.editor, "-local");
    append(second.editor, "-remote");
    exchange(first, second);
    expect(first.editor.commands.undo()).toBe(true);
    expect(first.editor.getText()).toBe("Beta-remote");
    exchange(first, second);
    expect(second.editor.getText()).toBe("Beta-remote");
  });
});
