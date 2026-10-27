// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizePageCover,
  finishCoverUpload,
  prepareCoverUpload,
  prepareFileUpload,
  removeCover,
} from "../../src/features/files/actions";

const mocks = vi.hoisted(() => {
  const user = vi.fn();
  const single = vi.fn();
  const normalRpc = vi.fn();
  const signed = vi.fn();
  const download = vi.fn();
  const privilegedRpc = vi.fn();
  const normal = {
    auth: { getUser: user },
    rpc: normalRpc,
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    storage: { from: () => ({ createSignedUploadUrl: signed }) },
  };
  const privileged = { rpc: privilegedRpc, storage: { from: () => ({ download }) } };
  return {
    user,
    single,
    normalRpc,
    signed,
    download,
    privilegedRpc,
    normal: vi.fn(async () => normal),
    privileged: vi.fn(() => privileged),
    revalidate: vi.fn(),
  };
});

describe("cover UI results remain useful and safe across the production action boundary", () => {
  it("returns actionable image constraints for an unsupported declaration without throwing", async () => {
    const result = await prepareCoverUpload({ pageId, name: "cover.svg", type: "image/svg+xml", size: 24 });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/PNG.*JPEG.*WebP.*GIF.*25 MiB/) });
    expect(mocks.normal).not.toHaveBeenCalled();
  });
  it("does not serialize unexpected SDK exceptions into the UI result", async () => {
    mocks.normal.mockRejectedValueOnce(new Error("synthetic-secret-token-and-private-url"));
    const result = await prepareCoverUpload({ pageId, name: "cover.png", type: "image/png", size: 24 });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Confira seu acesso") });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });
  it("returns the scoped capability on successful preparation", async () => {
    mocks.normalRpc.mockResolvedValue({ data: fileId, error: null });
    mocks.signed.mockResolvedValue({
      data: {
        path: metadata.object_path,
        token: "synthetic",
        signedUrl: "https://storage.example.test/upload",
      },
      error: null,
    });
    expect(await prepareCoverUpload({ pageId, name: "cover.png", type: "image/png", size: 24 })).toEqual({
      ok: true,
      value: {
        fileId,
        path: metadata.object_path,
        token: "synthetic",
        signedUrl: "https://storage.example.test/upload",
      },
    });
  });
  it("returns a retry instruction when uploaded bytes are invalid without committing them", async () => {
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(24)]), error: null });
    expect(await finishCoverUpload(fileId, 1)).toEqual({
      ok: false,
      error: expect.stringMatching(/confirmar.*Recarregue/),
    });
    expect(mocks.privilegedRpc).not.toHaveBeenCalledWith("finalize_page_cover", expect.anything());
  });
  it("returns the new revision after finalization and removal", async () => {
    expect(await finishCoverUpload(fileId, 1)).toEqual({ ok: true, revision: 2 });
    mocks.normalRpc.mockResolvedValue({ data: 3, error: null });
    expect(await removeCover(pageId, 2)).toEqual({ ok: true, revision: 3 });
  });
  it("returns recoverable removal errors without including backend details", async () => {
    mocks.normalRpc.mockResolvedValue({
      data: null,
      error: { message: "synthetic-private-database-detail" },
    });
    const result = await removeCover(pageId, 1);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/remover.*recarregue/) });
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
  });
});
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.normal }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.privileged }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

const actor = "71000000-0000-4000-8000-000000000002";
const fileId = "74000000-0000-4000-8000-000000000001";
const pageId = "73000000-0000-4000-8000-000000000001";
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8d8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const metadata = {
  page_id: pageId,
  workspace_id: "72000000-0000-4000-8000-000000000001",
  object_path: "synthetic/opaque/path",
  mime_type: "image/png",
  expected_size: png.length,
  uploaded_by: actor,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: actor } } });
  mocks.normalRpc.mockResolvedValue({ data: "editor", error: null });
  mocks.single.mockResolvedValue({ data: metadata, error: null });
  mocks.download.mockResolvedValue({ data: new Blob([png]), error: null });
  mocks.privilegedRpc.mockResolvedValue({ data: 2, error: null });
});

