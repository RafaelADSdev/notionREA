// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterchangeJob } from "../../src/features/interchange/model/contracts";
import { validateUiMapping } from "../../src/features/interchange/ui/csv-mapping-editor";
import {
  authorizedUploadUrl,
  InterchangeClient,
  InterchangeQueue,
} from "../../src/features/interchange/ui/job-client";

const workspaceId = "d1000000-0000-4000-8000-000000000001";
const actorId = "d2000000-0000-4000-8000-000000000001";
const id = "d3000000-0000-4000-8000-000000000001";
const operationId = "d4000000-0000-4000-8000-000000000001";
function job(overrides: Partial<InterchangeJob> = {}): InterchangeJob {
  return {
    id,
    workspaceId,
    actorId,
    operationId,
    sourceName: "Arquivo.zip",
    parentId: null,
    kind: "import",
    state: "scanning",
    revision: 0,
    rootPageId: null,
    sourcePath: `${workspaceId}/${actorId}/${id}/source.zip`,
    sourceSize: 2,
    sourceDigest: "a".repeat(64),
    cursor: {},
    report: [],
    confirmed: false,
    createdAt: "2026-10-26T00:00:00Z",
    updatedAt: "2026-10-26T00:00:00Z",
    ...overrides,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("resumable interchange UI transport", () => {
  it("reuses the operation identity after a lost create response", async () => {
    const operations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) => {
        const input = JSON.parse(String(options.body));
        operations.push(input.operationId);
        if (operations.length === 1) throw new Error("Lost response");
        return Response.json({ job: job({ operationId: input.operationId, state: "uploading" }) });
      }),
    );
    const client = new InterchangeClient(workspaceId);
    const input = {
      kind: "import" as const,
      workspaceId,
      parentId: null,
      name: "Arquivo.zip",
      size: 2,
      digest: "a".repeat(64),
    };
    await expect(client.create(input)).rejects.toThrow();
    await client.create(input);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toBe(operations[1]);
  });
  it("never confirms a preview or creates pages as an automatic queue action", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const queue = new InterchangeQueue(new InterchangeClient(workspaceId));
    const result = await queue.run(job({ state: "preview" }), () => {});
    expect(result.reason).toBe("ready");
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds automatic batches and allows cancellation to stop future calls", async () => {
    let revision = 0;
    const request = vi.fn(async () =>
      Response.json({
        job: job({ state: "running", confirmed: true, revision: ++revision }),
        items: [],
        nextIndex: null,
      }),
    );
    vi.stubGlobal("fetch", request);
    const queue = new InterchangeQueue(new InterchangeClient(workspaceId), 2);
    expect((await queue.run(job({ state: "running", confirmed: true }), () => {})).reason).toBe("bounded");
    expect(request).toHaveBeenCalledTimes(2);
    request.mockClear();
    await queue.run(job({ state: "running", confirmed: true }), () => queue.stop());
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("accepts only the current job's signed private upload destination", () => {
    const current = job({ state: "uploading" });
    const path = current.sourcePath;
    const upload = {
      path,
      token: "signed-token",
      signedUrl: `http://127.0.0.1:55321/storage/v1/object/upload/sign/interchange/${path}?token=signed-token`,
    };
    expect(authorizedUploadUrl(current, upload, "http://127.0.0.1:55321")).toBe(upload.signedUrl);
    expect(() =>
      authorizedUploadUrl(
        current,
        { ...upload, signedUrl: upload.signedUrl.replace("127.0.0.1:55321", "foreign.example") },
        "http://127.0.0.1:55321",
      ),
    ).toThrow();
    expect(() =>
      authorizedUploadUrl(current, { ...upload, path: "another-job/source.zip" }, "http://127.0.0.1:55321"),
    ).toThrow();
  });
  it("preflights all twelve mapping types and rejects schema injection before confirmation", () => {
    const mapping = {
      path: "Registros.csv",
      columns: [
        { index: 0, name: "Nome", type: "title", config: {} },
        { index: 1, name: "Texto", type: "text", config: {} },
        { index: 2, name: "Número", type: "number", config: {} },
        { index: 3, name: "Seleção", type: "select", config: { options: [] } },
        { index: 4, name: "Múltipla", type: "multiSelect", config: { options: [] } },
        { index: 5, name: "Data", type: "date", config: { mode: "civil" } },
        { index: 6, name: "Tarefa", type: "checkbox", config: {} },
        { index: 7, name: "URL", type: "url", config: {} },
        { index: 8, name: "Pessoa", type: "person", config: {} },
        { index: 9, name: "Relação", type: "relation", config: { targetDatabaseId: workspaceId } },
        { index: 10, name: "Criado", type: "createdTime", config: {} },
        { index: 11, name: "Editado", type: "editedTime", config: {} },
      ],
    };
    expect(validateUiMapping(mapping).columns).toHaveLength(12);
    expect(() =>
      validateUiMapping({
        ...mapping,
        columns: mapping.columns.map((column) =>
          column.index === 1 ? { ...column, config: { html: "<script>" } } : column,
        ),
      }),
    ).toThrow();
    expect(() => validateUiMapping({ ...mapping, columns: mapping.columns.slice(1) })).toThrow();
  });
});
