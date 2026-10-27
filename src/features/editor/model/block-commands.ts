import * as Y from "yjs";
import { between, rebalancePositions } from "./block-order";
import { type BlockType, blockTypeSchema, canContainBlock, validateBlockAttributes } from "./block-schema";
import { MAX_CONTENT_BYTES } from "./content-schema";
import { type BlockInput, StablePage } from "./stable-page";

type Graph = { blocks: Map<string, BlockInput>; removed: ReadonlySet<string> };
type Operation =
  | { kind: "create"; input: BlockInput; attributes: Record<string, unknown> }
  | { kind: "move"; input: BlockInput }
  | { kind: "remove"; id: string }
  | { kind: "transform"; id: string; type: BlockType }
  | { kind: "copy"; id: string; nodes: (Y.XmlElement | Y.XmlText)[] };

function compareBlocks(first: BlockInput, second: BlockInput): number {
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

function readGraph(page: StablePage): Graph {
  page.validate();
  const blocks = new Map<string, BlockInput>();
  for (const id of page.document.getMap("blocks").keys()) {
    const block = page.getBlock(id);
    if (!block) throw new Error("Missing block placement");
    blocks.set(id, block);
  }
  return {
    blocks,
    removed: new Set(
      [...page.document.getMap<boolean>("removed")].filter(([, removed]) => removed).map(([id]) => id),
    ),
  };
}

function preorder(graph: Graph): BlockInput[] {
  const groups = new Map<string | null, BlockInput[]>();
  for (const block of graph.blocks.values()) {
    const siblings = groups.get(block.parentId) ?? [];
    siblings.push(block);
    groups.set(block.parentId, siblings);
  }
  for (const siblings of groups.values()) siblings.sort(compareBlocks);
  const result: BlockInput[] = [];
  const pending = [...(groups.get(null) ?? [])].reverse();
  while (pending.length) {
    const block = pending.pop();
    if (!block || graph.removed.has(block.id)) continue;
    result.push(block);
    const children = groups.get(block.id) ?? [];
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (child) pending.push(child);
    }
  }
  return result;
}

export function orderedBlocks(page: StablePage): BlockInput[] {
  return preorder(readGraph(page));
}

function selection(graph: Graph, ids: string[]): BlockInput[] {
  const visible = preorder(graph);
  const allowed = new Set(visible.map((block) => block.id));
  const selected = new Set(ids);
  for (const id of selected) if (!allowed.has(id)) throw new Error("Selection contains an unavailable block");
  return visible.filter((block) => {
    if (!selected.has(block.id)) return false;
    let parent = block.parentId;
    while (parent !== null) {
      if (selected.has(parent)) return false;
      parent = graph.blocks.get(parent)?.parentId ?? null;
    }
    return true;
  });
}

function children(graph: Graph, parentId: string | null): BlockInput[] {
  return preorder(graph).filter((block) => block.parentId === parentId);
}

function physicalChildren(graph: Graph, parentId: string): BlockInput[] {
  return [...graph.blocks.values()].filter((block) => block.parentId === parentId).sort(compareBlocks);
}

function place(graph: Graph, ids: string[], parentId: string | null, beforeId: string | null): Operation[] {
  const visible = new Set(preorder(graph).map((block) => block.id));
  const parent = parentId === null ? null : graph.blocks.get(parentId);
  if (parentId !== null && (!parent || !visible.has(parentId))) throw new Error("Destination is unavailable");
  const moving = new Set(ids);
  for (const id of ids) {
    const block = graph.blocks.get(id);
    if (!block || !canContainBlock(parent?.type ?? null, block.type))
      throw new Error("Invalid block nesting");
    let ancestor = parentId;
    while (ancestor !== null) {
      if (ancestor === id) throw new Error("Block cycle detected");
      ancestor = graph.blocks.get(ancestor)?.parentId ?? null;
    }
  }
  const current = children(graph, parentId);
  const available = current.filter((block) => !moving.has(block.id));
  const index = beforeId === null ? available.length : available.findIndex((block) => block.id === beforeId);
  if (index < 0 || (beforeId !== null && moving.has(beforeId)))
    throw new Error("Sibling destination is unavailable");
  const finalIds = available.map((block) => block.id);
  finalIds.splice(index, 0, ...ids);
  if (current.length === finalIds.length && current.every((block, ordinal) => block.id === finalIds[ordinal]))
    return [];
  let lower = available[index - 1]?.position ?? null;
  const upper = available[index]?.position ?? null;
  const positions = new Map<string, string>();
  for (const id of ids) {
    const position = between(lower, upper);
    if (position === null) {
      const rebalanced = rebalancePositions(finalIds.length);
      for (const [ordinal, sibling] of finalIds.entries()) {
        const key = rebalanced[ordinal];
        if (!key) throw new Error("Missing rebalanced position");
        positions.set(sibling, key);
      }
      break;
    }
    positions.set(id, position);
    lower = position;
  }
  const operations: Operation[] = [];
  for (const [id, position] of positions) {
    const previous = graph.blocks.get(id);
    if (!previous) throw new Error("Missing block identity");
    const input = { ...previous, parentId, position };
    graph.blocks.set(id, input);
    if (previous.parentId !== parentId || previous.position !== position)
      operations.push({ kind: "move", input });
  }
  return operations;
}