describe("cover actions keep the service boundary behind current user authorization", () => {
  it("rejects invalid declarations before reaching authentication or Storage", async () => {
    await expect(prepareFileUpload({ pageId, name: "../x", type: "image/png", size: 24 })).rejects.toThrow();
    expect(mocks.normal).not.toHaveBeenCalled();
    expect(mocks.privileged).not.toHaveBeenCalled();
  });
  it("rejects an expired session before preparing a file", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    await expect(
      prepareFileUpload({ pageId, name: "cover.png", type: "image/png", size: 24 }),
    ).rejects.toThrow("Entre novamente");
    expect(mocks.normalRpc).not.toHaveBeenCalled();
  });
  it("returns only the scoped upload capability after normal-RLS preparation", async () => {
    mocks.normalRpc.mockResolvedValue({ data: fileId, error: null });
    mocks.signed.mockResolvedValue({
      data: {
        path: metadata.object_path,
        token: "synthetic",
        signedUrl: "https://storage.example.test/synthetic",
      },
      error: null,
    });
    expect(await prepareFileUpload({ pageId, name: "cover.png", type: "image/png", size: 24 })).toEqual({
      fileId,
      path: metadata.object_path,
      token: "synthetic",
      signedUrl: "https://storage.example.test/synthetic",
    });
    expect(mocks.signed).toHaveBeenCalledWith(metadata.object_path, { upsert: false });
    expect(mocks.privileged).not.toHaveBeenCalled();
  });
  it("never uses the service client to discover an inaccessible or foreign staging file", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: "synthetic denied" } });
    await expect(finalizePageCover(fileId, 1)).rejects.toThrow("O envio não está disponível");
    expect(mocks.privileged).not.toHaveBeenCalled();
    mocks.single.mockResolvedValue({ data: { ...metadata, uploaded_by: "another-actor" }, error: null });
    await expect(finalizePageCover(fileId, 1)).rejects.toThrow("O envio não está disponível");
    expect(mocks.privileged).not.toHaveBeenCalled();
  });
  it("validates actual bytes before any privileged metadata mutation", async () => {
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(png.length)]), error: null });
    await expect(finalizePageCover(fileId, 1)).rejects.toThrow("válida");
    expect(mocks.privilegedRpc).not.toHaveBeenCalledWith("finalize_page_cover", expect.anything());
  });
  it("commits only the verified file with the actor from the session and expected revision", async () => {
    expect(await finalizePageCover(fileId, 1)).toBe(2);
    expect(mocks.privilegedRpc).toHaveBeenCalledWith("finalize_page_cover", {
      p_file_id: fileId,
      p_actor_id: actor,
      p_expected_revision: 1,
      p_actual_size: png.length,
      p_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
  it("exposes a recoverable conflict without leaking underlying SDK errors", async () => {
    mocks.privilegedRpc.mockImplementation(async (name: string) =>
      name === "reserve_page_file_validation"
        ? { data: null, error: null }
        : { data: null, error: { message: "synthetic-internal-private-error" } },
    );
    await expect(finalizePageCover(fileId, 1)).rejects.toThrow("A página mudou");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("checks the durable validation budget before downloading a cover", async () => {
    await finalizePageCover(fileId, 1);
    expect(mocks.privilegedRpc.mock.calls[0]?.[0]).toBe("reserve_page_file_validation");
    expect(mocks.privilegedRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.download.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("returns a ready cover receipt without downloading or decoding it again", async () => {
    mocks.single.mockResolvedValue({
      data: { ...metadata, status: "ready", actual_size: png.length, sha256: "a".repeat(64) },
      error: null,
    });
    expect(await finalizePageCover(fileId, 1)).toBe(2);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.privilegedRpc).toHaveBeenCalledWith(
      "finalize_page_cover",
      expect.objectContaining({ p_sha256: "a".repeat(64) }),
    );
  });
});
