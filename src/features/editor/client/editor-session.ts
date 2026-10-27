"use client";
import * as Y from "yjs";
import {
  DurableDocumentProvider,
  type SaveState,
  type DocumentTransport,
} from "../model/durable-document-provider";
import { initialContentUpdate } from "../model/initial-content";
import { StablePage } from "../model/stable-page";
import { HttpDocumentTransport } from "./http-transport";

type SessionOptions = {
  userId: string;
  workspaceId: string;
  pageId: string;
  editable: boolean;
  transport?: DocumentTransport;
  local?: boolean;
};
export type PendingDraft = { pageId: string; workspaceId: string; state: SaveState };
const cache = new Map<string, EditorSession>();
const pendingListeners = new Set<() => void>();
const pendingByUser = new Map<string, readonly PendingDraft[]>();
const emptyDrafts: readonly PendingDraft[] = Object.freeze([]);

function key(userId: string, pageId: string): string {
  return JSON.stringify([userId, pageId]);
}
function publishPending(userId: string): void {
  const next: PendingDraft[] = [];
  for (const value of cache.values())
    if (value.userId === userId && !value.isMounted() && value.provider.hasPendingChanges())
      next.push({ pageId: value.pageId, workspaceId: value.workspaceId, state: value.getStatus() });
  const previous = pendingByUser.get(userId) ?? emptyDrafts;
  if (
    previous.length === next.length &&
    previous.every((item, index) => {
      const other = next[index];
      return (
        item.pageId === other?.pageId && item.workspaceId === other.workspaceId && item.state === other.state
      );
    })
  )
    return;
  pendingByUser.set(userId, next.length ? Object.freeze(next) : emptyDrafts);
  for (const listener of pendingListeners) listener();
}
const blocked = (state: SaveState) => state === "denied" || state === "unsupported";

export class EditorSession {
  readonly document = new Y.Doc();
  readonly actor = crypto.randomUUID();
  readonly page: StablePage;
  readonly provider: DurableDocumentProvider;
  readonly userId: string;
  readonly workspaceId: string;
  readonly pageId: string;
  readonly local: boolean;
  private editable: boolean;
  private leases = 0;
  private disposed = false;
  private structureVersion = 0;
  private status: SaveState = "loading";
  private connection: Promise<void> | null = null;
  private readonly structureListeners = new Set<() => void>();
  private readonly statusListeners = new Set<() => void>();
  private readonly roots: Y.Map<unknown>[];

  constructor(
    options: SessionOptions,
    private readonly cacheKey?: string,
  ) {
    this.userId = options.userId;
    this.workspaceId = options.workspaceId;
    this.pageId = options.pageId;
    this.local = options.local ?? false;
    this.editable = options.editable;
    this.page = new StablePage(this.document, this.actor);
    this.roots = ["meta", "blocks", "placements", "removed", "attrs"].map((name) =>
      this.document.getMap(name),
    );
    for (const root of this.roots) root.observeDeep(this.structureChanged);
    this.provider = new DurableDocumentProvider({
      document: this.document,
      transport: options.transport ?? new HttpDocumentTransport(this.pageId),
      editable: this.editable,
      initialUpdate: initialContentUpdate(),
      onStatus: this.statusChanged,
    });
  }

  private readonly structureChanged = (): void => {
    if (this.disposed) return;
    this.structureVersion += 1;
    for (const listener of this.structureListeners) listener();
  };
  private readonly statusChanged = (state: SaveState): void => {
    if (this.disposed) return;
    const previous = this.status;
    this.status = state;
    if (previous === "loading" || state === "loading" || blocked(previous) || blocked(state))
      this.structureChanged();
    for (const listener of this.statusListeners) listener();
    publishPending(this.userId);
  };