function apply(page: StablePage, operations: Operation[]): void {
  for (const operation of operations) {
    if (operation.kind === "create") {
      page.createBlock(operation.input);
      if (Object.keys(operation.attributes).length)
        page.setBlockAttributes(operation.input.id, operation.attributes);
    } else if (operation.kind === "move") {
      page.moveBlock(operation.input.id, operation.input.parentId, operation.input.position);
    } else if (operation.kind === "remove") {
      page.removeBlock(operation.id);
    } else if (operation.kind === "transform") {
      page.transformBlock(operation.id, operation.type);
    } else {
      page.fragment(operation.id).insert(
        0,
        operation.nodes.map((node) => node.clone()),
      );
    }
  }
}

function execute(page: StablePage, operations: Operation[]): void {
  if (!operations.length) return;
  const previewDocument = new Y.Doc();
  let preview: StablePage | undefined;
  try {
    Y.applyUpdate(previewDocument, Y.encodeStateAsUpdate(page.document));
    preview = new StablePage(previewDocument, "command-preflight");
    const target = preview;
    target.runAction(() => apply(target, operations));
    target.validate();
    if (Y.encodeStateAsUpdate(previewDocument).byteLength > MAX_CONTENT_BYTES)
      throw new Error("Content size limit exceeded");
  } finally {
    preview?.destroy();
    previewDocument.destroy();
  }
  page.runAction(() => apply(page, operations));
}

function identity(graph: Graph): string {
  const id = crypto.randomUUID();
  if (graph.blocks.has(id)) throw new Error("Duplicate block identity");
  return id;
}

export function insertBlock(
  page: StablePage,
  input: {
    type: BlockType;
    parentId: string | null;
    beforeId?: string | null;
    attributes?: Record<string, unknown>;
  },
): string {
  const graph = readGraph(page);
  const type = blockTypeSchema.parse(input.type);
  const attributes = validateBlockAttributes(type, input.attributes ?? {});
  const id = identity(graph);
  graph.blocks.set(id, { id, type, parentId: input.parentId, position: "U" });
  const moves = place(graph, [id], input.parentId, input.beforeId ?? null);
  const created = graph.blocks.get(id);
  if (!created) throw new Error("Missing inserted block");
  execute(page, [
    { kind: "create", input: created, attributes },
    ...moves.filter((operation) => operation.kind !== "move" || operation.input.id !== id),
  ]);
  return id;
}

export function moveBlockSelection(
  page: StablePage,
  ids: string[],
  parentId: string | null,
  beforeId: string | null,
): void {
  const graph = readGraph(page);
  const selected = selection(graph, ids);
  if (!selected.length) return;
  execute(
    page,
    place(
      graph,
      selected.map((block) => block.id),
      parentId,
      beforeId,
    ),
  );
}

export function removeBlockSelection(page: StablePage, ids: string[]): void {
  const graph = readGraph(page);
  execute(
    page,
    selection(graph, ids).map((block) => ({ kind: "remove", id: block.id })),
  );
}

/** Returns copied selection roots; every visible descendant receives its own new identity. */
export function duplicateBlockSelection(page: StablePage, ids: string[]): string[] {
  const graph = readGraph(page);
  const roots = selection(graph, ids);
  const visible = preorder(graph);
  const selectedRoots = new Set(roots.map((block) => block.id));
  const source = visible.filter((block) => {
    let current: string | null = block.id;
    while (current !== null) {
      if (selectedRoots.has(current)) return true;
      current = graph.blocks.get(current)?.parentId ?? null;
    }
    return false;
  });
  const groups = new Map<string | null, { roots: string[]; beforeId: string | null }>();
  for (const root of roots) {
    const siblings = children(graph, root.parentId);
    const next = siblings[siblings.findIndex((block) => block.id === root.id) + 1];
    const group = groups.get(root.parentId) ?? { roots: [], beforeId: null };
    group.roots.push(root.id);
    group.beforeId = next?.id ?? null;
    groups.set(root.parentId, group);
  }
  const copied = new Map<string, string>();
  for (const original of source) {
    const id = identity(graph);
    const parentId = original.parentId === null ? null : (copied.get(original.parentId) ?? original.parentId);
    copied.set(original.id, id);
    graph.blocks.set(id, { ...original, id, parentId });
  }
  const moves: Operation[] = [];
  for (const [parentId, group] of groups) {
    moves.push(
      ...place(
        graph,
        group.roots.map((id) => {
          const clone = copied.get(id);
          if (!clone) throw new Error("Missing copied identity");
          return clone;
        }),
        parentId,
        group.beforeId,
      ),
    );
  }
  const operations: Operation[] = [];
  const copiedIds = new Set(copied.values());
  for (const original of source) {
    const id = copied.get(original.id);
    const input = id ? graph.blocks.get(id) : undefined;
    if (!id || !input) throw new Error("Missing copied block");
    operations.push({
      kind: "create",
      input,
      attributes: structuredClone(page.getBlockAttributes(original.id)),
    });
    const nodes = page
      .fragment(original.id)
      .toArray()
      .map((node) => {
        if (!(node instanceof Y.XmlElement) && !(node instanceof Y.XmlText))
          throw new Error("Unsupported collaborative content node");
        return node;
      });
    operations.push({ kind: "copy", id, nodes });
  }
  operations.push(
    ...moves.filter((operation) => operation.kind !== "move" || !copiedIds.has(operation.input.id)),
  );
  execute(page, operations);
  return roots.map((root) => {
    const id = copied.get(root.id);
    if (!id) throw new Error("Missing copied selection root");
    return id;
  });
}

