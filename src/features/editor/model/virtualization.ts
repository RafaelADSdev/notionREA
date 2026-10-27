export type VirtualBlock = { id: string; parentId: string | null; type: string };
export type VirtualBlockIndex = {
  size: number;
  order: readonly string[];
  parents: ReadonlyMap<string, string | null>;
  types: ReadonlyMap<string, string>;
  children: ReadonlyMap<string | null, readonly string[]>;
  positions: ReadonlyMap<string, number>;
  subtreeEnds: ReadonlyMap<string, number>;
  estimatedHeight: (id: string) => number;
};
const baseHeights: Readonly<Record<string, number>> = {
  heading: 72,
  code: 128,
  image: 320,
  file: 88,
  table: 200,
  divider: 32,
  callout: 88,
  column: 0,
  columns: 0,
};

/** The index is a projection of identities, never a replacement for canonical Yjs state. */
export function buildVirtualBlockIndex(blocks: readonly VirtualBlock[]): VirtualBlockIndex {
  const byId = new Map<string, VirtualBlock>(),
    parents = new Map<string, string | null>(),
    children = new Map<string | null, string[]>();
  for (const block of blocks) {
    if (!block.id || byId.has(block.id)) throw new Error("Duplicate virtual block identity");
    byId.set(block.id, block);
    parents.set(block.id, block.parentId);
    const siblings = children.get(block.parentId) ?? [];
    siblings.push(block.id);
    children.set(block.parentId, siblings);
  }
  for (const block of blocks)
    if (block.parentId !== null && !byId.has(block.parentId)) throw new Error("Orphaned virtual block");
  const order: string[] = [],
    positions = new Map<string, number>(),
    subtreeEnds = new Map<string, number>();
  const stack: { id: string; exit: boolean }[] = (children.get(null) ?? [])
    .toReversed()
    .map((id) => ({ id, exit: false }));
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    if (entry.exit) {
      subtreeEnds.set(entry.id, order.length);
      continue;
    }
    if (positions.has(entry.id)) throw new Error("Cyclic virtual block hierarchy");
    positions.set(entry.id, order.length);
    order.push(entry.id);
    stack.push({ id: entry.id, exit: true });
    const nested = children.get(entry.id) ?? [];
    for (let index = nested.length - 1; index >= 0; index--) {
      const id = nested[index];
      if (id) stack.push({ id, exit: false });
    }
  }
  if (order.length !== blocks.length) throw new Error("Cyclic virtual block hierarchy");
  const estimates = new Map<string, number>();
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index],
      block = id ? byId.get(id) : undefined;
    if (!id || !block) continue;
    const nested = (children.get(id) ?? []).map((child) => estimates.get(child) ?? 48);
    const content =
      block.type === "columns"
        ? nested.reduce((height, child) => Math.max(height, child), 0)
        : nested.reduce((height, child) => height + child, 0);
    estimates.set(id, Math.max(1, (baseHeights[block.type] ?? 48) + content));
  }
  return {
    size: order.length,
    order,
    parents,
    types: new Map(blocks.map((block) => [block.id, block.type])),
    children,
    positions,
    subtreeEnds,
    estimatedHeight: (id) => estimates.get(id) ?? 48,
  };
}

export type VirtualProtection = {
  focused?: string | null;
  composing?: string | null;
  dragging?: string | null;
  requested?: string | null;
  selected?: readonly string[];
  nativeSelection?: readonly string[];
};
/** A child cannot remain mounted unless each ancestor that renders it remains mounted. */
export function protectedVirtualBlocks(index: VirtualBlockIndex, protection: VirtualProtection): Set<string> {
  const protectedIds = new Set<string>();
  const requested = [
    protection.focused,
    protection.composing,
    protection.dragging,
    protection.requested,
    ...(protection.selected ?? []),
    ...(protection.nativeSelection ?? []),
  ];
  for (const value of requested) {
    let id = value;
    while (id && index.parents.has(id) && !protectedIds.has(id)) {
      protectedIds.add(id);
      id = index.parents.get(id);
    }
  }
  return protectedIds;
}
export function virtualVisibleOrder(
  index: VirtualBlockIndex,
  collapsed: ReadonlySet<string> = new Set(),
): string[] {
  const result: string[] = [];
  for (let position = 0; position < index.order.length; ) {
    const id = index.order[position];
    if (!id) break;
    result.push(id);
    position =
      collapsed.has(id) || index.types.get(id) === "table"
        ? (index.subtreeEnds.get(id) ?? position + 1)
        : position + 1;
  }
  return result;
}
export function virtualSelectionIds(
  index: VirtualBlockIndex,
  anchor: string,
  head: string,
  collapsed: ReadonlySet<string> = new Set(),
): string[] {
  const visible = virtualVisibleOrder(index, collapsed),
    first = visible.indexOf(anchor),
    last = visible.indexOf(head);
  return first < 0 || last < 0 ? [] : visible.slice(Math.min(first, last), Math.max(first, last) + 1);
}

export type VirtualBlockSegment =
  | { kind: "item"; id: string; index: number; top: number; height: number }
  | { kind: "gap"; first: number; last: number; top: number; height: number };
/** Keep all pinned rows while coalescing every other offscreen interval into one spacer. */
export function virtualBlockWindow(
  items: readonly Pick<VirtualBlock, "id">[],
  viewport: { top: number; height: number; overscan: number },
  heightFor: (id: string) => number,
  protectedIds: ReadonlySet<string>,
  enabled: boolean,
): VirtualBlockSegment[] {
  if (
    ![viewport.top, viewport.height, viewport.overscan].every(Number.isFinite) ||
    viewport.height < 0 ||
    viewport.overscan < 0
  )
    throw new Error("Invalid virtual viewport");
  const from = viewport.top - viewport.overscan,
    to = viewport.top + viewport.height + viewport.overscan;
  const result: VirtualBlockSegment[] = [];
  let top = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
    const measured = heightFor(item.id),
      height = Number.isFinite(measured) && measured > 0 ? measured : 48;
    if (!enabled || (top < to && top + height > from) || protectedIds.has(item.id))
      result.push({ kind: "item", id: item.id, index, top, height });
    else {
      const previous = result.at(-1);
      if (previous?.kind === "gap") {
        previous.last = index;
        previous.height += height;
      } else result.push({ kind: "gap", first: index, last: index, top, height });
    }
    top += height;
  }
  return result;
}
