import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { createTable, removeTableRow, tableGrid } from "../../src/features/editor/model/table-grid";
import { TableBlock } from "../../src/features/editor/ui/table-block";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup() {
  const document = new Y.Doc();
  initializeContentDocument(document);
  const page = new StablePage(document, "table-ui");
  const table = createTable(page, { parentId: null });
  const host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  const root = createRoot(host);
  const focused: { id: string; position?: number }[] = [];
  flushSync(() =>
    root.render(
      createElement(TableBlock, {
        page,
        tableId: table,
        editable: true,
        renderCell: (id) =>
          createElement(
            "div",
            { tabIndex: 0, role: "textbox", "aria-label": "Texto da célula", "data-test-cell": id },
            id,
          ),
        onFocusCell: (id, position) => focused.push(position === undefined ? { id } : { id, position }),
      }),
    ),
  );
  cleanups.push(() => {
    flushSync(() => root.unmount());
    page.destroy();
    document.destroy();
    host.remove();
  });
  const key = (id: string, shiftKey = false) => {
    const target = host.querySelector(`[data-test-cell="${id}"]`);
    if (!target) throw new Error("Missing cell surface");
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    flushSync(() => target.dispatchEvent(event));
    return event;
  };
  return { document, page, table, host, focused, key };
}
function action(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  if (!button) throw new Error(`Missing action ${label}`);
  return button;
}
class CellCopyEvent extends Event {
  readonly values = new Map<string, string>();
  readonly clipboardData = {
    setData: (type: string, value: string) => {
      this.values.set(type, value);
    },
  };
}
function fill(page: StablePage, id: string, value: string) {
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  page.fragment(id).insert(0, [paragraph]);
  text.insert(0, value);
  text.format(0, value.length, { bold: {} });
  return { paragraph, text };
}

