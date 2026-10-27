import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpDocumentTransport } from "../../src/features/editor/client/http-transport";
import { DocumentTransportError } from "../../src/features/editor/model/durable-document-provider";

const pageId = "10000000-0000-4000-8000-000000000001";
const operationId = "20000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());
describe("chunked authenticated document transport", () => {
  it("reports every SQL-safe future schema without decoding its body", async () => {
    const request = vi.fn(async () =>
      Response.json({ revision: 3, schemaVersion: 2147483647, byteLength: 1024 }),
    );
    vi.stubGlobal("fetch", request);
    expect(await new HttpDocumentTransport(pageId).read()).toEqual({
      revision: 3,
      schemaVersion: 2147483647,
      snapshot: new Uint8Array(),
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("assembles bounded chunks from one immutable revision", async () => {
    const bytes = new Uint8Array(600000).map((_, index) => index % 251);
    const offsets: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "http://127.0.0.1");
        if (!url.search) return Response.json({ revision: 4, schemaVersion: 1, byteLength: bytes.length });
        expect(url.searchParams.get("revision")).toBe("4");
        const offset = Number(url.searchParams.get("offset"));
        offsets.push(offset);
        return new Response(bytes.slice(offset, offset + 524288));
      }),
    );
    const result = await new HttpDocumentTransport(pageId).read();
    expect(result.snapshot).toEqual(bytes);
    expect(result.revision).toBe(4);
    expect(offsets.sort((a, b) => a - b)).toEqual([0, 524288]);
  });
  it("restarts a bootstrap when its chunk revision changed", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (!input.includes("?")) {
          reads++;
          return Response.json({ revision: reads, schemaVersion: 1, byteLength: 2 });
        }
        return reads === 1 ? new Response(null, { status: 409 }) : new Response(new Uint8Array([0, 0]));
      }),
    );
    expect(await new HttpDocumentTransport(pageId).read()).toMatchObject({
      revision: 2,
      snapshot: new Uint8Array([0, 0]),
    });
    expect(reads).toBe(2);
  });
  it("preserves operation bytes and converts revoked access into a fixed error", async () => {
    const payload = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, request: RequestInit) => {
        expect(request.method).toBe("POST");
        expect(new Headers(request.headers).get("X-Operation-Id")).toBe(operationId);
        expect(request.body).toEqual(payload);
        return new Response("sensitive backend detail", { status: 403 });
      }),
    );
    await expect(new HttpDocumentTransport(pageId).write({ id: operationId, payload })).rejects.toMatchObject(
      { code: "denied" },
    );
  });
  it("rejects a wrong-length chunk and oversize local operation", async () => {
    const request = vi.fn(async (input: string) =>
      input.includes("?")
        ? new Response(new Uint8Array(3))
        : Response.json({ revision: 1, schemaVersion: 1, byteLength: 2 }),
    );
    vi.stubGlobal("fetch", request);
    await expect(new HttpDocumentTransport(pageId).read()).rejects.toBeInstanceOf(DocumentTransportError);
    const count = request.mock.calls.length;
    await expect(
      new HttpDocumentTransport(pageId).write({ id: operationId, payload: new Uint8Array(262145) }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(request).toHaveBeenCalledTimes(count);
  });
});
