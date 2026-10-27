import * as Y from "yjs";
import { between, rebalancePositions } from "./block-order";
import { MAX_CONTENT_BYTES, validateContentDocument } from "./content-schema";
import { MAX_UPDATE_BYTES } from "./content-limits";
import { type BlockInput, StablePage } from "./stable-page";

export type ColumnLayout = { columns: BlockInput[]; weights: number[] };
type Operation =
  | { kind: "create"; block: BlockInput }
  | { kind: "move"; block: BlockInput }
  | { kind: "weights"; id: string; weights: number[] }
  | { kind: "remove"; id: string };
type Plan = { page: StablePage; operations: Operation[] };

function compare(first: BlockInput, second: BlockInput): number {
  return first.position < second.position
    ? -1
    : first.position > second.position
      ? 1
      : first.id < second.id
        ? -1
        : first.id > second.id
          ? 1
          : 0;
}
function physicalChildren(page: StablePage, parentId: string): BlockInput[] {
  const result: BlockInput[] = [];
  for (const id of page.document.getMap("blocks").keys()) {
    const block = page.getBlock(id);
    if (block?.parentId === parentId) result.push(block);
  }
  return result.sort(compare);
}

/** Widths describe the visible reading order; stale composition uses equal tracks. */
export function columnLayout(page: StablePage, groupId: string): ColumnLayout {
  page.validate();
  const group = page.getBlock(groupId);
  if (group?.type !== "columns" || !page.visibleChildren(group.parentId).some((item) => item.id === groupId))
    throw new Error("Column group is unavailable");
  const columns = page.visibleChildren(groupId);
  const widths = page.getBlockAttributes(groupId).widths;
  return {
    columns,
    weights:
      Array.isArray(widths) && widths.length === columns.length
        ? ([...widths] as number[])
        : columns.map(() => 1),
  };
}
function apply(page: StablePage, operation: Operation): void {
  if (operation.kind === "create") page.createBlock(operation.block);
  else if (operation.kind === "move")
    page.moveBlock(operation.block.id, operation.block.parentId, operation.block.position);
  else if (operation.kind === "weights") page.setBlockAttributes(operation.id, { widths: operation.weights });
  else page.removeBlock(operation.id);
}
function append(plan: Plan, operation: Operation): void {
  apply(plan.page, operation);
  plan.operations.push(operation);
}
function execute<T>(page: StablePage, action: (plan: Plan) => T): T {
  validateContentDocument(page.document);
  const before = Y.encodeStateVector(page.document);
  const document = new Y.Doc();
  let copy: StablePage | undefined;
  const operations: Operation[] = [];
  let result: T;
  try {
    Y.applyUpdate(document, Y.encodeStateAsUpdate(page.document));
    copy = new StablePage(document, "column-command-preflight");
    const target = copy;
    let output: { value: T } | undefined;
    target.runAction(() => {
      output = { value: action({ page: target, operations }) };
    });
    validateContentDocument(document);
    if (Y.encodeStateAsUpdate(document).byteLength > MAX_CONTENT_BYTES)
      throw new Error("Content size limit exceeded");
    if (Y.encodeStateAsUpdate(document, before).byteLength > MAX_UPDATE_BYTES)
      throw new Error("Column action size limit exceeded");
    if (!output) throw new Error("Missing column plan");
    result = output.value;
  } finally {
    copy?.destroy();
    document.destroy();
  }
  page.runAction(() => {
    for (const operation of operations) apply(page, operation);
  });
  return result;
}
function move(plan: Plan, block: BlockInput, parentId: string, position: string): void {
  append(plan, { kind: "move", block: { ...block, parentId, position } });
}
function weights(plan: Plan, groupId: string, value: number[]): void {
  // Concurrent additions can exceed the control's maximum. Keep the valid stored
  // attribute until the group returns within bounds; the renderer shows every track.
  if (value.length >= 2 && value.length <= 12) append(plan, { kind: "weights", id: groupId, weights: value });
}

export function addColumn(page: StablePage, groupId: string): string {
  return execute(page, (plan) => {
    const layout = columnLayout(plan.page, groupId);
    if (layout.columns.length >= 12) throw new Error("Column limit exceeded");
    const id = crypto.randomUUID();
    let position = between(layout.columns.at(-1)?.position ?? null, null);
    if (!position) {
      const positions = rebalancePositions(layout.columns.length + 1);
      for (const [index, column] of layout.columns.entries()) {
        const next = positions[index];
        if (!next) throw new Error("Missing column position");
        move(plan, column, groupId, next);
      }
      position = positions.at(-1) ?? null;
    }
    if (!position) throw new Error("Missing column insertion position");
    append(plan, { kind: "create", block: { id, type: "column", parentId: groupId, position } });
    weights(plan, groupId, [...layout.weights, 1]);
    return id;
  });
}

export function setColumnWeight(page: StablePage, groupId: string, columnId: string, weight: number): void {
  if (!Number.isFinite(weight) || weight < 0.01 || weight > 100) throw new Error("Invalid column weight");
  execute(page, (plan) => {
    const layout = columnLayout(plan.page, groupId);
    const index = layout.columns.findIndex((column) => column.id === columnId);
    if (index < 0 || layout.columns.length < 2 || layout.columns.length > 12)
      throw new Error("Column is unavailable");
    const next = [...layout.weights];
    next[index] = weight;
    weights(plan, groupId, next);
  });
}

/** Moves direct descendants intact, including tombstones, then hides the column. */
export function removeColumn(page: StablePage, groupId: string, columnId: string): string {
  return execute(page, (plan) => {
    const layout = columnLayout(plan.page, groupId);
    const index = layout.columns.findIndex((column) => column.id === columnId);
    if (index < 0 || layout.columns.length <= 2) throw new Error("Keep at least two columns");
    const destination = layout.columns[index - 1] ?? layout.columns[index + 1];
    if (!destination) throw new Error("Missing adjacent column");
    const existing = physicalChildren(plan.page, destination.id);
    const children = physicalChildren(plan.page, columnId);
    let lower = existing.at(-1)?.position ?? null;
    const positions: string[] = [];
    for (let ordinal = 0; ordinal < children.length; ordinal++) {
      const position = between(lower, null);
      if (!position) break;
      positions.push(position);
      lower = position;
    }
    if (positions.length !== children.length) {
      const next = rebalancePositions(existing.length + children.length);
      for (const [ordinal, child] of [...existing, ...children].entries()) {
        const position = next[ordinal];
        if (!position) throw new Error("Missing child position");
        move(plan, child, destination.id, position);
      }
    } else {
      for (const [ordinal, child] of children.entries()) {
        const position = positions[ordinal];
        if (!position) throw new Error("Missing child position");
        move(plan, child, destination.id, position);
      }
    }
    append(plan, { kind: "remove", id: columnId });
    weights(
      plan,
      groupId,
      layout.weights.filter((_, ordinal) => ordinal !== index),
    );
    return destination.id;
  });
}
