import * as Y from "yjs";
import { between, rebalancePositions } from "./block-order";
import type { BlockAttributes, BlockType } from "./block-schema";
import { validateContentDocument } from "./content-schema";
import { type BlockInput, StablePage } from "./stable-page";

export type TableGrid = {
  columns: { id: string; position: string }[];
  rows: { id: string; cells: BlockInput[][] }[];
};
type Operation =
  | { kind: "create"; block: BlockInput; attributes: BlockAttributes }
  | { kind: "move"; block: BlockInput }
  | { kind: "attributes"; id: string; attributes: BlockAttributes }
  | { kind: "remove"; id: string };
type Plan = { page: StablePage; operations: Operation[] };
const compare = (first: { position: string; id: string }, second: { position: string; id: string }) =>
  first.position < second.position
    ? -1
    : first.position > second.position
      ? 1
      : first.id < second.id
        ? -1
        : first.id > second.id
          ? 1
          : 0;

function physicalChildren(page: StablePage, parentId: string): BlockInput[] {
  const result: BlockInput[] = [];
  for (const id of page.document.getMap("blocks").keys()) {
    const block = page.getBlock(id);
    if (block?.parentId === parentId) result.push(block);
  }
  return result.sort(compare);
}
function requireTable(page: StablePage, id: string): BlockInput {
  page.validate();
  const table = page.getBlock(id);
  if (table?.type !== "table" || !page.visibleChildren(table.parentId).some((block) => block.id === id))
    throw new Error("Table is unavailable");
  return table;
}
function columnKeys(page: StablePage, tableId: string): Map<string, string> {
  const rows = physicalChildren(page, tableId);
  const first = rows[0];
  const origins = first ? physicalChildren(page, first.id) : [];
  const result = new Map<string, string>();
  for (const row of rows) {
    for (const [index, cell] of physicalChildren(page, row.id).entries()) {
      const stored = page.getBlockAttributes(cell.id).columnId;
      const key = typeof stored === "string" ? stored : (origins[index]?.id ?? cell.id);
      const origin = page.getBlock(key);
      const originRow = origin?.parentId ? page.getBlock(origin.parentId) : undefined;
      if (origin?.type !== "tableCell" || originRow?.type !== "tableRow" || originRow.parentId !== tableId)
        throw new Error("Column origin is unavailable in this table");
      result.set(cell.id, key);
    }
  }
  return result;
}

/** A logical cell may contain multiple concurrently created physical paragraphs. */
export function tableGrid(page: StablePage, tableId: string): TableGrid {
  requireTable(page, tableId);
  const keys = columnKeys(page, tableId);
  const rows = page.visibleChildren(tableId);
  const columns = new Map<string, { id: string; position: string }>();
  const indexed = rows.map((row) => {
    const buckets = new Map<string, BlockInput[]>();
    for (const cell of page.visibleChildren(row.id)) {
      const key = keys.get(cell.id);
      if (!key) throw new Error("Missing table column key");
      const origin = page.getBlock(key);
      if (!origin) throw new Error("Missing table column origin");
      columns.set(key, { id: key, position: origin.position });
      const bucket = buckets.get(key) ?? [];
      bucket.push(cell);
      buckets.set(key, bucket);
    }
    return { id: row.id, buckets };
  });
  const ordered = [...columns.values()].sort(compare);
  return {
    columns: ordered,
    rows: indexed.map((row) => ({
      id: row.id,
      cells: ordered.map((column) => (row.buckets.get(column.id) ?? []).sort(compare)),
    })),
  };
}

