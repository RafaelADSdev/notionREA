import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { PageCollaboration } from "@/features/collaboration/page-collaboration";
import {
  type CollaborationTransport,
  PresenceDenied,
  type RevisionEvent,
} from "@/features/collaboration/transport";
import {
  DocumentTransportError,
  DurableDocumentProvider,
} from "@/features/editor/model/durable-document-provider";

const actor = "6aeb900c-3d63-4364-9d27-0bb5c874f0b8";
const pageId = "2b67b8b8-8f11-4a43-959b-480f3739c7b3";
function fixture() {
  const doc = new Y.Doc();
  const listeners = new Set<() => void>();
  const read = vi.fn(async () => ({
    revision: 1,
    schemaVersion: 1,
    snapshot: Y.encodeStateAsUpdate(new Y.Doc()),
  }));
  const provider = new DurableDocumentProvider({
    document: doc,
    editable: false,
    transport: { read, write: vi.fn() },
    onStatus: () => {
      for (const listener of listeners) listener();
    },
  });
  const revisionCallbacks: ((event: RevisionEvent) => void)[] = [];
  const presenceCallbacks: ((state: Record<string, unknown[]>) => void)[] = [];
  const closeRevision = vi.fn();
  const closePresence = vi.fn();
  const track = vi.fn(async () => undefined);
  const renew = vi.fn(async () => ({
    epoch: 1,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    participants: [],
  }));
  const transport: CollaborationTransport = {
    revisions: vi.fn((_id, callback) => {
      revisionCallbacks.push(callback);
      return closeRevision;
    }),
    presence: vi.fn((_topic, _key, callback) => {
      presenceCallbacks.push(callback);
      return { close: closePresence, track };
    }),
    renew,
  };
  const controller = new PageCollaboration(
    {
      pageId,
      actor,
      provider,
      getStatus: () => provider.state,
      subscribeStatus: (callback) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
    transport,
  );
  return {
    controller,
    provider,
    doc,
    read,
    transport,
    renew,
    closeRevision,
    closePresence,
    revisionCallbacks,
    presenceCallbacks,
    track,
  };
}
describe("production collaboration lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("renews authorization without amplifying unchanged presence tracks", async () => {
    const f = fixture();
    await f.provider.connect();
    f.controller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.track).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 25; index++) f.controller.publishCursor(null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.renew.mock.calls.length).toBeGreaterThan(1);
    expect(f.track).toHaveBeenCalledTimes(1);
    f.controller.stop();
    f.provider.dispose();
    f.doc.destroy();
  });
  it("distinguishes subscribed from replication readiness and ignores malformed hints", async () => {
    const f = fixture();
    await f.provider.connect();
    f.controller.start();
    f.revisionCallbacks[0]?.({ kind: "subscribed" });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.controller.getSnapshot().connection).toBe("catching-up");
    f.revisionCallbacks[0]?.({ kind: "ready" });
    await vi.advanceTimersByTimeAsync(500);
    expect(f.controller.getSnapshot().connection).toBe("ready");
    const reads = f.read.mock.calls.length;
    f.revisionCallbacks[0]?.({ kind: "revision", payload: { revision: 8, body: "forbidden" } });
    await vi.advanceTimersByTimeAsync(600);
    expect(f.read).toHaveBeenCalledTimes(reads);
    f.revisionCallbacks[0]?.({ kind: "revision", payload: { revision: 8 } });
    await vi.advanceTimersByTimeAsync(600);
    expect(f.read.mock.calls.length).toBeGreaterThan(reads);
    f.controller.stop();
    f.provider.dispose();
    f.doc.destroy();
  });
  it("bounds readiness retries and polls durable storage even when all hints are lost", async () => {
    const f = fixture();
    await f.provider.connect();
    f.controller.start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(f.transport.revisions).toHaveBeenCalledTimes(3);
    expect(f.read.mock.calls.length).toBeGreaterThanOrEqual(4);
    f.controller.stop();
    const reads = f.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.read).toHaveBeenCalledTimes(reads);
    f.provider.dispose();
    f.doc.destroy();
  });
  it("closes presence and subscriptions on current authorized-read denial", async () => {
    const f = fixture();
    await f.provider.connect();
    f.controller.start();
    await vi.advanceTimersByTimeAsync(1);
    f.read.mockRejectedValueOnce(new DocumentTransportError("denied"));
    f.controller.catchUp();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.controller.getSnapshot().connection).toBe("denied");
    expect(f.closeRevision).toHaveBeenCalled();
    expect(f.closePresence).toHaveBeenCalled();
    expect(f.controller.getSnapshot().participants).toEqual([]);
    f.provider.dispose();
    f.doc.destroy();
  });
  it("fails presence closed on missing API and rotates topics only after a renewed lease", async () => {
    const f = fixture();
    await f.provider.connect();
    f.controller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.transport.presence).toHaveBeenCalledWith(
      `page-presence:${pageId}:1`,
      actor,
      expect.any(Function),
    );
    f.renew.mockResolvedValueOnce({
      epoch: 2,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      participants: [],
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.closePresence).toHaveBeenCalled();
    expect(f.transport.presence).toHaveBeenLastCalledWith(
      `page-presence:${pageId}:2`,
      actor,
      expect.any(Function),
    );
    f.renew.mockRejectedValueOnce(new Error("unavailable"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.controller.getSnapshot().presenceAvailable).toBe(false);
    f.controller.stop();
    f.provider.dispose();
    f.doc.destroy();
  });
  it("routes presence denial through the provider and stops pending work", async () => {
    const f = fixture();
    await f.provider.connect();
    f.renew.mockRejectedValueOnce(new PresenceDenied());
    f.read.mockRejectedValueOnce(new DocumentTransportError("denied"));
    f.controller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.provider.state).toBe("denied");
    expect(f.controller.getSnapshot().connection).toBe("denied");
    expect(f.transport.presence).not.toHaveBeenCalled();
    f.provider.dispose();
    f.doc.destroy();
  });
});
