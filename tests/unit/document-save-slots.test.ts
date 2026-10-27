// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentRequestError, saveContentOperation } from "../../src/features/editor/server/documents";

const mocks = vi.hoisted(() => ({ head: vi.fn(), rpc: vi.fn(), validate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.head }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("../../src/features/editor/server/validate-update", () => ({
  validateDocumentUpdate: mocks.validate,
  DocumentValidationError: class extends Error {
    kind = "invalid";
  },
}));
const pageId = "10000000-0000-4000-8000-000000000001",
  actorId = "20000000-0000-4000-8000-000000000001";
const save = (ordinal: number) =>
  saveContentOperation(
    pageId,
    actorId,
    `30000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    new Uint8Array([0, 0]),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  mocks.validate.mockResolvedValue({
    snapshot: new Uint8Array([0, 0]),
    projection: { schemaVersion: 1, text: "", references: [], files: [], blocks: [] },
  });
});
describe("save admission before large snapshot reads", () => {
  it("admits two whole saves, queues eight and rejects overflow before a head is fetched", async () => {
    const release = Promise.withResolvers<void>();
    let active = 0,
      maximum = 0;
    mocks.head.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await release.promise;
        return { data: null, error: null };
      } finally {
        active--;
      }
    });
    const requests = Array.from({ length: 10 }, (_, index) => save(index));
    try {
      await vi.waitFor(() => expect(mocks.head).toHaveBeenCalled());
      expect(mocks.head).toHaveBeenCalledTimes(2);
      await expect(save(20)).rejects.toMatchObject({ status: 503 });
      expect(mocks.head).toHaveBeenCalledTimes(2);
    } finally {
      release.resolve();
      await Promise.allSettled(requests);
    }
    expect(maximum).toBe(2);
    expect(mocks.head).toHaveBeenCalledTimes(10);
  });
  it("releases admission after denied head reads, worker errors and commit failures", async () => {
    for (let index = 0; index < 12; index++) {
      mocks.head.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
      await expect(save(index)).rejects.toMatchObject({ status: 403 });
    }
    mocks.head.mockResolvedValue({ data: null, error: null });
    mocks.validate.mockRejectedValueOnce(new Error("Worker failed"));
    await expect(save(30)).rejects.toMatchObject({ status: 503 });
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "reserve_document_validation"
        ? { data: null, error: null }
        : { data: null, error: { code: "42501" } },
    );
    await expect(save(31)).rejects.toMatchObject({ status: 403 });
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    await expect(save(32)).resolves.toBe(1);
  });
  it("does not run the admitted body when quota reservation has already failed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "54000" } });
    await expect(save(1)).rejects.toBeInstanceOf(DocumentRequestError);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
  });
});
