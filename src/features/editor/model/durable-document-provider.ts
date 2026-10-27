import * as Y from "yjs";
import { MAX_CONTENT_BYTES, MAX_UPDATE_BYTES } from "./content-limits";

export type SaveState = "loading" | "dirty" | "saving" | "saved" | "error" | "denied" | "unsupported";
export type DocumentSnapshot = { revision: number; schemaVersion: number; snapshot: Uint8Array };
export type DocumentOperation = { id: string; payload: Uint8Array };
export type DocumentTransport = {
  read(): Promise<DocumentSnapshot>;
  write(operation: DocumentOperation): Promise<{ revision: number }>;
};
export class DocumentTransportError extends Error {
  constructor(public readonly code: "denied" | "conflict" | "transient" | "invalid" | "busy") {
    super("Document transport failed");
    this.name = "DocumentTransportError";
  }
}
type Options = {
  document: Y.Doc;
  transport: DocumentTransport;
  editable: boolean;
  onStatus?: (state: SaveState) => void;
  debounceMs?: number;
  makeOperationId?: () => string;
  initialUpdate?: Uint8Array;
};
type Job = DocumentOperation & { count: number };

/** Acknowledged operations leave the queue; failures retain the exact retry identity and payload. */
export class DurableDocumentProvider {
  private readonly remote = Symbol("durable document read");
  private readonly pending: Uint8Array[] = [];
  private job: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | null = null;
  private connection: Promise<void> | null = null;
  private connected = false;
  private disposed = false;
  private currentState: SaveState = "loading";
  private currentRevision = 0;

  constructor(private readonly options: Options) {
    options.document.on("update", this.capture);
  }
  get state(): SaveState {
    return this.currentState;
  }
  get revision(): number {
    return this.currentRevision;
  }
  hasPendingChanges(): boolean {
    return this.pending.length > 0;
  }
  setEditable(editable: boolean): void {
    if (this.disposed || this.options.editable === editable) return;
    this.options.editable = editable;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (
      editable &&
      this.hasPendingChanges() &&
      !["error", "denied", "unsupported"].includes(this.currentState)
    ) {
      this.status("dirty");
      this.schedule();
    }
  }

