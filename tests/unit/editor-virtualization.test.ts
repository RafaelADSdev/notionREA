import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVirtualBlockIndex,
  protectedVirtualBlocks,
  virtualBlockWindow,
  virtualSelectionIds,
  virtualVisibleOrder,
} from "../../src/features/editor/model/virtualization";
import {
  type VirtualBlockHandle,
  VirtualPageBlockProvider,
  VirtualPageBlocks,
} from "../../src/features/editor/ui/virtual-page-blocks";

function blocks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `block-${index}`,
    parentId: null,
    type: "paragraph",
  }));
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("document virtualization without changing canonical block order", () => {
  it("bounds mounted rows in a 5,000-block document while spacers preserve its full estimated extent", () => {
    const items = blocks(5000);
    const tree = buildVirtualBlockIndex(items);
    const window = virtualBlockWindow(
      items,
      { top: 48000, height: 900, overscan: 600 },
      (id) => tree.estimatedHeight(id),
      new Set(),
      true,
    );
    const mounted = window.filter((part) => part.kind === "item");
    expect(mounted.length).toBeGreaterThan(18);
    expect(mounted.length).toBeLessThan(50);
    expect(window.reduce((sum, part) => sum + part.height, 0)).toBe(5000 * 48);
    expect(items[0]?.id).toBe("block-0");
    expect(items.at(-1)?.id).toBe("block-4999");
  });
  it("retains focused, composing, selected and dragged blocks outside the viewport", () => {
    const items = blocks(5000),
      tree = buildVirtualBlockIndex(items);
    const pins = protectedVirtualBlocks(tree, {
      focused: "block-4999",
      composing: "block-3000",
      dragging: "block-2500",
      selected: ["block-2000"],
    });
    const window = virtualBlockWindow(items, { top: 0, height: 900, overscan: 300 }, () => 48, pins, true);
    expect(window.filter((part) => part.kind === "item").map((part) => part.id)).toEqual(
      expect.arrayContaining(["block-4999", "block-3000", "block-2500", "block-2000"]),
    );
  });
  it("pins an entire ancestor path without recursion or an artificial depth ceiling", () => {
    const items = Array.from({ length: 5000 }, (_, index) => ({
      id: `level-${index}`,
      parentId: index ? `level-${index - 1}` : null,
      type: "toggle",
    }));
    const tree = buildVirtualBlockIndex(items);
    const pins = protectedVirtualBlocks(tree, { requested: "level-4999" });
    expect(pins.size).toBe(5000);
    expect(tree.estimatedHeight("level-0")).toBe(5000 * 48);
  });
  it("materializes a complete native selection interval and excludes explicitly collapsed subtrees", () => {
    const tree = buildVirtualBlockIndex([
      { id: "first", parentId: null, type: "paragraph" },
      { id: "toggle", parentId: null, type: "toggle" },
      { id: "hidden", parentId: "toggle", type: "paragraph" },
      { id: "last", parentId: null, type: "paragraph" },
    ]);
    expect(virtualSelectionIds(tree, "last", "first", new Set(["toggle"]))).toEqual([
      "first",
      "toggle",
      "last",
    ]);
    expect(virtualSelectionIds(tree, "first", "last")).toEqual(["first", "toggle", "hidden", "last"]);
  });
  it("reuses measured variable heights and never hides rows on small pages", () => {
    const items = blocks(3);
    const sizes = new Map([
      ["block-0", 600],
      ["block-1", 40],
      ["block-2", 80],
    ]);
    const window = virtualBlockWindow(
      items,
      { top: 610, height: 20, overscan: 0 },
      (id) => sizes.get(id) ?? 48,
      new Set(),
      true,
    );
    expect(window.filter((part) => part.kind === "item").map((part) => part.id)).toEqual(["block-1"]);
    expect(
      virtualBlockWindow(items, { top: 10000, height: 20, overscan: 0 }, () => 48, new Set(), false).filter(
        (part) => part.kind === "item",
      ),
    ).toHaveLength(3);
  });
  it("keeps table rows and cells canonical while navigating the table as one block frame", () => {
    const tree = buildVirtualBlockIndex([
      { id: "table", parentId: null, type: "table" },
      { id: "row", parentId: "table", type: "tableRow" },
      { id: "cell", parentId: "row", type: "tableCell" },
      { id: "after", parentId: null, type: "paragraph" },
    ]);
    expect(tree.size).toBe(4);
    expect(virtualVisibleOrder(tree)).toEqual(["table", "after"]);
    expect(protectedVirtualBlocks(tree, { requested: "cell" })).toEqual(new Set(["cell", "row", "table"]));
  });
  it("rejects malformed trees rather than hiding orphaned or cyclic content", () => {
    expect(() => buildVirtualBlockIndex([{ id: "one", parentId: "missing", type: "paragraph" }])).toThrow();
    expect(() =>
      buildVirtualBlockIndex([
        { id: "one", parentId: "two", type: "toggle" },
        { id: "two", parentId: "one", type: "toggle" },
      ]),
    ).toThrow();
  });
  it("keeps the actual focused/composing DOM view mounted while scrolling and reveals an offscreen target", async () => {
    let top = 0;
    let sequence = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const id = this.dataset.virtualBlock;
      return new DOMRect(0, id ? Number(id.slice(6)) * 48 - top : -top, 1000, id ? 48 : 5000 * 48);
    });
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    cleanups.push(() => {
      if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    });
    const items = blocks(5000),
      host = document.createElement("div"),
      ref = createRef<VirtualBlockHandle>();
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
      flushSync(() => root.unmount());
      host.remove();
    });
    flushSync(() =>
      root.render(
        createElement(
          VirtualPageBlockProvider,
          {
            blocks: items,
            pageId: "page",
            ref,
          },
          createElement(VirtualPageBlocks, {
            items,
            renderItem: (block) =>
              createElement("input", { "data-editor-block": block.id, defaultValue: block.id }),
          }),
        ),
      ),
    );
    const first = host.querySelector<HTMLInputElement>('[data-editor-block="block-0"]');
    if (!first) throw new Error("Expected the first mounted block");
    first.value = "Pending local composition";
    flushSync(() => {
      first.focus();
      first.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    top = 4990 * 48;
    window.dispatchEvent(new Event("scroll"));
    flushSync(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(0);
    });
    expect(host.querySelector('[data-editor-block="block-0"]')).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(first.value).toBe("Pending local composition");
    expect(host.querySelectorAll("input").length).toBeLessThan(80);
    expect(await ref.current?.reveal("block-2500")).toBe(true);
    expect(host.querySelector('[data-editor-block="block-2500"]')).not.toBeNull();
  });
});
