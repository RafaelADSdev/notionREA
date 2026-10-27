import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { type InterchangeItem, jobSchema } from "../../src/features/interchange/model/contracts";
import { runExport } from "../../src/features/interchange/server/export";
import {
  type InterchangeClient,
  InterchangeError,
  JobRepository,
} from "../../src/features/interchange/server/repository";

it("reuses the persisted ZIP directory after failure before saving completion", async () => {
  const id = "a1000000-0000-4000-8000-000000000001";
  const repo = new JobRepository(
    {} as InterchangeClient,
    id,
    jobSchema.parse({
      id,
      workspaceId: id,
      actorId: id,
      operationId: id,
      sourceName: "Export",
      parentId: null,
      kind: "export",
      state: "running",
      revision: 0,
      rootPageId: id,
      sourcePath: "source.zip",
      sourceSize: 0,
      sourceDigest: "",
      cursor: { phase: "export", zipOffset: 0 },
      report: [],
      confirmed: true,
      createdAt: "2026-10-26T00:00:00Z",
      updatedAt: "2026-10-26T00:00:00Z",
    }),
  );
  const items = new Map<string, InterchangeItem>(),
    objects = new Map<string, Buffer>();
  vi.spyOn(repo, "get").mockImplementation(async (key) => items.get(key) ?? null);
  vi.spyOn(repo, "all").mockImplementation(async (kind) =>
    [...items.values()].filter((item) => item.kind === kind),
  );
  vi.spyOn(repo, "check").mockResolvedValue();
  vi.spyOn(repo, "append").mockImplementation(async (key, kind, payload, state = "pending") => {
    const old = items.get(key);
    if (old) return old;
    const item: InterchangeItem = {
      key,
      kind,
      payload,
      state,
      index: items.size,
      pageId: null,
      databaseId: null,
      fileId: null,
    };
    items.set(key, item);
    // Match put_interchange_item's atomic part receipt and offset increment.
    if (kind === "zipPart")
      repo.job.cursor.zipOffset = Number(repo.job.cursor.zipOffset) + Number(payload.bytes);
    return item;
  });
  const upload = vi.spyOn(repo, "upload").mockImplementation(async (path, bytes) => {
    const old = objects.get(path);
    if (old && !old.equals(Buffer.from(bytes))) throw new InterchangeError("object-receipt-conflict", 409);
    objects.set(path, Buffer.from(bytes));
  });
  vi.spyOn(repo, "save")
    .mockRejectedValueOnce(Error("Process stopped before completion ACK"))
    .mockImplementation(async (state, cursor) => {
      repo.job = { ...repo.job, state, cursor };
    });
  await expect(runExport(repo)).rejects.toThrow("Process stopped before completion ACK");
  const directory = items.get("part:directory");
  expect(directory).toBeDefined();
  const stored = objects.get(String(directory?.payload.objectPath));
  if (!stored) throw Error("Directory was not persisted");
  const originalOffset = stored.readUInt32LE(stored.length - 6),
    advancedOffset = Number(repo.job.cursor.zipOffset);
  expect(advancedOffset).toBe(originalOffset + stored.length);
  await expect(runExport(repo)).resolves.toBeUndefined();
  expect(repo.job.state).toBe("complete");
  expect(repo.job.cursor.zipOffset).toBe(advancedOffset);
  expect(objects.get(String(directory?.payload.objectPath))).toEqual(stored);
  expect(upload.mock.calls.filter(([path]) => path === directory?.payload.objectPath)).toHaveLength(1);
});