  private readonly capture = (update: Uint8Array, origin: unknown) => {
    if (this.disposed || origin === this.remote || !this.options.editable) return;
    this.pending.push(update.slice());
    if (
      this.currentState === "error" ||
      this.currentState === "denied" ||
      this.currentState === "unsupported"
    )
      return;
    if (!this.inflight || this.currentState === "saved") this.status("dirty");
    this.schedule();
  };
  private status(state: SaveState): void {
    if (this.disposed || this.currentState === state) return;
    // Revocation and incompatible schema are terminal for this document lease.
    // An older read, write ACK or network error must never reopen that lease.
    if (this.currentState === "denied" || (this.currentState === "unsupported" && state !== "denied")) return;
    this.currentState = state;
    this.options.onStatus?.(state);
  }
  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (!this.connected || this.disposed || this.inflight) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.debounceMs ?? 500);
  }
  private failure(error: unknown): void {
    this.status(error instanceof DocumentTransportError && error.code === "denied" ? "denied" : "error");
  }
  private merge(snapshot: DocumentSnapshot): boolean {
    if (this.disposed || this.currentState === "denied" || this.currentState === "unsupported") return false;
    if (snapshot.schemaVersion !== 1) {
      this.status("unsupported");
      return false;
    }
    if (
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 ||
      snapshot.snapshot.byteLength > MAX_CONTENT_BYTES
    )
      throw new DocumentTransportError("invalid");
    if (snapshot.snapshot.length) Y.applyUpdate(this.options.document, snapshot.snapshot, this.remote);
    this.currentRevision = Math.max(this.currentRevision, snapshot.revision);
    return true;
  }
  connect(): Promise<void> {
    if (this.disposed || this.connected) return Promise.resolve();
    if (this.connection) return this.connection;
    this.connection = this.open().finally(() => {
      this.connection = null;
    });
    return this.connection;
  }
  private async open(): Promise<void> {
    try {
      const snapshot = await this.options.transport.read();
      if (this.disposed || !this.merge(snapshot)) return;
      const empty =
        snapshot.snapshot.length === 0 ||
        (snapshot.snapshot.length === 2 && snapshot.snapshot[0] === 0 && snapshot.snapshot[1] === 0);
      const seed = this.options.initialUpdate;
      if (empty && snapshot.revision === 0 && this.options.editable && seed?.length) {
        Y.applyUpdate(this.options.document, seed, this.remote);
        this.pending.push(seed.slice());
      }
      this.connected = true;
      this.status(this.hasPendingChanges() ? "dirty" : "saved");
      if (this.hasPendingChanges()) this.schedule();
    } catch (error) {
      this.failure(error);
    }
  }
  async synchronize(): Promise<void> {
    if (this.disposed || this.currentState === "denied" || this.currentState === "unsupported") return;
    try {
      const snapshot = await this.options.transport.read();
      if (this.disposed || !this.merge(snapshot)) return;
      if (this.currentState !== "error" && !this.inflight)
        this.status(this.hasPendingChanges() ? "dirty" : "saved");
    } catch (error) {
      this.failure(error);
    }
  }
  private nextJob(): Job | null {
    if (this.job) return this.job;
    let count = 0;
    let bytes = 0;
    for (const update of this.pending) {
      if (bytes + update.length > MAX_UPDATE_BYTES) break;
      bytes += update.length;
      count++;
    }
    if (count === 0) return null;
    let payload = count === 1 ? this.pending[0]?.slice() : Y.mergeUpdates(this.pending.slice(0, count));
    while (payload && payload.length > MAX_UPDATE_BYTES && count > 1) {
      count--;
      payload = Y.mergeUpdates(this.pending.slice(0, count));
    }
    if (!payload || payload.length > MAX_UPDATE_BYTES) return null;
    this.job = { id: this.options.makeOperationId?.() ?? crypto.randomUUID(), payload, count };
    return this.job;
  }
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (
      this.disposed ||
      !this.connected ||
      !this.options.editable ||
      ["denied", "unsupported", "error"].includes(this.currentState)
    )
      return Promise.resolve();
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.inflight = this.drain().finally(() => {
      this.inflight = null;
      if (this.hasPendingChanges() && !["error", "denied", "unsupported"].includes(this.currentState)) {
        this.status("dirty");
        this.schedule();
      }
    });
    return this.inflight;
  }
  private async drain(): Promise<void> {
    while (
      !this.disposed &&
      this.options.editable &&
      this.pending.length &&
      !["denied", "unsupported"].includes(this.currentState)
    ) {
      const operation = this.nextJob();
      if (!operation) {
        this.status("error");
        return;
      }
      this.status("saving");
      let accepted = false;
      for (let attempt = 0; attempt < 3 && !this.disposed; attempt++) {
        try {
          const receipt = await this.options.transport.write(operation);
          if (this.disposed || this.currentState === "denied" || this.currentState === "unsupported") return;
          if (!Number.isSafeInteger(receipt.revision) || receipt.revision < 1)
            throw new DocumentTransportError("invalid");
          this.currentRevision = Math.max(this.currentRevision, receipt.revision);
          this.pending.splice(0, operation.count);
          this.job = null;
          try {
            const snapshot = await this.options.transport.read();
            if (this.disposed || !this.merge(snapshot)) return;
          } catch (error) {
            // The ACK is already durable. A temporary catch-up failure must not
            // turn it back into an unconfirmed write; access/format failures block.
            if (
              error instanceof DocumentTransportError &&
              (error.code === "denied" || error.code === "invalid")
            ) {
              this.failure(error);
              return;
            }
          }
          accepted = true;
          break;
        } catch (error) {
          if (error instanceof DocumentTransportError && error.code === "conflict" && attempt < 2) {
            await this.synchronize();
            if (
              this.currentState === "denied" ||
              this.currentState === "unsupported" ||
              this.currentState === "error"
            )
              return;
          } else {
            this.failure(error);
            return;
          }
        }
      }
      if (!accepted) return;
    }
    if (!this.disposed) this.status(this.hasPendingChanges() ? "dirty" : "saved");
  }
  async retry(): Promise<void> {
    if (this.disposed || this.currentState === "denied" || this.currentState === "unsupported") return;
    if (!this.connected) await this.connect();
    if (this.connected && this.currentState === "error")
      this.status(this.hasPendingChanges() ? "dirty" : "saved");
    await this.flush();
  }
  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.options.document.off("update", this.capture);
  }
}