describe("table block interaction", () => {
  it("selects a rectangular interval with shift-click, copies canonical TSV and clears selection with Escape", () => {
    const view = setup();
    const grid = tableGrid(view.page, view.table);
    const values = [
      ["A\tB", 'A"quote'],
      ["Second\nline", "Last"],
    ];
    for (const [rowIndex, row] of grid.rows.entries())
      for (const [columnIndex, bucket] of row.cells.entries()) {
        const id = bucket[0]?.id;
        const value = values[rowIndex]?.[columnIndex];
        if (!id || value === undefined) throw new Error("Missing fixture");
        fill(view.page, id, value);
      }
    const slots = [...view.host.querySelectorAll<HTMLElement>("[data-table-slot]")];
    const first = slots[0];
    const last = slots[3];
    if (!first || !last) throw new Error("Missing cell slots");
    const before = Y.encodeStateAsUpdate(view.document);
    flushSync(() => first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    flushSync(() =>
      last.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, shiftKey: true })),
    );
    expect(view.host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(4);
    expect(view.host.querySelectorAll('[data-table-selected="true"]')).toHaveLength(4);
    expect(view.host.querySelector("[data-table-cell-selection]")).not.toBeNull();
    const copy = new CellCopyEvent("copy", { bubbles: true, cancelable: true });
    last.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect([...copy.values.keys()]).toEqual(["text/plain"]);
    expect(copy.values.get("text/plain")).toBe('"A\tB"\t"A""quote"\n"Second\nline"\tLast');
    flushSync(() =>
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    );
    expect(view.host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    expect(view.host.querySelector("[data-table-cell-selection]")).toBeNull();
    expect(Y.encodeStateAsUpdate(view.document)).toEqual(before);
  });
  it("extends cell mode with Shift+Arrow while leaving ordinary text selection alone", () => {
    const view = setup();
    const first = view.host.querySelector<HTMLElement>("[data-test-cell]");
    if (!first) throw new Error("Missing text surface");
    const ordinary = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(ordinary);
    expect(ordinary.defaultPrevented).toBe(false);
    flushSync(() => action(view.host, "Selecionar célula, linha 1, coluna 1").click());
    const active = globalThis.document.activeElement;
    if (!(active instanceof HTMLElement)) throw new Error("Missing gridcell focus");
    flushSync(() =>
      active.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }),
      ),
    );
    const moved = globalThis.document.activeElement;
    if (!(moved instanceof HTMLElement)) throw new Error("Missing moved focus");
    flushSync(() =>
      moved.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(view.host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(4);
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain("4 células");
  });
  it("clears selected canonical text in one undo group while retaining cell and XML identities", () => {
    const view = setup();
    const grid = tableGrid(view.page, view.table);
    const cells = grid.rows.flatMap((row) => row.cells.flat());
    const wrappers = cells.map((cell, index) => fill(view.page, cell.id, `Text ${index}`));
    view.page.undoManager.clear();
    flushSync(() => action(view.host, "Selecionar célula, linha 1, coluna 1").click());
    const last = view.host.querySelectorAll<HTMLElement>("[data-table-slot]")[3];
    if (!last) throw new Error("Missing last slot");
    flushSync(() =>
      last.dispatchEvent(new MouseEvent("mousedown", { shiftKey: true, bubbles: true, cancelable: true })),
    );
    flushSync(() =>
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })),
    );
    expect(validateContentDocument(view.document).text).toBe("");
    expect(
      tableGrid(view.page, view.table)
        .rows.flatMap((row) => row.cells.flat())
        .map((cell) => cell.id),
    ).toEqual(cells.map((cell) => cell.id));
    for (const [index, cell] of cells.entries())
      expect(view.page.fragment(cell.id).get(0)).toBe(wrappers[index]?.paragraph);
    expect(view.page.undoManager.undoStack).toHaveLength(1);
    view.page.undo();
    expect(validateContentDocument(view.document).text).toBe("Text 0\nText 1\nText 2\nText 3");
  });
  it("navigates logical cells with Tab and Shift+Tab and creates a row from the final cell", () => {
    const view = setup();
    const grid = tableGrid(view.page, view.table);
    const first = grid.rows[0]?.cells[0]?.[0]?.id;
    const next = grid.rows[0]?.cells[1]?.[0]?.id;
    const last = grid.rows[1]?.cells[1]?.[0]?.id;
    if (!first || !next || !last) throw new Error("Missing table coordinates");
    expect(view.key(first, true).defaultPrevented).toBe(false);
    expect(view.key(first).defaultPrevented).toBe(true);
    expect(view.focused.at(-1)?.id).toBe(next);
    view.key(next, true);
    expect(view.focused.at(-1)?.id).toBe(first);
    expect(view.key(last).defaultPrevented).toBe(true);
    const expanded = tableGrid(view.page, view.table);
    expect(expanded.rows).toHaveLength(3);
    expect(view.focused.at(-1)?.id).toBe(expanded.rows[2]?.cells[0]?.[0]?.id);
  });
  it("toggles real header semantics and confirms removal with focus on cancellation", () => {
    const view = setup();
    const checkbox = view.host.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error("Missing header checkbox");
    flushSync(() => checkbox.click());
    expect(view.host.querySelectorAll("th")).toHaveLength(2);
    const trigger = action(view.host, "Remover linha 1");
    trigger.focus();
    flushSync(() => trigger.click());
    const dialog = view.host.querySelector("dialog");
    expect(dialog?.open).toBe(true);
    expect(globalThis.document.activeElement?.textContent).toBe("Cancelar");
    flushSync(() => action(view.host, "Cancelar").click());
    expect(globalThis.document.activeElement).toBe(trigger);
    expect(tableGrid(view.page, view.table).rows).toHaveLength(2);
    flushSync(() => trigger.click());
    const confirmation = view.host.querySelector("dialog");
    if (!confirmation) throw new Error("Missing confirmation");
    flushSync(() => action(confirmation, "Remover linha").click());
    expect(tableGrid(view.page, view.table).rows).toHaveLength(1);
    const last = action(view.host, "Remover linha 1");
    flushSync(() => last.click());
    expect(view.host.querySelector("dialog")?.textContent).toContain("tabela inteira");
  });
  it("renders every physical paragraph belonging to the same logical cell", () => {
    const view = setup();
    const grid = tableGrid(view.page, view.table);
    const row = grid.rows[0]?.id;
    const column = grid.columns[0]?.id;
    if (!row || !column) throw new Error("Missing coordinates");
    flushSync(() =>
      view.page.runAction(() => {
        view.page.createBlock({ id: "concurrent-cell", type: "tableCell", parentId: row, position: "z" });
        view.page.setBlockAttributes("concurrent-cell", { columnId: column });
      }),
    );
    const cell = view.host.querySelector(`[data-table-row="${row}"][data-table-column="${column}"]`);
    expect(cell?.querySelectorAll("[data-test-cell]")).toHaveLength(2);
    expect(cell?.textContent).toContain("concurrent-cell");
  });
  it("asks again before deleting the whole table if its last-row status changes while confirming", () => {
    const view = setup();
    const rows = tableGrid(view.page, view.table).rows;
    const other = rows[1]?.id;
    if (!other) throw new Error("Missing second row");
    flushSync(() => action(view.host, "Remover linha 1").click());
    flushSync(() => removeTableRow(view.page, view.table, other));
    let dialog = view.host.querySelector("dialog");
    if (!dialog) throw new Error("Missing confirmation");
    const initialDialog = dialog;
    flushSync(() => action(initialDialog, "Remover linha").click());
    expect(view.page.visibleChildren().some((block) => block.id === view.table)).toBe(true);
    dialog = view.host.querySelector("dialog");
    if (!dialog) throw new Error("Missing updated confirmation");
    const currentDialog = dialog;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("tabela inteira");
    flushSync(() => action(currentDialog, "Remover tabela").click());
    expect(view.page.visibleChildren()).toEqual([]);
  });
});