function apply(page: StablePage, operation: Operation): void {
  if (operation.kind === "create") {
    page.createBlock(operation.block);
    if (Object.keys(operation.attributes).length)
      page.setBlockAttributes(operation.block.id, operation.attributes);
  } else if (operation.kind === "move")
    page.moveBlock(operation.block.id, operation.block.parentId, operation.block.position);
  else if (operation.kind === "attributes") page.setBlockAttributes(operation.id, operation.attributes);
  else page.removeBlock(operation.id);
}
function append(plan: Plan, operation: Operation): void {
  apply(plan.page, operation);
  plan.operations.push(operation);
}
function execute<T>(page: StablePage, action: (plan: Plan) => T): T {
  validateContentDocument(page.document);
  const document = new Y.Doc();
  Y.applyUpdate(document, Y.encodeStateAsUpdate(page.document));
  const copy = new StablePage(document, "table-command-preflight");
  const plan: Plan = { page: copy, operations: [] };
  let result: T;
  try {
    let output: { value: T } | undefined;
    copy.runAction(() => {
      output = { value: action(plan) };
    });
    validateContentDocument(document);
    if (!output) throw new Error("Missing table plan");
    result = output.value;
  } finally {
    copy.destroy();
    document.destroy();
  }
  page.runAction(() => {
    for (const operation of plan.operations) apply(page, operation);
  });
  return result;
}
function create(
  plan: Plan,
  type: BlockType,
  parentId: string | null,
  position: string,
  attributes: BlockAttributes = {},
): string {
  const id = crypto.randomUUID();
  append(plan, { kind: "create", block: { id, type, parentId, position }, attributes });
  return id;
}
function capacity(page: StablePage, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || page.document.getMap("blocks").size + count > 10000)
    throw new Error("Block limit exceeded");
}
function positionAfter(
  siblings: { id: string; position: string }[],
  afterId: string | undefined,
  relocate: (id: string, position: string) => void,
): string {
  const index =
    afterId === undefined ? siblings.length : siblings.findIndex((entry) => entry.id === afterId) + 1;
  if (afterId !== undefined && index === 0) throw new Error("Table coordinate is unavailable");
  const next = between(siblings[index - 1]?.position ?? null, siblings[index]?.position ?? null);
  if (next) return next;
  const positions = rebalancePositions(siblings.length + 1);
  let ordinal = 0;
  for (let at = 0; at < positions.length; at++) {
    if (at === index) continue;
    const sibling = siblings[ordinal++];
    const position = positions[at];
    if (!sibling || !position) throw new Error("Invalid table position plan");
    relocate(sibling.id, position);
  }
  const position = positions[index];
  if (!position) throw new Error("Missing table insertion position");
  return position;
}
function move(plan: Plan, id: string, position: string): void {
  const block = plan.page.getBlock(id);
  if (!block) throw new Error("Missing table coordinate");
  append(plan, { kind: "move", block: { ...block, position } });
}
function normalizeLegacy(plan: Plan, tableId: string): void {
  const keys = columnKeys(plan.page, tableId);
  for (const [id, columnId] of keys)
    if (plan.page.getBlockAttributes(id).columnId === undefined)
      append(plan, { kind: "attributes", id, attributes: { columnId } });
}

export function createTable(
  page: StablePage,
  input: { parentId: string | null; beforeId?: string | null; rows?: number; columns?: number },
): string {
  const rows = input.rows ?? 2;
  const columns = input.columns ?? 2;
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1)
    throw new Error("Table dimensions must be positive integers");
  capacity(page, 1 + rows + rows * columns);
  return execute(page, (plan) => {
    const siblings = plan.page.visibleChildren(input.parentId);
    const before = input.beforeId ?? null;
    const index = before === null ? siblings.length : siblings.findIndex((entry) => entry.id === before);
    if (index < 0) throw new Error("Table destination is unavailable");
    // positionAfter appends when there is no predecessor; an explicit first insertion uses its direct interval.
    let position = between(siblings[index - 1]?.position ?? null, siblings[index]?.position ?? null);
    if (!position) {
      const positions = rebalancePositions(siblings.length + 1);
      let ordinal = 0;
      for (let at = 0; at < positions.length; at++) {
        if (at === index) continue;
        const sibling = siblings[ordinal++];
        const key = positions[at];
        if (sibling && key) move(plan, sibling.id, key);
      }
      position = positions[index] ?? null;
    }
    if (!position) throw new Error("Missing table placement");
    const table = create(plan, "table", input.parentId, position, { header: false });
    const rowPositions = rebalancePositions(rows);
    const columnPositions = rebalancePositions(columns);
    const origins: string[] = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      const row = create(plan, "tableRow", table, rowPositions[rowIndex] ?? "U");
      for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
        const cell = create(plan, "tableCell", row, columnPositions[columnIndex] ?? "U");
        if (rowIndex === 0) origins.push(cell);
        const columnId = origins[columnIndex];
        if (!columnId) throw new Error("Missing column identity");
        append(plan, { kind: "attributes", id: cell, attributes: { columnId } });
      }
    }
    return table;
  });
}

