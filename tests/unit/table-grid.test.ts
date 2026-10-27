import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initializeContentDocument,
  validateContentDocument,
} from "../../src/features/editor/model/content-schema";
import { pageCollaboration } from "../../src/features/editor/model/page-collaboration";
import { StablePage } from "../../src/features/editor/model/stable-page";
import {
  createTable,
  ensureTableCell,
  insertTableColumn,
  insertTableRow,
  removeTableColumn,
  removeTableRow,
  tableGrid,
} from "../../src/features/editor/model/table-grid";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function peer(update?: Uint8Array) {
  const document = new Y.Doc();
  if (update) Y.applyUpdate(document, update);
  else initializeContentDocument(document);
  const page = new StablePage(document, "table-author");
  const editors: Editor[] = [];
  cleanups.push(() => {
    for (const editor of editors) editor.destroy();
    page.destroy();
    document.destroy();
  });
  const edit = (id: string, text: string) => {
    const editor = new Editor({
      element: globalThis.document.createElement("div"),
      injectCSS: false,
      extensions: [...createTextExtensions(), pageCollaboration(page, id)],
    });
    editors.push(editor);
    editor.commands.insertContentAt(1, text);
    return editor;
  };
  return { document, page, edit };
}
function exchange(first: ReturnType<typeof peer>, second: ReturnType<typeof peer>) {
  const a = Y.encodeStateAsUpdate(first.document);
  const b = Y.encodeStateAsUpdate(second.document);
  Y.applyUpdate(first.document, b, "remote");
  Y.applyUpdate(second.document, a, "remote");
}
function cellId(page: StablePage, table: string, row: number, column: number): string {
  const cell = tableGrid(page, table).rows[row]?.cells[column]?.[0];
  if (!cell) throw new Error("Missing cell");
  return cell.id;
}

