import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

const fixtures = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), user: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: fixtures.client, currentUser: fixtures.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: fixtures.admin }));
vi.mock("@/lib/env", () => ({
  getEnvironment: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" }),
}));
vi.mock("../../src/features/interchange/server/export", () => ({ runExport: vi.fn() }));
vi.mock("@/features/files/block-actions", () => ({ finishBlockUpload: vi.fn() }));

import { type InterchangeJob, jobSchema } from "../../src/features/interchange/model/contracts";
import { runExport } from "../../src/features/interchange/server/export";
import { type InterchangeClient, JobRepository, rpc } from "../../src/features/interchange/server/repository";
import { commandInterchange } from "../../src/features/interchange/server/service";
import { planTemplateCopy } from "../../src/features/interchange/server/template-copy";

const id = "a1000000-0000-4000-8000-000000000001",
  sourceId = "a1000000-0000-4000-8000-000000000002",
  targetId = "a1000000-0000-4000-8000-000000000003";
function job(kind: InterchangeJob["kind"] = "export") {
  return jobSchema.parse({
    id,
    workspaceId: id,
    actorId: id,
    operationId: id,
    sourceName: "Synthetic",
    parentId: targetId,
    kind,
    state: "running",
    revision: 0,
    rootPageId: sourceId,
    sourcePath: "source.zip",
    sourceSize: 0,
    sourceDigest: "",
    cursor: { phase: "export", zipOffset: 321 },
    report: [],
    confirmed: true,
    createdAt: "2026-10-26T00:00:00Z",
    updatedAt: "2026-10-26T00:00:00Z",
  });
}
type Result = { data: unknown; error: { code: string } | null; status: number };
function client(
  handler: (name: string, args: Record<string, unknown>) => Promise<Result>,
): InterchangeClient {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    abortSignal: async () => ({
      error: null,
      data: [
        { page_id: sourceId, is_template: true, workspace_id: id },
        { page_id: targetId, is_template: false, workspace_id: id },
      ],
    }),
  };
  return {
    rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: () => handler(name, args) }),
    from: () => query,
    storage: {
      from: () => ({
        download: async () => ({ error: { status: 404 }, data: null }),
        createSignedUploadUrl: async () => ({
          error: null,
          data: {
            signedUrl: "http://127.0.0.1:55321/storage/v1/object/upload/sign/interchange/owned",
            path: "owned",
            token: "synthetic",
          },
        }),
      }),
    },
  } as unknown as InterchangeClient;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("distinguishes transport status zero/5xx/throws from SQL validation, access, conflict and quota", async () => {
  for (const failure of [
    { status: 0, code: "", expected: 503 },
    { status: 503, code: "", expected: 503 },
    { status: 504, code: "", expected: 503 },
    { status: 400, code: "22023", expected: 422 },
    { status: 403, code: "42501", expected: 403 },
    { status: 409, code: "40001", expected: 409 },
    { status: 400, code: "54000", expected: 429 },
  ]) {
    const connection = client(async () => ({
      data: null,
      error: { code: failure.code },
      status: failure.status,
    }));
    await expect(
      rpc(connection, "read_interchange_items", { p_job_id: id, p_actor_id: id, p_lease_id: id }),
    ).rejects.toMatchObject({ status: failure.expected });
  }
  for (const failure of [
    new DOMException("Private timeout details", "TimeoutError"),
    new TypeError("fetch failed"),
  ]) {
    await expect(
      rpc(
        client(async () => {
          throw failure;
        }),
        "read_interchange_items",
        { p_job_id: id, p_actor_id: id, p_lease_id: id },
      ),
    ).rejects.toMatchObject({ status: 503 });
  }
});

it("preserves job progress and releases the lease on lost RPC ACK or PUT timeout while SQL validation remains terminal", async () => {
  for (const mode of ["lost-ack", "http-503", "put-timeout", "sql-invalid"]) {
    const original = job(),
      writes: Record<string, unknown>[] = [];
    const connection = client(async (name, args) => {
      if (name === "write_interchange_job") {
        writes.push(args);
        return {
          data: { ...original, state: args.p_state, cursor: args.p_cursor, report: args.p_report },
          error: null,
          status: 200,
        };
      }
      return {
        data: null,
        error: { code: mode === "sql-invalid" ? "22023" : "" },
        status: mode === "sql-invalid" ? 400 : mode === "http-503" ? 503 : 0,
      };
    });
    fixtures.admin.mockReturnValue(connection);
    fixtures.client.mockResolvedValue(connection);
    fixtures.user.mockResolvedValue({ id });
    const repo = new JobRepository(connection, id, original);
    vi.spyOn(JobRepository, "claim").mockResolvedValue(repo);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Private signed capability", "TimeoutError")),
    );
    vi.mocked(runExport).mockImplementation(async () => {
      if (mode === "put-timeout") await repo.upload(repo.path("test.part"), new Uint8Array([1]));
      else await rpc(connection, "read_interchange_items", repo.args());
    });
    await expect(commandInterchange(id, { action: "run" })).rejects.toMatchObject({
      status: mode === "sql-invalid" ? 422 : 503,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      p_state: mode === "sql-invalid" ? "error" : "running",
      p_cursor: original.cursor,
      p_release: true,
    });
  }
});

it("keeps template planning transport failures resumable and records invalid source plans as terminal", async () => {
  for (const mode of ["transport", "invalid-plan"]) {
    const original = job("templateCopy"),
      writes: Record<string, unknown>[] = [];
    const connection = client(async (name, args) => {
      if (name === "write_interchange_job") {
        writes.push(args);
        return {
          data: { ...original, state: args.p_state, cursor: args.p_cursor, report: args.p_report },
          error: null,
          status: 200,
        };
      }
      return { data: original, error: null, status: 200 };
    });
    fixtures.admin.mockReturnValue(connection);
    fixtures.client.mockResolvedValue(connection);
    fixtures.user.mockResolvedValue({ id });
    const repo = new JobRepository(connection, id, original);
    vi.spyOn(JobRepository, "claim").mockResolvedValue(repo);
    const invalid = z.string().safeParse(123);
    if (invalid.success) throw Error("Invalid fixture");
    vi.spyOn(repo, "optionalDownload").mockRejectedValue(
      mode === "transport" ? new DOMException("Network timeout", "TimeoutError") : invalid.error,
    );
    await expect(
      planTemplateCopy({
        databaseId: id,
        sourcePageId: sourceId,
        targetPageId: targetId,
        actorId: id,
        operationId: id,
      }),
    ).rejects.toMatchObject({ status: mode === "transport" ? 503 : 422 });
    expect(writes[0]).toMatchObject({ p_state: mode === "transport" ? "running" : "error", p_release: true });
  }
});
