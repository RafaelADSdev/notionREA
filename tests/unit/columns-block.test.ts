import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { columnLayout } from "../../src/features/editor/model/column-layout";
import { initializeContentDocument } from "../../src/features/editor/model/content-schema";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { ColumnsBlock } from "../../src/features/editor/ui/columns-block";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup(editable = true) {
  const document = new Y.Doc();
  initializeContentDocument(document);
  const page = new StablePage(document, "column-ui");
  page.runAction(() => {
    page.createBlock({ id: "group", type: "columns", parentId: null, position: "U" });
    for (const [id, position] of [
      ["a", "F"],
      ["b", "U"],
      ["c", "Z"],
    ] as const)
      page.createBlock({ id, type: "column", parentId: "group", position });
    page.createBlock({ id: "kept", type: "paragraph", parentId: "c", position: "U" });
    page.setBlockAttributes("group", { widths: [2, 1] });
  });
  const host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      createElement(
        ColumnsBlock,
        {
          page,
          groupId: "group",
          editable,
        },
        createElement("p", null, "Child content"),
      ),
    ),
  );
  cleanups.push(() => {
    flushSync(() => root.unmount());
    host.remove();
    page.destroy();
    document.destroy();
  });
  return { page, host };
}
function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing action ${label}`);
  return found;
}
describe("column group controls", () => {
  it("renders actual tracks, adds columns and commits a safe relative weight", () => {
    const { page, host } = setup();
    const grid = host.querySelector<HTMLElement>(".editor-columns");
    expect(grid?.style.getPropertyValue("--column-layout")).toBe("1fr 1fr 1fr");
    expect(grid?.textContent).toBe("Child content");
    flushSync(() => button(host, "Adicionar coluna").click());
    expect(columnLayout(page, "group").columns).toHaveLength(4);
    expect(grid?.style.getPropertyValue("--column-layout")).toBe("1fr 1fr 1fr 1fr");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Largura relativa da coluna 1"]');
    if (!input) throw new Error("Missing weight control");
    input.focus();
    input.value = "3.5";
    flushSync(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(columnLayout(page, "group").weights).toEqual([3.5, 1, 1, 1]);
  });
  it("confirms removal, preserves children and restores focus on cancellation", () => {
    const { page, host } = setup();
    const trigger = button(host, "Remover coluna 3");
    trigger.focus();
    flushSync(() => trigger.click());
    expect(page.getBlock("kept")?.parentId).toBe("c");
    expect(host.querySelector("dialog")?.textContent).toContain("movidos para a coluna vizinha");
    expect(globalThis.document.activeElement).toBe(button(host, "Cancelar"));
    flushSync(() => button(host, "Cancelar").click());
    expect(globalThis.document.activeElement).toBe(trigger);
    flushSync(() => trigger.click());
    flushSync(() => button(host, "Remover coluna").click());
    expect(page.getBlock("kept")?.parentId).toBe("b");
    expect(host.querySelector("dialog")).toBeNull();
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remover coluna"]')].every(
        (item) => item.disabled,
      ),
    ).toBe(true);
    expect(globalThis.document.activeElement).toBe(button(host, "Adicionar coluna"));
  });
  it("hides editing controls in read mode and rejects a stale removal without losing content", () => {
    const read = setup(false);
    expect(read.host.querySelector("button")).toBeNull();
    expect(read.host.textContent).toContain("Child content");
    const { page, host } = setup();
    flushSync(() => button(host, "Remover coluna 3").click());
    flushSync(() => page.removeBlock("a"));
    flushSync(() => button(host, "Remover coluna").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível");
    expect(page.getBlock("kept")?.parentId).toBe("c");
    expect(columnLayout(page, "group").columns).toHaveLength(2);
  });
});
