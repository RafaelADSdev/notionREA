import * as Y from "yjs";
import { PageHistory } from "./page-history";
import {
  blockTypes,
  canContainBlock,
  validateBlockAttributes,
  type BlockType,
  type BlockAttributes,
} from "./block-schema";

export type { BlockType } from "./block-schema";
export type BlockInput = { id: string; type: BlockType; parentId: string | null; position: string };
type Placement = Pick<BlockInput, "parentId" | "position">;
const identifier = /^[a-zA-Z0-9_-]{1,80}$/;
const positionKey = /^[a-zA-Z0-9]{1,128}$/;

export class StablePage {
  private readonly blocks: Y.Map<BlockType>;
  private readonly placements: Y.Map<Placement>;
  private readonly removed: Y.Map<boolean>;
  private readonly attributes: Y.Map<Y.Map<unknown>>;
  private readonly identities: Y.Map<boolean>;
  public readonly undoManager: Y.UndoManager;

  constructor(
    public readonly document: Y.Doc,
    private readonly actor: string,
  ) {
    this.blocks = document.getMap<BlockType>("blocks");
    this.placements = document.getMap<Placement>("placements");
    this.removed = document.getMap<boolean>("removed");
    this.attributes = document.getMap<Y.Map<unknown>>("attrs");
    // Identity receipts outlive a local creation undo; only active content is undoable.
    this.identities = document.getMap<boolean>("identities");
    this.undoManager = new PageHistory(
      document,
      [this.blocks, this.placements, this.removed, this.attributes],
      actor,
    );
  }

  createBlock(input: BlockInput): void {
    if (
      !identifier.test(input.id) ||
      !blockTypes.includes(input.type) ||
      this.blocks.has(input.id) ||
      this.identities.has(input.id)
    ) {
      throw new Error("Invalid or duplicate block identity");
    }
    this.checkDestination(input.id, input.parentId, input.position, input.type);
    this.runAction(() => {
      this.identities.set(input.id, true);
      this.blocks.set(input.id, input.type);
      this.placements.set(input.id, { parentId: input.parentId, position: input.position });
    });
    this.fragment(input.id);
  }

  fragment(id: string): Y.XmlFragment {
    this.requireBlock(id);
    const fragment = this.document.getXmlFragment(`block-content:${id}`);
    this.undoManager.addToScope(fragment);
    return fragment;
  }

  moveBlock(id: string, parentId: string | null, position: string): void {
    this.requireBlock(id);
    this.checkDestination(id, parentId, position);
    this.runAction(() => this.placements.set(id, { parentId, position }));
  }

  getBlock(id: string): BlockInput | undefined {
    const type = this.blocks.get(id);
    const placement = this.placements.get(id);
    return type && placement ? { id, type, ...placement } : undefined;
  }

  getBlockAttributes(id: string): BlockAttributes {
    this.requireBlock(id);
    const attributes = this.attributes.get(id);
    if (attributes !== undefined && !(attributes instanceof Y.Map))
      throw new Error("Invalid block attributes");
    const type = this.blocks.get(id);
    if (!type) throw new Error("Block does not exist");
    return validateBlockAttributes(type, attributes?.toJSON() ?? {});
  }

  setBlockAttributes(id: string, patch: Record<string, unknown>): void {
    const type = this.blocks.get(id);
    if (!type) throw new Error("Block does not exist");
    const value = validateBlockAttributes(type, { ...this.getBlockAttributes(id), ...patch });
    this.runAction(() => {
      let attributes = this.attributes.get(id);
      if (!attributes) {
        attributes = new Y.Map<unknown>();
        this.attributes.set(id, attributes);
      }
      for (const key of Object.keys(patch)) attributes.set(key, value[key]);
    });
  }

  transformBlock(id: string, type: BlockType): void {
    this.requireBlock(id);
    if (!blockTypes.includes(type)) throw new Error("Invalid block type");
    const placement = this.placements.get(id);
    if (!placement) throw new Error("Invalid block placement");
    this.checkDestination(id, placement.parentId, placement.position, type);
    for (const [childId, childPlacement] of this.placements) {
      const childType = this.blocks.get(childId);
      if (childPlacement.parentId === id && childType && !canContainBlock(type, childType))
        throw new Error("Move children before transforming their container");
    }
    this.runAction(() => {
      this.blocks.set(id, type);
      this.attributes.delete(id);
    });
  }