  readonly subscribeStructure = (listener: () => void): (() => void) => {
    this.structureListeners.add(listener);
    return () => this.structureListeners.delete(listener);
  };
  readonly getStructureVersion = (): number => this.structureVersion;
  readonly subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };
  readonly getStatus = (): SaveState => this.status;
  isMounted(): boolean {
    return this.leases > 0;
  }
  isEditable(): boolean {
    return this.editable && !blocked(this.status);
  }

  setEditable(editable: boolean): void {
    if (this.disposed || this.editable === editable) return;
    this.editable = editable;
    this.provider.setEditable(editable);
    this.structureChanged();
  }

  connect(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.connection) return this.connection;
    this.connection = this.provider.connect().finally(() => {
      this.connection = null;
      if (!this.disposed && !this.leases) void this.flushAndRelease();
    });
    return this.connection;
  }
  mount(): () => void {
    if (this.disposed) return () => undefined;
    this.leases += 1;
    publishPending(this.userId);
    void this.connect();
    let released = false;
    return () => {
      if (released || this.disposed) return;
      released = true;
      this.leases -= 1;
      publishPending(this.userId);
      // StrictMode reacquires synchronously; no document/history is destroyed
      // until that reacquisition has had an opportunity to keep its lease.
      queueMicrotask(() => {
        if (!this.disposed && !this.leases) void this.flushAndRelease();
      });
    };
  }
  private async flushAndRelease(): Promise<void> {
    if (this.connection) await this.connection;
    if (this.disposed || this.leases) return;
    await this.provider.flush();
    if (this.disposed || this.leases) return;
    if (!this.provider.hasPendingChanges()) this.dispose();
    else publishPending(this.userId);
  }

  draftText(): string {
    if (this.disposed) return "";
    const names = [...this.document.share.keys()].filter((name) => name.startsWith("block-content:"));
    const ordered: string[] = [];
    try {
      const groups = new Map<string | null, { id: string; position: string }[]>();
      for (const id of this.document.getMap("blocks").keys()) {
        const block = this.page.getBlock(id);
        if (!block) continue;
        const parent = typeof block.parentId === "string" ? block.parentId : null;
        const siblings = groups.get(parent) ?? [];
        siblings.push({ id, position: typeof block.position === "string" ? block.position : "" });
        groups.set(parent, siblings);
      }
      for (const siblings of groups.values())
        siblings.sort((a, b) =>
          a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );
      const stack = [...(groups.get(null) ?? [])].reverse();
      const visited = new Set<string>();
      while (stack.length) {
        const block = stack.pop();
        if (!block || visited.has(block.id)) continue;
        visited.add(block.id);
        ordered.push(`block-content:${block.id}`);
        stack.push(...[...(groups.get(block.id) ?? [])].reverse());
      }
    } catch {
      /* Preserve recoverable fragments even while local structure is incomplete. */
    }
    const values: string[] = [];
    for (const name of new Set([...ordered, ...names])) {
      const content: string[] = [];
      const stack = this.document.getXmlFragment(name).toArray().reverse();
      while (stack.length) {
        const node = stack.pop();
        if (node instanceof Y.XmlText) {
          // XmlText.toString() serializes mark tags; copying a draft is plain text.
          for (const delta of node.toDelta())
            if (typeof delta.insert === "string") content.push(delta.insert);
        } else if (node instanceof Y.XmlElement) {
          if (node.nodeName === "hardBreak") content.push("\n");
          else stack.push(...node.toArray().reverse());
        }
      }
      if (content.length) values.push(content.join(""));
    }
    return values.join("\n");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.leases = 0;
    this.provider.dispose();
    for (const root of this.roots) root.unobserveDeep(this.structureChanged);
    this.page.destroy();
    this.document.destroy();
    this.structureListeners.clear();
    this.statusListeners.clear();
    if (this.cacheKey && cache.get(this.cacheKey) === this) cache.delete(this.cacheKey);
    publishPending(this.userId);
  }
}

export function getEditorSession(options: SessionOptions): EditorSession {
  if (typeof window === "undefined") return new EditorSession(options);
  const cacheKey = key(options.userId, options.pageId);
  const existing = cache.get(cacheKey);
  if (existing) {
    existing.setEditable(options.editable);
    return existing;
  }
  const value = new EditorSession(options, cacheKey);
  cache.set(cacheKey, value);
  return value;
}
export function subscribePendingDrafts(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}
export function getPendingDrafts(userId: string): readonly PendingDraft[] {
  return typeof window === "undefined" ? emptyDrafts : (pendingByUser.get(userId) ?? emptyDrafts);
}
export function getPendingDraftSession(userId: string, pageId: string): EditorSession | undefined {
  const value = cache.get(key(userId, pageId));
  return value && !value.isMounted() && value.provider.hasPendingChanges() ? value : undefined;
}
export function hasUnconfirmedEditorSessions(userId: string): boolean {
  return [...cache.values()].some(
    (session) => session.userId === userId && session.provider.hasPendingChanges(),
  );
}
export async function flushAllEditorSessions(userId: string): Promise<void> {
  await Promise.allSettled(
    [...cache.values()]
      .filter((session) => session.userId === userId)
      .map(async (session) => {
        await session.connect();
        await session.provider.flush();
      }),
  );
}
export function clearOtherEditorSessions(userId: string): void {
  for (const value of cache.values()) if (value.userId !== userId) value.dispose();
}