describe("simple table coordinates", () => {
  it("creates stable column keys, validates and round-trips without rewriting cell fragments", () => {
    const source = peer();
    const table = createTable(source.page, { parentId: null });
    const grid = tableGrid(source.page, table);
    expect(grid.columns).toHaveLength(2);
    expect(grid.rows).toHaveLength(2);
    for (const row of grid.rows)
      for (const [index, bucket] of row.cells.entries())
        for (const cell of bucket) {
          expect(source.page.getBlockAttributes(cell?.id ?? "").columnId).toBe(grid.columns[index]?.id);
        }
    const id = cellId(source.page, table, 0, 0);
    source.edit(id, "kept");
    const fragment = source.page.fragment(id);
    insertTableColumn(source.page, table, grid.columns[0]?.id);
    expect(source.page.fragment(id)).toBe(fragment);
    const reload = peer(Y.encodeStateAsUpdate(source.document));
    expect(tableGrid(reload.page, table)).toEqual(tableGrid(source.page, table));
    expect(validateContentDocument(reload.document).text).toBe("kept");
  });
  it("converges concurrent row and column insertion with a logical empty hole and unchanged text coordinates", () => {
    const left = peer();
    const table = createTable(left.page, { parentId: null });
    const baseline = tableGrid(left.page, table);
    const existing = cellId(left.page, table, 1, 1);
    left.edit(existing, "existing");
    const right = peer(Y.encodeStateAsUpdate(left.document));
    const row = insertTableRow(left.page, table, baseline.rows[0]?.id);
    const column = insertTableColumn(right.page, table, baseline.columns[0]?.id);
    exchange(left, right);
    const grid = tableGrid(left.page, table);
    expect(grid).toEqual(tableGrid(right.page, table));
    expect(grid.rows).toHaveLength(3);
    expect(grid.columns).toHaveLength(3);
    const columnIndex = grid.columns.findIndex((entry) => entry.id === column);
    expect(grid.rows.find((entry) => entry.id === row)?.cells[columnIndex]).toEqual([]);
    expect(
      grid.rows
        .find((entry) => entry.id === baseline.rows[1]?.id)
        ?.cells.flat()
        .find((cell) => cell?.id === existing)?.id,
    ).toBe(existing);
    const created = ensureTableCell(left.page, table, row, column);
    left.edit(created, "new");
    exchange(left, right);
    expect(tableGrid(left.page, table)).toEqual(tableGrid(right.page, table));
    expect(validateContentDocument(left.document).text).toContain("existing");
    expect(validateContentDocument(left.document).text).toContain("new");
  });
  it("keeps both concurrently filled paragraphs in the same logical cell", () => {
    const left = peer();
    const table = createTable(left.page, { parentId: null });
    const right = peer(Y.encodeStateAsUpdate(left.document));
    const row = insertTableRow(left.page, table);
    const column = insertTableColumn(right.page, table);
    exchange(left, right);
    const a = ensureTableCell(left.page, table, row, column);
    const b = ensureTableCell(right.page, table, row, column);
    expect(a).not.toBe(b);
    left.edit(a, "LEFT");
    right.edit(b, "RIGHT");
    exchange(left, right);
    const grid = tableGrid(left.page, table);
    const index = grid.columns.findIndex((entry) => entry.id === column);
    const bucket = grid.rows.find((entry) => entry.id === row)?.cells[index];
    expect(bucket?.map((cell) => cell.id).sort()).toEqual([a, b].sort());
    expect(ensureTableCell(left.page, table, row, column)).toBe(bucket?.[0]?.id);
    expect(tableGrid(right.page, table)).toEqual(grid);
    const projection = validateContentDocument(left.document);
    expect(projection.text).toContain("LEFT");
    expect(projection.text).toContain("RIGHT");
  });
  it("keeps origin column metadata and ordering after removing its first row", () => {
    const source = peer();
    const table = createTable(source.page, { parentId: null });
    const grid = tableGrid(source.page, table);
    removeTableRow(source.page, table, grid.rows[0]?.id ?? "");
    expect(tableGrid(source.page, table).columns).toEqual(grid.columns);
    expect(tableGrid(source.page, table).rows).toHaveLength(1);
    expect(source.page.getBlock(grid.columns[0]?.id ?? "")).toBeDefined();
    validateContentDocument(source.document);
  });
  it("tombstones explicit nonempty removals, restores their IDs with undo, and removes the table for its last column", () => {
    const source = peer();
    const table = createTable(source.page, { parentId: null, rows: 1, columns: 2 });
    const grid = tableGrid(source.page, table);
    const id = cellId(source.page, table, 0, 0);
    source.edit(id, "restore");
    source.page.undoManager.clear();
    removeTableColumn(source.page, table, grid.columns[0]?.id ?? "");
    expect(tableGrid(source.page, table).columns).toHaveLength(1);
    expect(source.page.undoManager.undoStack).toHaveLength(1);
    source.page.undo();
    expect(tableGrid(source.page, table).rows[0]?.cells[0]?.[0]?.id).toBe(id);
    expect(validateContentDocument(source.document).text).toBe("restore");
    source.page.redo();
    removeTableColumn(source.page, table, grid.columns[1]?.id ?? "");
    expect(source.page.visibleChildren()).toEqual([]);
    expect(validateContentDocument(source.document).text).toBe("");
  });
  it("does not revive a removed column when an older tombstoned row is restored", () => {
    const source = peer();
    const table = createTable(source.page, { parentId: null });
    const grid = tableGrid(source.page, table);
    const row = grid.rows[0]?.id;
    const column = grid.columns[0]?.id;
    if (!row || !column) throw new Error("Missing coordinates");
    removeTableRow(source.page, table, row);
    removeTableColumn(source.page, table, column);
    source.page.restoreBlock(row);
    expect(tableGrid(source.page, table).columns.map((entry) => entry.id)).toEqual([grid.columns[1]?.id]);
    expect(tableGrid(source.page, table).rows.every((entry) => entry.cells.length === 1)).toBe(true);
  });
  it("keeps a new column's origin when another replica fills a different row and creator undoes insertion", () => {
    const creator = peer();
    const table = createTable(creator.page, { parentId: null });
    creator.page.undoManager.clear();
    const column = insertTableColumn(creator.page, table);
    const remote = peer(Y.encodeStateAsUpdate(creator.document));
    const grid = tableGrid(remote.page, table);
    const index = grid.columns.findIndex((entry) => entry.id === column);
    const id = grid.rows[1]?.cells[index]?.[0]?.id;
    if (!id) throw new Error("Missing remotely edited cell");
    remote.edit(id, "REMOTE");
    exchange(creator, remote);
    creator.page.undo();
    expect(validateContentDocument(creator.document).text).toBe("REMOTE");
    expect(tableGrid(creator.page, table).columns.some((entry) => entry.id === column)).toBe(true);
    const reload = peer(Y.encodeStateAsUpdate(creator.document));
    expect(tableGrid(reload.page, table)).toEqual(tableGrid(creator.page, table));
    creator.page.redo();
    expect(validateContentDocument(creator.document).text).toBe("REMOTE");
  });
  it("rejects invalid dimensions and cross-table coordinates without partial mutations", () => {
    const source = peer();
    const table = createTable(source.page, { parentId: null });
    const other = createTable(source.page, { parentId: null });
    const grid = tableGrid(source.page, table);
    const foreign = tableGrid(source.page, other);
    const before = Y.encodeStateAsUpdate(source.document);
    expect(() => createTable(source.page, { parentId: null, rows: 0 })).toThrow();
    expect(() => createTable(source.page, { parentId: null, columns: 1.5 })).toThrow();
    expect(() => createTable(source.page, { parentId: null, rows: 10000, columns: 10000 })).toThrow();
    expect(() => insertTableRow(source.page, table, foreign.rows[0]?.id)).toThrow();
    expect(() => insertTableColumn(source.page, table, "unknown")).toThrow();
    expect(() =>
      ensureTableCell(source.page, table, foreign.rows[0]?.id ?? "", grid.columns[0]?.id ?? ""),
    ).toThrow();
    expect(() => removeTableColumn(source.page, table, foreign.columns[0]?.id ?? "")).toThrow();
    expect(Y.encodeStateAsUpdate(source.document)).toEqual(before);
  });
});
