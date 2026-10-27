import { z } from "zod";
import type { BlockFileResolver, PageFileInfo } from "@/features/files/types";
import { readBoundedJson } from "@/lib/http";
import type { MentionResolver } from "../ui/text-extensions";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const mentionSchema = z.strictObject({ id: uuid, title: z.string().max(500), icon: z.string().max(16) });
const fileSchema = z.strictObject({
  fileId: uuid,
  name: z.string().max(180),
  mimeType: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .min(0)
    .max(25 * 1024 * 1024),
  width: z.number().int().min(1).max(16384).nullable(),
  height: z.number().int().min(1).max(16384).nullable(),
});
const inputSchema = z.strictObject({
  workspaceId: uuid,
  mentions: z.array(uuid).max(100),
  files: z.array(uuid).max(100),
});
const responseSchema = z.strictObject({
  mentions: z.array(mentionSchema).max(100),
  files: z.array(fileSchema).max(100),
});
type Mention = z.infer<typeof mentionSchema>;
type Versions = Map<string, number>;
type Batch = { mentions: Versions; files: Versions };

/** In-memory authorized labels only. Canonical content continues to contain opaque identities. */
export class DocumentReferences {
  readonly mentions: MentionResolver;
  readonly files: BlockFileResolver;
  private readonly workspaceId: string;
  private readonly path: string;
  private readonly onUnavailable: (() => void) | undefined;
  private readonly mentionValues = new Map<string, Mention>();
  private readonly fileValues = new Map<string, PageFileInfo>();
  private readonly mentionVersions: Versions = new Map();
  private readonly fileVersions: Versions = new Map();
  private readonly pendingMentions = new Set<string>();
  private readonly pendingFiles = new Set<string>();
  private readonly mentionListeners = new Set<() => void>();
  private readonly fileListeners = new Set<() => void>();
  private readonly active = new Set<AbortController>();
  private scheduled = false;
  private disposed = false;
  private unavailable = false;
  private epoch = 0;

  constructor(options: { workspaceId: string; pageId: string; onUnavailable?: () => void }) {
    this.workspaceId = uuid.parse(options.workspaceId);
    this.path = `/api/documents/${uuid.parse(options.pageId)}/references`;
    this.onUnavailable = options.onUnavailable;
    this.mentions = {
      resolve: (id) => {
        const value = this.mentionValues.get(id.toLowerCase());
        return value
          ? { title: value.title, href: `/w/${this.workspaceId}/p/${value.id}` }
          : null;
      },
      subscribe: (listener) => this.subscribe(this.mentionListeners, listener),
    };
    this.files = {
      resolve: (id) => {
        const value = this.fileValues.get(id.toLowerCase());
        return value ?? null;
      },
      subscribe: (listener) => this.subscribe(this.fileListeners, listener),
      ensure: (id) => this.ensure(id, this.fileVersions, this.pendingFiles),
      prime: (value) => {
        if (this.disposed || this.unavailable) return;
        const parsed = fileSchema.safeParse(value);
        if (!parsed.success) return;
        const id = parsed.data.fileId;
        this.fileVersions.set(id, (this.fileVersions.get(id) ?? -1) + 1);
        this.pendingFiles.delete(id);
        this.fileValues.set(id, Object.freeze(parsed.data));
        this.notify(this.fileListeners);
      },
    };
  }

  ensureMention(id: string): void {
    this.ensure(id, this.mentionVersions, this.pendingMentions);
  }

  refresh(): void {
    if (this.disposed) return;
    this.unavailable = false;
    for (const [versions, pending] of [
      [this.mentionVersions, this.pendingMentions],
      [this.fileVersions, this.pendingFiles],
    ] as const) {
      for (const [id, version] of versions) {
        versions.set(id, version + 1);
        pending.add(id);
      }
    }
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    for (const controller of this.active) controller.abort();
    this.pendingMentions.clear();
    this.pendingFiles.clear();
    this.mentionValues.clear();
    this.fileValues.clear();
    this.mentionVersions.clear();
    this.fileVersions.clear();
    this.notify(this.mentionListeners);
    this.notify(this.fileListeners);
    this.mentionListeners.clear();
    this.fileListeners.clear();
  }