const structuralTypes = new Set<BlockType>([
  "divider",
  "image",
  "file",
  "table",
  "tableRow",
  "columns",
  "column",
  "databaseRef",
]);
const referenceTypes = new Set<BlockType>(["image", "file", "databaseRef"]);
function hasInlineContent(fragment: Y.XmlFragment): boolean {
  for (const node of fragment.toArray()) {
    if (node instanceof Y.XmlText) {
      if (node.length) return true;
    } else if (node instanceof Y.XmlElement) {
      if (node.nodeName !== "paragraph") return true;
      for (const inline of node.toArray()) {
        if (!(inline instanceof Y.XmlText) || inline.length) return true;
      }
    } else return true;
  }
  return false;
}

export function transformBlockSelection(
  page: StablePage,
  ids: string[],
  type: BlockType,
  options: { promoteChildren?: boolean } = {},
): void {
  blockTypeSchema.parse(type);
  const graph = readGraph(page);
  const roots = selection(graph, ids);
  const operations: Operation[] = [];
  for (const block of roots) {
    if (block.type === type) continue;
    if (
      referenceTypes.has(block.type) &&
      Object.values(page.getBlockAttributes(block.id)).some(
        (value) => typeof value === "string" && value.length,
      )
    )
      throw new Error(
        "Transformation requires an explicit choice to preserve the media or reference payload",
      );
    if (structuralTypes.has(type) && hasInlineContent(page.fragment(block.id)))
      throw new Error("Transformation cannot conceal text content");
    const nested = physicalChildren(graph, block.id);
    if (nested.some((child) => !canContainBlock(type, child.type))) {
      if (!options.promoteChildren)
        throw new Error("Choose how to preserve children before transforming their container");
      const siblings = children(graph, block.parentId);
      const beforeId = siblings[siblings.findIndex((sibling) => sibling.id === block.id) + 1]?.id ?? null;
      operations.push(
        ...place(
          graph,
          nested.map((child) => child.id),
          block.parentId,
          beforeId,
        ),
      );
    }
    const input = graph.blocks.get(block.id);
    if (!input) throw new Error("Missing transformed block");
    graph.blocks.set(block.id, { ...input, type });
    operations.push({ kind: "transform", id: block.id, type });
  }
  execute(page, operations);
}

const listTypes = new Set<BlockType>(["bulletListItem", "numberListItem", "task"]);
export function indentBlockSelection(page: StablePage, ids: string[], direction: 1 | -1): boolean {
  if (direction !== 1 && direction !== -1) throw new Error("Invalid indentation direction");
  const graph = readGraph(page);
  const roots = selection(graph, ids);
  if (!roots.length || roots.some((block) => !listTypes.has(block.type))) return false;
  const groups = new Map<string | null, BlockInput[]>();
  for (const root of roots) {
    const group = groups.get(root.parentId) ?? [];
    group.push(root);
    groups.set(root.parentId, group);
  }
  const destinations: { ids: string[]; parentId: string | null; beforeId: string | null }[] = [];
  for (const [parentId, group] of groups) {
    if (direction === 1) {
      const first = group[0];
      const siblings = children(graph, parentId);
      const previous = siblings[siblings.findIndex((block) => block.id === first?.id) - 1];
      if (!previous || !listTypes.has(previous.type)) return false;
      destinations.push({ ids: group.map((block) => block.id), parentId: previous.id, beforeId: null });
    } else {
      const parent = parentId === null ? undefined : graph.blocks.get(parentId);
      if (!parent || !listTypes.has(parent.type)) return false;
      const siblings = children(graph, parent.parentId);
      const next = siblings[siblings.findIndex((block) => block.id === parent.id) + 1];
      destinations.push({
        ids: group.map((block) => block.id),
        parentId: parent.parentId,
        beforeId: next?.id ?? null,
      });
    }
  }
  const operations: Operation[] = [];
  for (const destination of destinations)
    operations.push(...place(graph, destination.ids, destination.parentId, destination.beforeId));
  execute(page, operations);
  return operations.length > 0;
}