export function insertTableRow(page: StablePage, tableId: string, afterRowId?: string): string {
  const grid = tableGrid(page, tableId);
  capacity(page, 1 + grid.columns.length);
  return execute(page, (plan) => {
    normalizeLegacy(plan, tableId);
    const siblings = plan.page.visibleChildren(tableId);
    const position = positionAfter(siblings, afterRowId, (id, key) => move(plan, id, key));
    const row = create(plan, "tableRow", tableId, position);
    for (const column of grid.columns)
      create(plan, "tableCell", row, column.position, { columnId: column.id });
    return row;
  });
}

export function insertTableColumn(page: StablePage, tableId: string, afterColumnId?: string): string {
  const grid = tableGrid(page, tableId);
  if (!grid.rows.length) throw new Error("A table needs a visible row");
  capacity(page, grid.rows.length);
  return execute(page, (plan) => {
    normalizeLegacy(plan, tableId);
    const position = positionAfter(grid.columns, afterColumnId, (id, key) => move(plan, id, key));
    let origin: string | undefined;
    for (const row of grid.rows) {
      const cell = create(plan, "tableCell", row.id, position, origin ? { columnId: origin } : {});
      if (!origin) {
        origin = cell;
        append(plan, { kind: "attributes", id: cell, attributes: { columnId: cell } });
      }
    }
    if (!origin) throw new Error("Missing table column origin");
    return origin;
  });
}

export function ensureTableCell(page: StablePage, tableId: string, rowId: string, columnId: string): string {
  const grid = tableGrid(page, tableId);
  const row = grid.rows.find((entry) => entry.id === rowId);
  const index = grid.columns.findIndex((entry) => entry.id === columnId);
  if (!row || index < 0) throw new Error("Table coordinate is unavailable");
  const existing = row.cells[index]?.[0];
  if (existing) return existing.id;
  capacity(page, 1);
  const column = grid.columns[index];
  if (!column) throw new Error("Unknown table column");
  return execute(page, (plan) => {
    normalizeLegacy(plan, tableId);
    return create(plan, "tableCell", rowId, column.position, { columnId });
  });
}

export function removeTableRow(page: StablePage, tableId: string, rowId: string): void {
  const grid = tableGrid(page, tableId);
  if (!grid.rows.some((row) => row.id === rowId)) throw new Error("Table row is unavailable");
  execute(page, (plan) => {
    normalizeLegacy(plan, tableId);
    append(plan, { kind: "remove", id: grid.rows.length === 1 ? tableId : rowId });
  });
}

export function removeTableColumn(page: StablePage, tableId: string, columnId: string): void {
  const grid = tableGrid(page, tableId);
  if (!grid.columns.some((column) => column.id === columnId)) throw new Error("Table column is unavailable");
  execute(page, (plan) => {
    normalizeLegacy(plan, tableId);
    if (grid.columns.length === 1) {
      append(plan, { kind: "remove", id: tableId });
      return;
    }
    for (const [id, key] of columnKeys(plan.page, tableId))
      if (key === columnId) append(plan, { kind: "remove", id });
  });
}