  removeBlock(id: string): void {
    this.requireBlock(id);
    // A tombstone hides the block while its stable content still receives concurrent edits.
    this.runAction(() => this.removed.set(id, true));
  }

  restoreBlock(id: string): void {
    this.requireBlock(id);
    this.runAction(() => this.removed.set(id, false));
  }

  visibleChildren(parentId: string | null = null): BlockInput[] {
    this.validate();
    if (parentId !== null && !this.isVisible(parentId)) return [];
    const result: BlockInput[] = [];
    for (const [id, type] of this.blocks) {
      const placement = this.placements.get(id);
      if (placement?.parentId === parentId && this.isVisible(id)) result.push({ id, type, ...placement });
    }
    return result.sort((first, second) =>
      first.position < second.position
        ? -1
        : first.position > second.position
          ? 1
          : first.id < second.id
            ? -1
            : first.id > second.id
              ? 1
              : 0,
    );
  }

  validate(): void {
    if (this.blocks.size > 10000) throw new Error("Block limit exceeded");
    for (const [id, type] of this.blocks) {
      if (!identifier.test(id) || !blockTypes.includes(type)) throw new Error("Invalid block schema");
      if (this.document.getMap("meta").get("schemaVersion") === 1 && this.identities.get(id) !== true)
        throw new Error("Missing stable block identity");
      const placement = this.placements.get(id);
      if (!placement || typeof placement.position !== "string" || !positionKey.test(placement.position)) {
        throw new Error("Invalid block placement");
      }
      if (
        Object.keys(placement).length !== 2 ||
        !Object.hasOwn(placement, "parentId") ||
        !Object.hasOwn(placement, "position")
      )
        throw new Error("Unknown block placement fields");
      this.checkAncestry(id, placement.parentId);
      const parentType = placement.parentId === null ? null : this.blocks.get(placement.parentId);
      if (parentType === undefined || !canContainBlock(parentType, type))
        throw new Error("Invalid block nesting");
      this.getBlockAttributes(id);
    }
    for (const [id] of this.placements) this.requireBlock(id);
    for (const [id, deleted] of this.removed) {
      this.requireBlock(id);
      if (typeof deleted !== "boolean") throw new Error("Invalid block tombstone");
    }
    for (const [id] of this.attributes) this.requireBlock(id);
    for (const [id, retained] of this.identities)
      if (!identifier.test(id) || retained !== true) throw new Error("Invalid block identity receipt");
  }

  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }
  runAction(action: () => void): void {
    this.stopCapturing();
    this.document.transact(action, this.actor);
    this.stopCapturing();
  }
  undo(): boolean {
    return this.undoManager.undo() !== null;
  }
  redo(): boolean {
    return this.undoManager.redo() !== null;
  }
  destroy(): void {
    this.undoManager.destroy();
  }

  private requireBlock(id: string): void {
    if (!this.blocks.has(id)) throw new Error("Block does not exist");
  }

  private checkDestination(
    id: string,
    parentId: string | null,
    position: string,
    type = this.blocks.get(id),
  ): void {
    if (!positionKey.test(position)) throw new Error("Invalid position");
    this.checkAncestry(id, parentId);
    const parentType = parentId === null ? null : this.blocks.get(parentId);
    if (!type || parentType === undefined || !canContainBlock(parentType, type))
      throw new Error("Invalid block nesting");
  }

  private checkAncestry(id: string, parentId: string | null): void {
    const visited = new Set([id]);
    let parent = parentId;
    while (parent !== null) {
      if (typeof parent !== "string" || visited.has(parent)) throw new Error("Block cycle detected");
      this.requireBlock(parent);
      visited.add(parent);
      const placement = this.placements.get(parent);
      if (!placement) throw new Error("Parent placement missing");
      parent = placement.parentId;
    }
  }

  private isVisible(id: string): boolean {
    let current: string | null = id;
    while (current !== null) {
      if (this.removed.get(current)) return false;
      current = this.placements.get(current)?.parentId ?? null;
    }
    return true;
  }
}