  private subscribe(listeners: Set<() => void>, listener: () => void): () => void {
    if (this.disposed) return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  private notify(listeners: Set<() => void>): void {
    for (const listener of listeners) listener();
  }

  private ensure(value: string, versions: Versions, pending: Set<string>): void {
    if (this.disposed) return;
    const parsed = uuid.safeParse(value);
    if (!parsed.success || versions.has(parsed.data)) return;
    versions.set(parsed.data, 0);
    pending.add(parsed.data);
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.disposed || this.unavailable) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private take(pending: Set<string>, versions: Versions): Versions {
    const result: Versions = new Map();
    for (const id of pending) {
      pending.delete(id);
      result.set(id, versions.get(id) ?? 0);
      if (result.size === 100) break;
    }
    return result;
  }

  private pump(): void {
    if (this.disposed || this.unavailable) return;
    while (this.active.size < 2 && (this.pendingMentions.size || this.pendingFiles.size)) {
      const batch = {
        mentions: this.take(this.pendingMentions, this.mentionVersions),
        files: this.take(this.pendingFiles, this.fileVersions),
      };
      const controller = new AbortController();
      const epoch = this.epoch;
      this.active.add(controller);
      void this.request(batch, controller, epoch)
        .catch(() => {
          // Keep the last authorized metadata on network/validation failures; refresh retries explicitly.
        })
        .finally(() => {
          this.active.delete(controller);
          if (this.pendingMentions.size || this.pendingFiles.size) this.schedule();
        });
    }
  }

  private async request(batch: Batch, controller: AbortController, epoch: number): Promise<void> {
    const input = inputSchema.parse({
      workspaceId: this.workspaceId,
      mentions: [...batch.mentions.keys()],
      files: [...batch.files.keys()],
    });
    const response = await fetch(this.path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (this.disposed || controller.signal.aborted || epoch !== this.epoch) return;
    if (response.status === 401 || response.status === 403) {
      this.deny();
      return;
    }
    if (!response.ok) return;
    const result = responseSchema.parse(await readBoundedJson(response, 512 * 1024));
    if (this.disposed || controller.signal.aborted || epoch !== this.epoch) return;
    const mentions = new Map(result.mentions.map((value) => [value.id, value]));
    const files = new Map(result.files.map((value) => [value.fileId, value]));
    if (
      mentions.size !== result.mentions.length ||
      files.size !== result.files.length ||
      [...mentions.keys()].some((id) => !batch.mentions.has(id)) ||
      [...files.keys()].some((id) => !batch.files.has(id))
    )
      throw new Error("Invalid reference response identities");
    for (const [id, version] of batch.mentions) {
      if (this.mentionVersions.get(id) !== version) continue;
      const value = mentions.get(id);
      if (value) this.mentionValues.set(id, value);
      else this.mentionValues.delete(id);
    }
    for (const [id, version] of batch.files) {
      if (this.fileVersions.get(id) !== version) continue;
      const value = files.get(id);
      if (value) this.fileValues.set(id, Object.freeze(value));
      else this.fileValues.delete(id);
    }
    this.notify(this.mentionListeners);
    this.notify(this.fileListeners);
  }

  private deny(): void {
    if (this.unavailable || this.disposed) return;
    this.unavailable = true;
    this.epoch++;
    for (const controller of this.active) controller.abort();
    this.pendingMentions.clear();
    this.pendingFiles.clear();
    this.mentionValues.clear();
    this.fileValues.clear();
    this.notify(this.mentionListeners);
    this.notify(this.fileListeners);
    this.onUnavailable?.();
  }
}
