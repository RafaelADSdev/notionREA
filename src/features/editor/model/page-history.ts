import * as Y from "yjs";

type StackItem = Y.UndoManager["undoStack"][number];
type Scope = ConstructorParameters<typeof Y.UndoManager>[0];
type Protection = { types: Set<object>; createdSharedBlocks: Set<string> };

/** Keep the typed Yjs struct dependency isolated and covered when updating the pinned library. */
function protectionFor(document: Y.Doc, stack: StackItem): Protection {
  const blocks = document.getMap("blocks");
  const placements = document.getMap("placements");
  const attributes = document.getMap("attrs");
  const roots = new Map<object, string>([...document.share].map(([name, type]) => [type, name] as const));
  const insertedBlocks = new Set<string>();
  const replacedBlocks = new Set<string>();
  const sharedBlocks = new Set<string>();
  const sharedAttributeBlocks = new Set<string>();
  const types = new Set<object>();
  for (const structs of document.store.clients.values()) {
    for (const item of structs) {
      if (!(item instanceof Y.Item)) continue;
      if (item.parent === blocks && item.parentSub !== null) {
        if (Y.isDeleted(stack.insertions, item.id)) insertedBlocks.add(item.parentSub);
        if (Y.isDeleted(stack.deletions, item.id) && !Y.isDeleted(stack.insertions, item.id))
          replacedBlocks.add(item.parentSub);
      }
      if (item.deleted || item.id.client === document.clientID) continue;
      let current: unknown = item.parent;
      let child = item;
      const visited = new Set<object>();
      while (current instanceof Y.AbstractType && !visited.has(current)) {
        visited.add(current);
        types.add(current);
        const name = roots.get(current);
        if (name?.startsWith("block-content:")) sharedBlocks.add(name.slice("block-content:".length));
        if (
          (current === blocks || current === placements || current === attributes) &&
          child.parentSub !== null
        ) {
          sharedBlocks.add(child.parentSub);
          if (current === attributes) sharedAttributeBlocks.add(child.parentSub);
        }
        const parentItem: Y.Item | null = current._item;
        if (!parentItem) break;
        child = parentItem;
        current = parentItem.parent;
      }
    }
  }
  // Preserve both structural ancestors and a table column's referenced origin.
  const pending = [...sharedBlocks];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    sharedBlocks.add(current);
    const values = attributes.get(current);
    const columnId = values instanceof Y.Map ? values.get("columnId") : undefined;
    if (typeof columnId === "string" && blocks.has(columnId)) pending.push(columnId);
    const placement = placements.get(current);
    if (
      typeof placement === "object" &&
      placement !== null &&
      "parentId" in placement &&
      typeof placement.parentId === "string"
    )
      pending.push(placement.parentId);
  }
  return {
    types,
    createdSharedBlocks: new Set(
      [...insertedBlocks].filter(
        (id) => (!replacedBlocks.has(id) && sharedBlocks.has(id)) || sharedAttributeBlocks.has(id),
      ),
    ),
  };
}

/** Restoring an old map value deletes its current value before deleteFilter runs. */
function protectedDeletions(
  document: Y.Doc,
  stack: StackItem,
  protection: Protection,
): StackItem["deletions"] {
  const maps = new Set<object>([
    document.getMap("blocks"),
    document.getMap("placements"),
    document.getMap("attrs"),
  ]);
  const excluded = new Map<number, { clock: number; len: number }[]>();
  for (const [client, structs] of document.store.clients) {
    for (const item of structs) {
      if (
        !(item instanceof Y.Item) ||
        !(item.parent instanceof Y.AbstractType) ||
        !maps.has(item.parent) ||
        item.parentSub === null ||
        !protection.createdSharedBlocks.has(item.parentSub) ||
        !Y.isDeleted(stack.deletions, item.id)
      )
        continue;
      const values = excluded.get(client) ?? [];
      values.push({ clock: item.id.clock, len: item.length });
      excluded.set(client, values);
    }
  }
  const retained = Y.createDeleteSet();
  for (const [client, intervals] of stack.deletions.clients) {
    let values = intervals.map(({ clock, len }) => ({ clock, len }));
    for (const skip of excluded.get(client) ?? []) {
      values = values.flatMap((value) => {
        const end = value.clock + value.len,
          skipEnd = skip.clock + skip.len;
        if (skipEnd <= value.clock || skip.clock >= end) return [value];
        return [
          ...(value.clock < skip.clock ? [{ clock: value.clock, len: skip.clock - value.clock }] : []),
          ...(end > skipEnd ? [{ clock: skipEnd, len: end - skipEnd }] : []),
        ];
      });
    }
    if (values.length) retained.clients.set(client, values);
  }
  return retained;
}

/** Author-local history preserves wrappers that now contain another replica's contribution. */
export class PageHistory extends Y.UndoManager {
  private readonly context: { value: Protection | null };
  constructor(
    private readonly document: Y.Doc,
    scope: Scope,
    actor: string,
  ) {
    const context: { value: Protection | null } = { value: null };
    const maps = new Set<object>([
      document.getMap("blocks"),
      document.getMap("placements"),
      document.getMap("attrs"),
    ]);
    const attributes = document.getMap("attrs");
    super(scope, {
      trackedOrigins: new Set([actor]),
      captureTimeout: 500,
      deleteFilter(item) {
        const protection = context.value;
        if (!protection) return true;
        if (item.content instanceof Y.ContentType && protection.types.has(item.content.type)) return false;
        if (item.parent instanceof Y.Map && item.parentSub === "columnId") {
          const owner = item.parent._item;
          if (
            owner?.parent === attributes &&
            owner.parentSub !== null &&
            protection.createdSharedBlocks.has(owner.parentSub)
          )
            return false;
        }
        return !(
          item.parent instanceof Y.AbstractType &&
          maps.has(item.parent) &&
          item.parentSub !== null &&
          protection.createdSharedBlocks.has(item.parentSub)
        );
      },
    });
    this.context = context;
  }
  private perform(stack: StackItem | undefined, action: () => StackItem | null): StackItem | null {
    const previous = this.context.value;
    this.context.value = stack ? protectionFor(this.document, stack) : null;
    const original = stack?.deletions;
    if (stack && this.context.value)
      stack.deletions = protectedDeletions(this.document, stack, this.context.value);
    try {
      return action();
    } finally {
      if (stack && original) stack.deletions = original;
      this.context.value = previous;
    }
  }
  override undo(): StackItem | null {
    return this.popProtected("undoStack", () => super.undo());
  }
  override redo(): StackItem | null {
    return this.popProtected("redoStack", () => super.redo());
  }
  private popProtected(name: "undoStack" | "redoStack", action: () => StackItem | null): StackItem | null {
    // Yjs skips no-op items internally. Limit each invocation to one item so
    // another item's remote dependencies always get their own protection.
    while (this[name].length) {
      const item = this[name].pop();
      if (!item) return null;
      const remaining = this[name];
      this[name] = [item];
      let result: StackItem | null;
      try {
        result = this.perform(item, action);
      } finally {
        this[name] = [...remaining, ...this[name]];
      }
      if (result) return result;
    }
    return null;
  }
}
