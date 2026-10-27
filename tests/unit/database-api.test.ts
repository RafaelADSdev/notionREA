// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
  currentUser: mocks.user,
}));
vi.mock("@/lib/env", () => ({ getEnvironment: () => ({ APP_URL: "http://127.0.0.1:3001" }) }));

import { GET as people } from "../../src/app/api/databases/[databaseId]/people/route";
import { GET as recordPage } from "../../src/app/api/databases/[databaseId]/records/[pageId]/route";
import { GET, POST } from "../../src/app/api/databases/[databaseId]/route";
import { GET as list } from "../../src/app/api/databases/route";

const db = "b1000000-0000-4000-8000-000000000001";
const page = "b2000000-0000-4000-8000-000000000001";
const workspace = "b3000000-0000-4000-8000-000000000001";
const title = "b4000000-0000-4000-8000-000000000001";
const number = "b4000000-0000-4000-8000-000000000002";
const system = "b4000000-0000-4000-8000-000000000003";
const view = "b5000000-0000-4000-8000-000000000001";
const record = "b6000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ databaseId: db }) };
const metadata = () => ({
  id: db,
  pageId: page,
  workspaceId: workspace,
  revision: 4,
  role: "owner",
  properties: [
    { id: title, name: "Nome", type: "title", config: {}, revision: 0, position: "A" },
    { id: number, name: "Número", type: "number", config: {}, revision: 0, position: "B" },
    { id: system, name: "Criado", type: "createdTime", config: {}, revision: 0, position: "C" },
  ],
  views: [
    {
      id: view,
      name: "Tabela",
      type: "table",
      revision: 0,
      position: "A",
      config: {
        visibleProperties: [title, number],
        sorts: [],
        filter: null,
        groupBy: null,
        datePropertyId: null,
      },
    },
  ],
  templates: [],
});
function request(body: unknown, origin = "http://127.0.0.1:3001") {
  return new NextRequest(`http://127.0.0.1:3001/api/databases/${db}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: "b7000000-0000-4000-8000-000000000001" });
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    const data =
      name === "get_database_metadata"
        ? metadata()
        : name === "get_page_metadata"
          ? {
              id: page,
              workspace_id: workspace,
              title: "Projetos",
              icon: "",
              parent_id: null,
              position: "A",
              revision: 0,
              cover_file_id: null,
            }
          : name === "query_database_records"
            ? { rows: [], nextCursor: null, queryKey: "a".repeat(64), revision: 4, viewId: view }
            : name === "put_database_cell"
              ? 1
              : [];
    return { data, error: null };
  });
  mocks.from.mockReset();
});

describe("authenticated bounded database HTTP adapters", () => {
  it("rejects cross-origin writes before authentication or RPC calls", async () => {
    const response = await POST(request({ action: "cell" }, "https://foreign.example"), context);
    expect(response.status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires an authenticated user for reads and returns private no-store responses", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await GET(new NextRequest(`http://127.0.0.1:3001/api/databases/${db}`), context);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds actual JSON bytes even when content-length is absent", async () => {
    const response = await POST(request({ action: "query", filler: "x".repeat(262145) }), context);
    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("flattens validated metadata views and returns the direct DatabaseData contract", async () => {
    const response = await GET(new NextRequest(`http://127.0.0.1:3001/api/databases/${db}`), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: db,
      title: "Projetos",
      editable: true,
      viewId: view,
      rows: [],
      views: [{ id: view, visibleProperties: [title, number], sorts: [], filter: null }],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("uses the model normalizer before sending a precise decimal and cell CAS", async () => {
    const response = await POST(
      request({
        action: "cell",
        recordId: record,
        propertyId: number,
        value: "00012.500",
        expectedRevision: 0,
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revision: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("put_database_cell", {
      p_database_id: db,
      p_page_id: record,
      p_property_id: number,
      p_value: "12.5",
      p_expected_revision: 0,
    });
  });
  it("refuses system writes and unsafe values before invoking a mutation RPC", async () => {
    const response = await POST(
      request({
        action: "cell",
        recordId: record,
        propertyId: system,
        value: "2026-10-26T00:00:00.000Z",
        expectedRevision: 0,
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "get_database_metadata")).toBe(true);
  });
  it("rejects malformed opaque cursors before running the record query", async () => {
    const response = await POST(request({ action: "query", cursor: "%%%" }), context);
    expect(response.status).toBe(400);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "query_database_records")).toBe(false);
  });
  it("maps SQL conflicts to a fixed message without exposing backend text", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "get_database_metadata"
        ? { data: metadata(), error: null }
        : { data: null, error: { code: "40001", message: "private SQL details" } },
    );
    const response = await POST(
      request({ action: "cell", recordId: record, propertyId: number, value: "2", expectedRevision: 0 }),
      context,
    );
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("private SQL");
  });
  it("lists only bounded references, with opaque cursors instead of raw SQL inputs", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: db, pageId: page, title: "Projetos" }], error: null });
    const response = await list(
      new NextRequest(`http://127.0.0.1:3001/api/databases?workspaceId=${workspace}&query=Proj`),
    );
    expect(await response.json()).toEqual({ items: [{ id: db, label: "Projetos" }], nextCursor: null });
    expect(mocks.rpc).toHaveBeenCalledWith("list_databases", { p_workspace_id: workspace, p_query: "Proj" });
  });
  it("paginates people without returning e-mail fields and scopes the next cursor", async () => {
    mocks.rpc.mockResolvedValue({
      data: Array.from({ length: 51 }, (_, index) => ({
        id: `b8000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        label: `Pessoa ${index + 1}`,
      })),
      error: null,
    });
    const first = await people(new NextRequest(`http://127.0.0.1:3001/api/databases/${db}/people`), context);
    const body = await first.json();
    expect(body.items).toHaveLength(50);
    expect(body.items[0]).toEqual({ id: "b8000000-0000-4000-8000-000000000001", label: "Pessoa 1" });
    expect(typeof body.nextCursor).toBe("string");
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await people(
      new NextRequest(`http://127.0.0.1:3001/api/databases/${db}/people?cursor=${body.nextCursor}`),
      context,
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith("database_people", {
      p_database_id: db,
      p_after_id: "b8000000-0000-4000-8000-000000000050",
    });
  });
  it("loads template-record cells with separate page/title, cell and ordering revisions", async () => {
    const previous = mocks.rpc.getMockImplementation();
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_page_role") return { data: "viewer", error: null };
      if (name === "get_page_metadata" && args.p_page_id === record)
        return {
          data: {
            id: record,
            workspace_id: workspace,
            title: "Modelo",
            icon: "",
            parent_id: null,
            position: "A",
            revision: 7,
            cover_file_id: null,
          },
          error: null,
        };
      return previous?.(name, args);
    });
    mocks.from.mockImplementation((table: string) => {
      const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), maybeSingle: vi.fn() };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.order.mockReturnValue(chain);
      chain.range.mockResolvedValue({
        data: [{ property_id: number, value: "9", revision: 5 }],
        error: null,
      });
      chain.maybeSingle.mockResolvedValue({
        data:
          table === "database_records"
            ? { page_id: record, position: "Z", revision: 3, is_template: true }
            : { created_at: "2026-10-26T00:00:00.000Z", updated_at: "2026-10-26T01:00:00.000Z" },
        error: null,
      });
      return chain;
    });
    const response = await recordPage(
      new NextRequest(`http://127.0.0.1:3001/api/databases/${db}/records/${record}`),
      { params: Promise.resolve({ databaseId: db, pageId: record }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.row).toMatchObject({
      id: record,
      revision: 3,
      values: { [title]: "Modelo", [number]: "9" },
      cellRevisions: { [title]: 7, [number]: 5 },
    });
    expect(body.data).toMatchObject({ rows: [], nextCursor: null, editable: false });
  });
});
