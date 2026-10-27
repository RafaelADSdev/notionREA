import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  type DocumentOperation,
  type DocumentTransport,
  DocumentTransportError,
  DurableDocumentProvider,
  type SaveState,
} from "../../src/features/editor/model/durable-document-provider";

const documents: Y.Doc[] = [];
const providers: DurableDocumentProvider[] = [];

function document() {
  const result = new Y.Doc();
  documents.push(result);
  return result;
}

class MemoryTransport implements DocumentTransport {
  readonly document = document();
  readonly attempts: DocumentOperation[] = [];
  readonly accepted = new Map<string, { revision: number; payload: Uint8Array }>();
  revision = 0;
  schemaVersion = 1;
  reads = 0;
  writeHandler: ((operation: DocumentOperation) => Promise<{ revision: number }>) | undefined;

  async read() {
    this.reads++;
    return {
      revision: this.revision,
      schemaVersion: this.schemaVersion,
      snapshot: Y.encodeStateAsUpdate(this.document),
    };
  }

  async write(operation: DocumentOperation) {
    this.attempts.push({ id: operation.id, payload: operation.payload.slice() });
    return this.writeHandler ? this.writeHandler(operation) : this.accept(operation);
  }

  accept(operation: DocumentOperation) {
    const existing = this.accepted.get(operation.id);
    if (existing) {
      expect(operation.payload).toEqual(existing.payload);
      return { revision: existing.revision };
    }
    Y.applyUpdate(this.document, operation.payload);
    this.revision++;
    const result = { revision: this.revision, payload: operation.payload.slice() };
    this.accepted.set(operation.id, result);
    return { revision: result.revision };
  }
}

function fixture(options: { editable?: boolean; initialUpdate?: Uint8Array; debounceMs?: number } = {}) {
  const local = document();
  const transport = new MemoryTransport();
  const statuses: SaveState[] = [];
  let operation = 0;
  const provider = new DurableDocumentProvider({
    document: local,
    transport,
    editable: options.editable ?? true,
    onStatus: (state) => statuses.push(state),
    makeOperationId: () => `operation-${++operation}`,
    ...options,
  });
  providers.push(provider);
  return { local, transport, provider, statuses };
}

afterEach(() => {
  for (const provider of providers.splice(0)) provider.dispose();
  for (const doc of documents.splice(0)) doc.destroy();
  vi.useRealTimers();
});

