// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/files/[fileId]/route";
import { finishBlockUpload, prepareBlockUpload } from "../../src/features/files/block-actions";
import { withFileValidation } from "../../src/features/files/validation-slots";

const mocks = vi.hoisted(() => {
  const user = vi.fn(),
    single = vi.fn(),
    rpc = vi.fn(),
    signed = vi.fn(),
    download = vi.fn(),
    privilegedRpc = vi.fn();
  const client = {
    auth: { getUser: user },
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ single, eq: () => ({ maybeSingle: single }) }) }) }),
    storage: { from: () => ({ createSignedUploadUrl: signed, download }) },
  };
  return {
    user,
    single,
    rpc,
    signed,
    download,
    privilegedRpc,
    normal: vi.fn(async () => client),
    admin: vi.fn(() => ({ rpc: privilegedRpc, storage: { from: () => ({ download }) } })),
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.normal }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const pageId = "10000000-0000-4000-8000-000000000001",
  fileId = "20000000-0000-4000-8000-000000000001",
  actor = "30000000-0000-4000-8000-000000000001";
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8d8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const metadata = {
  page_id: pageId,
  workspace_id: "40000000-0000-4000-8000-000000000001",
  object_path: "owned/synthetic/file",
  original_name: "Image.png",
  mime_type: "image/png",
  expected_size: png.length,
  actual_size: png.length,
  uploaded_by: actor,
  purpose: "block",
  status: "staging",
  sha256: null,
  image_width: null,
  image_height: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: actor } } });
  mocks.single.mockResolvedValue({ data: metadata, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "get_page_role" ? "editor" : fileId,
    error: null,
  }));
  mocks.download.mockResolvedValue({ data: new Blob([png]), error: null });
  mocks.privilegedRpc.mockResolvedValue({ data: fileId, error: null });
  mocks.signed.mockResolvedValue({
    data: {
      path: metadata.object_path,
      token: "synthetic",
      signedUrl: "https://storage.example.test/upload",
    },
    error: null,
  });
});
describe("block image and attachment boundaries", () => {
  it("normalizes generic declarations and never creates upsert capabilities", async () => {
    const result = await prepareBlockUpload({
      pageId,
      name: "download.svg",
      type: "image/svg+xml",
      size: png.length,
      kind: "file",
    });
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "prepare_block_file",
      expect.objectContaining({ p_mime_type: "application/octet-stream", p_kind: "file" }),
    );
    expect(mocks.signed).toHaveBeenCalledWith(metadata.object_path, { upsert: false });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("checks current edit role before privileged download and hides SDK details", async () => {
    mocks.rpc.mockResolvedValue({ data: "viewer", error: null });
    expect((await finishBlockUpload(fileId)).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.normal.mockRejectedValueOnce(new Error("synthetic-private-secret"));
    expect(JSON.stringify(await finishBlockUpload(fileId))).not.toContain("synthetic-private-secret");
  });
  it("confirms actual image dimensions without touching the page cover RPC", async () => {
    expect(await finishBlockUpload(fileId)).toEqual({
      ok: true,
      value: { fileId, name: "Image.png", mimeType: "image/png", size: png.length, width: 1, height: 1 },
    });
    expect(mocks.privilegedRpc).toHaveBeenCalledWith(
      "finalize_page_block_file",
      expect.objectContaining({
        p_actor_id: actor,
        p_actual_size: png.length,
        p_width: 1,
        p_height: 1,
        p_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });
  it("rejects a huge image header before privileged finalization", async () => {
    const bytes = png.slice();
    new DataView(bytes.buffer).setUint32(16, 16385);
    mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    expect((await finishBlockUpload(fileId)).ok).toBe(false);
    expect(mocks.privilegedRpc).not.toHaveBeenCalledWith("finalize_page_block_file", expect.anything());
  });
  it("keeps arbitrary attachment bytes opaque and returns no invented dimensions", async () => {
    const bytes = new TextEncoder().encode("<html><script>synthetic</script></html>");
    mocks.single.mockResolvedValue({
      data: {
        ...metadata,
        mime_type: "application/octet-stream",
        expected_size: bytes.length,
        actual_size: bytes.length,
      },
      error: null,
    });
    mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    expect(await finishBlockUpload(fileId)).toEqual({
      ok: true,
      value: {
        fileId,
        name: "Image.png",
        mimeType: "application/octet-stream",
        size: bytes.length,
        width: null,
        height: null,
      },
    });
    const response = await GET(new Request("http://127.0.0.1:3001"), { params: Promise.resolve({ fileId }) });
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe(new TextDecoder().decode(bytes));
  });
  it("serves known raster images inline and prevents stale metadata lengths", async () => {
    const response = await GET(new Request("http://127.0.0.1:3001"), { params: Promise.resolve({ fileId }) });
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/);
    mocks.single.mockResolvedValue({ data: { ...metadata, actual_size: 100000 }, error: null });
    expect(
      (await GET(new Request("http://127.0.0.1:3001"), { params: Promise.resolve({ fileId }) })).status,
    ).toBe(404);
  });
  it("shares only two active validation slots and bounds the waiting queue", async () => {
    const release = Promise.withResolvers<void>();
    let running = 0,
      maximum = 0;
    const task = async () => {
      running++;
      maximum = Math.max(maximum, running);
      await release.promise;
      running--;
      return true;
    };
    const jobs = Array.from({ length: 10 }, () => withFileValidation(task));
    await expect(withFileValidation(task)).rejects.toThrow("Aguarde");
    expect(running).toBe(2);
    release.resolve();
    expect(await Promise.all(jobs)).toHaveLength(10);
    expect(maximum).toBe(2);
  });
  it("reserves every malformed staged attempt before download and stops at durable quota", async () => {
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(png.length)]), error: null });
    expect((await finishBlockUpload(fileId)).ok).toBe(false);
    expect((await finishBlockUpload(fileId)).ok).toBe(false);
    expect(mocks.privilegedRpc.mock.calls.map((call) => call[0])).toEqual([
      "reserve_page_file_validation",
      "reserve_page_file_validation",
    ]);
    for (let index = 0; index < 2; index++)
      expect(mocks.privilegedRpc.mock.invocationCallOrder[index]).toBeLessThan(
        mocks.download.mock.invocationCallOrder[index] ?? 0,
      );
    mocks.download.mockClear();
    mocks.privilegedRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "54000", message: "private-internal-detail" },
    });
    expect((await finishBlockUpload(fileId)).ok).toBe(false);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("replays a ready verified receipt with current ACL but no second Storage download", async () => {
    mocks.single.mockResolvedValue({
      data: { ...metadata, status: "ready", sha256: "a".repeat(64), image_width: 1, image_height: 1 },
      error: null,
    });
    expect(await finishBlockUpload(fileId)).toEqual({
      ok: true,
      value: { fileId, name: "Image.png", mimeType: "image/png", size: png.length, width: 1, height: 1 },
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.privilegedRpc).toHaveBeenCalledWith(
      "finalize_page_block_file",
      expect.objectContaining({ p_sha256: "a".repeat(64), p_actual_size: png.length }),
    );
  });
});
