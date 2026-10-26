import * as Y from "yjs";

export type BlockType = "paragraph" | "toggle" | "table" | "tableRow" | "tableCell" | "columns" | "column";
export type BlockInput = { id: string; type: BlockType; parentId: string | null; position: string };
type Placement = Pick<BlockInput, "parentId" | "position">;
const blockTypes: readonly string[] = [
  "paragraph",
  "toggle",
  "table",
  "tableRow",
  "tableCell",
  "columns",
  "column",
];
const identifier = /^[a-zA-Z0-9_-]{1,80}$/;
const positionKey = /^[a-zA-Z0-9]{1,128}$/;

export class StablePage {
  private readonly blocks: Y.Map<BlockType>;
  private readonly placements: Y.Map<Placement>;
  private readonly removed: Y.Map<boolean>;
  public readonly undoManager: Y.UndoManager;

  constructor(
    public readonly document: Y.Doc,
    private readonly actor: string,
  ) {
    this.blocks = document.getMap<BlockType>("blocks");
    this.placements = document.getMap<Placement>("placements");
    this.removed = document.getMap<boolean>("removed");
    this.undoManager = new Y.UndoManager([this.blocks, this.placements, this.removed], {
      trackedOrigins: new Set([actor]),
      captureTimeout: 0,
    });
  }

  createBlock(input: BlockInput): void {
    if (!identifier.test(input.id) || !blockTypes.includes(input.type) || this.blocks.has(input.id)) {
      throw new Error("Invalid or duplicate block identity");
    }
    this.checkDestination(input.id, input.parentId, input.position);
    this.document.transact(() => {
      this.blocks.set(input.id, input.type);
      this.placements.set(input.id, { parentId: input.parentId, position: input.position });
    }, this.actor);
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
    this.document.transact(() => this.placements.set(id, { parentId, position }), this.actor);
  }

  removeBlock(id: string): void {
    this.requireBlock(id);
    // A tombstone hides the block while its stable content still receives concurrent edits.
    this.document.transact(() => this.removed.set(id, true), this.actor);
  }

  restoreBlock(id: string): void {
    this.requireBlock(id);
    this.document.transact(() => this.removed.set(id, false), this.actor);
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
      const placement = this.placements.get(id);
      if (!placement || typeof placement.position !== "string" || !positionKey.test(placement.position)) {
        throw new Error("Invalid block placement");
      }
      this.checkAncestry(id, placement.parentId);
    }
    for (const [id] of this.placements) this.requireBlock(id);
    for (const [id, deleted] of this.removed) {
      this.requireBlock(id);
      if (typeof deleted !== "boolean") throw new Error("Invalid block tombstone");
    }
  }

  stopCapturing(): void {
    this.undoManager.stopCapturing();
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

  private checkDestination(id: string, parentId: string | null, position: string): void {
    if (!positionKey.test(position)) throw new Error("Invalid position");
    this.checkAncestry(id, parentId);
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