describe("durable document saving", () => {
  it("catches up to a server merge before finishing a successful write", async () => {
    const { local, provider, transport } = fixture();
    transport.document.getText("body").insert(0, "Base");
    await provider.connect();
    local.getText("body").insert(4, " LOCAL");
    transport.document.getText("body").insert(0, "REMOTE ");
    transport.revision++;
    await provider.flush();
    expect(local.getText("body").toString()).toBe("REMOTE Base LOCAL");
    expect(provider.hasPendingChanges()).toBe(false);
    expect(provider.state).toBe("saved");
  });
  it("preserves a draft while editing permission changes and resumes only when editable", async () => {
    vi.useFakeTimers();
    const { local, provider, transport } = fixture();
    await provider.connect();
    local.getText("body").insert(0, "Keep before permission change");
    provider.setEditable(false);
    await vi.advanceTimersByTimeAsync(1000);
    await provider.flush();
    expect(transport.attempts).toHaveLength(0);
    expect(provider.hasPendingChanges()).toBe(true);
    provider.setEditable(true);
    await provider.flush();
    expect(transport.document.getText("body").toString()).toBe("Keep before permission change");
    expect(provider.state).toBe("saved");
  });
  it("debounces local edits for 500ms and shows saved only after the durable ACK", async () => {
    vi.useFakeTimers();
    const { local, provider, transport, statuses } = fixture();
    const ack = Promise.withResolvers<{ revision: number }>();
    transport.writeHandler = async (operation) => {
      const receipt = transport.accept(operation);
      await ack.promise;
      return receipt;
    };
    await provider.connect();
    local.getText("body").insert(0, "Local draft");
    expect(provider.state).toBe("dirty");
    expect(provider.hasPendingChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(transport.attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.attempts).toHaveLength(1);
    expect(provider.state).toBe("saving");
    expect(provider.hasPendingChanges()).toBe(true);
    expect(statuses.at(-1)).not.toBe("saved");
    ack.resolve({ revision: 1 });
    await provider.flush();
    expect(provider.state).toBe("saved");
    expect(provider.revision).toBe(1);
    expect(provider.hasPendingChanges()).toBe(false);
    expect(transport.document.getText("body").toString()).toBe("Local draft");
  });

  it("retries a lost ACK with the exact operation identity and bytes", async () => {
    const { local, provider, transport } = fixture();
    await provider.connect();
    transport.writeHandler = async (operation) => {
      transport.accept(operation);
      throw new DocumentTransportError("transient");
    };
    local.getText("body").insert(0, "Persist once");
    await provider.flush();
    expect(provider.state).toBe("error");
    expect(provider.hasPendingChanges()).toBe(true);
    expect(transport.accepted.size).toBe(1);
    const first = transport.attempts[0];
    transport.writeHandler = undefined;
    await provider.retry();
    expect(transport.attempts).toHaveLength(2);
    expect(transport.attempts[1]).toEqual(first);
    expect(transport.accepted.size).toBe(1);
    expect(transport.document.getText("body").toString()).toBe("Persist once");
    expect(provider.state).toBe("saved");
    expect(provider.hasPendingChanges()).toBe(false);
  });

  it("waits for every queued ACK before publishing saved", async () => {
    const { local, provider, transport, statuses } = fixture();
    await provider.connect();
    const firstAck = Promise.withResolvers<void>();
    const secondAck = Promise.withResolvers<void>();
    transport.writeHandler = async (operation) => {
      const receipt = transport.accept(operation);
      await (transport.attempts.length === 1 ? firstAck.promise : secondAck.promise);
      return receipt;
    };
    local.getText("body").insert(0, "First");
    const flush = provider.flush();
    await Promise.resolve();
    local.getText("body").insert(5, " second");
    const statusStart = statuses.length;
    firstAck.resolve();
    await vi.waitFor(() => expect(transport.attempts).toHaveLength(2));
    expect(provider.state).toBe("saving");
    expect(provider.hasPendingChanges()).toBe(true);
    expect(statuses.slice(statusStart)).not.toContain("saved");
    secondAck.resolve();
    await flush;
    expect(provider.state).toBe("saved");
    expect(provider.hasPendingChanges()).toBe(false);
  });

  it("retains edits arriving during an unacknowledged write and sends them in a later operation", async () => {
    const { local, provider, transport } = fixture();
    await provider.connect();
    const ack = Promise.withResolvers<{ revision: number }>();
    transport.writeHandler = async (operation) => {
      const receipt = transport.accept(operation);
      if (transport.attempts.length === 1) await ack.promise;
      return receipt;
    };
    local.getText("body").insert(0, "First");
    const flush = provider.flush();
    await Promise.resolve();
    expect(transport.attempts).toHaveLength(1);
    local.getText("body").insert(5, " then second");
    expect(provider.hasPendingChanges()).toBe(true);
    expect(transport.document.getText("body").toString()).toBe("First");
    ack.resolve({ revision: 1 });
    await flush;
    await provider.flush();
    expect(transport.attempts).toHaveLength(2);
    expect(transport.attempts[1]?.id).not.toBe(transport.attempts[0]?.id);
    expect(transport.document.getText("body").toString()).toBe("First then second");
    expect(provider.hasPendingChanges()).toBe(false);
  });

  it("merges concurrent remote edits into the same document without requeueing the remote update", async () => {
    vi.useFakeTimers();
    const { local, provider, transport } = fixture();
    transport.document.getText("body").insert(0, "Base");
    await provider.connect();
    const text = local.getText("body");
    text.insert(text.length, " local");
    transport.document.getText("body").insert(0, "Remote ");
    transport.revision++;
    await provider.synchronize();
    expect(local.getText("body")).toBe(text);
    expect(text.toString()).toContain("Remote ");
    expect(text.toString()).toContain(" local");
    expect(provider.hasPendingChanges()).toBe(true);
    await provider.flush();
    expect(transport.attempts).toHaveLength(1);
    expect(text.toString()).toBe(transport.document.getText("body").toString());
    const writes = transport.attempts.length;
    transport.document.getText("body").insert(0, "Another ");
    transport.revision++;
    await provider.synchronize();
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.attempts).toHaveLength(writes);
    expect(provider.hasPendingChanges()).toBe(false);
    expect(text.toString()).toBe(transport.document.getText("body").toString());
  });

  it("resynchronizes on a conflict and retries the same causal operation without losing either edit", async () => {
    const { local, provider, transport } = fixture();
    transport.document.getText("body").insert(0, "Base");
    await provider.connect();
    local.getText("body").insert(4, " local");
    transport.writeHandler = async (operation) => {
      if (transport.attempts.length === 1) {
        transport.document.getText("body").insert(0, "Remote ");
        transport.revision++;
        throw new DocumentTransportError("conflict");
      }
      return transport.accept(operation);
    };
    await provider.flush();
    expect(transport.reads).toBeGreaterThanOrEqual(2);
    expect(transport.attempts).toHaveLength(2);
    expect(transport.attempts[1]).toEqual(transport.attempts[0]);
    expect(local.getText("body").toString()).toBe("Remote Base local");
    expect(transport.document.getText("body").toString()).toBe("Remote Base local");
    expect(provider.state).toBe("saved");
  });

  it("bounds automatic conflict attempts and keeps the draft available for retry", async () => {
    const { local, provider, transport } = fixture();
    await provider.connect();
    local.getText("body").insert(0, "Keep on conflict");
    transport.writeHandler = async () => {
      throw new DocumentTransportError("conflict");
    };
    await provider.flush();
    expect(transport.attempts).toHaveLength(3);
    expect(provider.state).toBe("error");
    expect(provider.hasPendingChanges()).toBe(true);
    expect(local.getText("body").toString()).toBe("Keep on conflict");
  });

  it("uses the complete provided causal seed for the first write into an empty page", async () => {
    const seed = document();
    seed.getMap("meta").set("schemaVersion", 1);
    seed.getText("body").insert(0, "Initial page");
    const initialUpdate = Y.encodeStateAsUpdate(seed);
    const { local, provider, transport } = fixture({ initialUpdate });
    await provider.connect();
    expect(local.getText("body").toString()).toBe("Initial page");
    expect(provider.hasPendingChanges()).toBe(true);
    await provider.flush();
    expect(transport.attempts).toHaveLength(1);
    expect(transport.attempts[0]?.payload).toEqual(initialUpdate);
    expect(transport.document.getText("body").toString()).toBe("Initial page");
    expect(transport.document.getMap("meta").get("schemaVersion")).toBe(1);
  });

  it("does not apply the creation seed over an existing durable document", async () => {
    const seed = document();
    seed.getText("body").insert(0, "Unused seed");
    const { local, provider, transport } = fixture({ initialUpdate: Y.encodeStateAsUpdate(seed) });
    transport.document.getText("body").insert(0, "Existing content");
    transport.revision = 7;
    await provider.connect();
    await provider.flush();
    expect(local.getText("body").toString()).toBe("Existing content");
    expect(transport.attempts).toHaveLength(0);
    expect(provider.revision).toBe(7);
  });

  it("never writes in read-only mode, including creation seeds and direct local mutations", async () => {
    vi.useFakeTimers();
    const seed = document();
    seed.getText("body").insert(0, "Seed must not create a page");
    const { local, provider, transport } = fixture({
      editable: false,
      initialUpdate: Y.encodeStateAsUpdate(seed),
    });
    await provider.connect();
    expect(local.getText("body").toString()).toBe("");
    local.getText("body").insert(0, "A direct mutation is not authorization");
    await vi.advanceTimersByTimeAsync(1000);
    await provider.flush();
    await provider.retry();
    expect(transport.attempts).toHaveLength(0);
  });

  it("blocks writes for an unsupported schema without erasing a captured local draft", async () => {
    vi.useFakeTimers();
    const { local, provider, transport } = fixture();
    local.getText("body").insert(0, "Keep local draft");
    transport.schemaVersion = 2;
    await provider.connect();
    expect(provider.state).toBe("unsupported");
    await vi.advanceTimersByTimeAsync(1000);
    await provider.flush();
    expect(provider.state).toBe("unsupported");
    expect(transport.attempts).toHaveLength(0);
    expect(local.getText("body").toString()).toBe("Keep local draft");
    expect(provider.hasPendingChanges()).toBe(true);
  });

  it("preserves a denied draft and does not automatically write again after new edits", async () => {
    vi.useFakeTimers();
    const { local, provider, transport } = fixture();
    await provider.connect();
    transport.writeHandler = async () => {
      throw new DocumentTransportError("denied");
    };
    local.getText("body").insert(0, "Copy this draft");
    await provider.flush();
    expect(provider.state).toBe("denied");
    expect(provider.hasPendingChanges()).toBe(true);
    local.getText("body").insert(15, " too");
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.attempts).toHaveLength(1);
    expect(provider.state).toBe("denied");
    expect(local.getText("body").toString()).toBe("Copy this draft too");
  });

  it("leaves transient failures for manual retry while preserving subsequent local edits", async () => {
    vi.useFakeTimers();
    const { local, provider, transport } = fixture();
    await provider.connect();
    transport.writeHandler = async () => {
      throw new DocumentTransportError("transient");
    };
    local.getText("body").insert(0, "Draft");
    await provider.flush();
    local.getText("body").insert(5, " with more edits");
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.attempts).toHaveLength(1);
    expect(provider.state).toBe("error");
    expect(provider.hasPendingChanges()).toBe(true);
    transport.writeHandler = undefined;
    await provider.retry();
    expect(transport.document.getText("body").toString()).toBe("Draft with more edits");
    expect(provider.hasPendingChanges()).toBe(false);
  });

  it("retains an oversized indivisible update and reports an error without sending it", async () => {
    const { local, provider, transport } = fixture();
    await provider.connect();
    const value = "x".repeat(256 * 1024 + 1);
    local.getText("body").insert(0, value);
    await provider.flush();
    expect(transport.attempts).toHaveLength(0);
    expect(provider.state).toBe("error");
    expect(provider.hasPendingChanges()).toBe(true);
    expect(local.getText("body").toString()).toBe(value);
  });

  it("splits a queue of individually bounded causal updates into requests of at most 256KiB", async () => {
    const { local, provider, transport } = fixture();
    await provider.connect();
    for (let index = 0; index < 4; index++) {
      const text = local.getText("body");
      text.insert(text.length, String(index).repeat(100000));
    }
    await provider.flush();
    expect(transport.attempts.length).toBeGreaterThan(1);
    for (const operation of transport.attempts)
      expect(operation.payload.byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(transport.document.getText("body").toString()).toBe(local.getText("body").toString());
    expect(provider.state).toBe("saved");
    expect(provider.hasPendingChanges()).toBe(false);
  });

  it("cancels debounce and unsubscribes on disposal without saving or discarding a pending draft", async () => {
    vi.useFakeTimers();
    const { local, provider, transport } = fixture();
    await provider.connect();
    local.getText("body").insert(0, "Draft before dispose");
    provider.dispose();
    local.getText("body").insert(20, " after");
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.attempts).toHaveLength(0);
    expect(provider.hasPendingChanges()).toBe(true);
    expect(local.getText("body").toString()).toBe("Draft before dispose after");
  });
});
