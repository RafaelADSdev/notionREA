// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { loadTestEnvironment } from "../../scripts/test-stack.mjs";
import type { Database } from "../../src/lib/supabase/database.types";
import { verifyImageBytes } from "../../src/features/files/validation";

const environment = loadTestEnvironment();
if (environment.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55321" || !environment.SUPABASE_SECRET_KEY)
  throw new Error("Storage tests require only the isolated Supabase project.");
const api = environment.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient<Database>(api, environment.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const publicClient = () =>
  createClient<Database>(api, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts: { id: string; email: string; client: ReturnType<typeof publicClient> }[] = [];
const workspaces: { id: string; owner: string; request: string }[] = [];
const objects: { workspace: string; page: string; file: string; path: string }[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5eAAAAAASUVORK5CYII=",
  "base64",
);

async function account() {
  const email = `storage-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error("Synthetic Storage account preparation failed.");
  const client = publicClient();
  const value = { id: data.user.id, email, client };
  accounts.push(value);
  if ((await client.auth.signInWithPassword({ email, password })).error)
    throw new Error("Synthetic Storage account sign-in failed.");
  return value;
}

afterEach(async () => {
  for (const value of objects.splice(0)) {
    if (value.path !== `${value.workspace}/${value.page}/${value.file}`)
      throw new Error("Storage cleanup refused an unowned path.");
    if ((await admin.storage.from("page-assets").remove([value.path])).error)
      throw new Error("Synthetic Storage cleanup failed.");
  }
  for (const value of workspaces.splice(0)) {
    const response = await admin
      .from("workspaces")
      .delete()
      .eq("id", value.id)
      .eq("created_by", value.owner)
      .eq("request_id", value.request);
    if (response.error) throw new Error("Synthetic Storage workspace cleanup failed.");
  }
  for (const value of accounts.splice(0)) {
    await value.client.auth.signOut();
    if ((await admin.auth.admin.deleteUser(value.id)).error)
      throw new Error("Synthetic Storage account cleanup failed.");
  }
});
afterAll(async () => {
  await admin.removeAllChannels();
});

describe("private file lifecycle over the real local Storage API", () => {
  it("keeps signed uploads immutable, validates staging and revokes authenticated download immediately", async () => {
    const owner = await account(),
      viewer = await account();
    const request = randomUUID();
    const created = await owner.client.rpc("create_workspace", {
      p_name: "Storage HTTP fixture",
      p_request_id: request,
    });
    if (created.error || !created.data) throw new Error("Synthetic Storage workspace unavailable.");
    const workspace = created.data;
    workspaces.push({ id: workspace, owner: owner.id, request });
    if (
      (
        await admin
          .from("workspace_members")
          .insert({ workspace_id: workspace, user_id: viewer.id, role: "member" })
      ).error
    )
      throw new Error("Synthetic viewer membership failed.");
    const page = await owner.client.rpc("create_page", {
      p_workspace_id: workspace,
      p_title: "Private cover",
      p_request_id: randomUUID(),
    });
    if (page.error || !page.data) throw new Error("Synthetic cover page unavailable.");
    if (
      (
        await admin
          .from("page_grants")
          .insert({ workspace_id: workspace, page_id: page.data, user_id: viewer.id, role: "viewer" })
      ).error
    )
      throw new Error("Synthetic viewer grant failed.");
    const prepared = await owner.client.rpc("prepare_page_file", {
      p_page_id: page.data,
      p_name: "Cover.png",
      p_mime_type: "image/png",
      p_size: png.length,
    });
    if (prepared.error || !prepared.data) throw new Error("Synthetic upload preparation failed.");
    const metadata = await owner.client
      .from("page_files")
      .select("object_path")
      .eq("id", prepared.data)
      .single();
    if (metadata.error || !metadata.data) throw new Error("Synthetic upload metadata unavailable.");
    const path = metadata.data.object_path;
    objects.push({ workspace, page: page.data, file: prepared.data, path });
    const capability = await owner.client.storage
      .from("page-assets")
      .createSignedUploadUrl(path, { upsert: false });
    expect(capability.error).toBeNull();
    if (!capability.data) throw new Error("Synthetic upload capability unavailable.");
    const anonymous = publicClient();
    expect(
      (
        await anonymous.storage.from("page-assets").uploadToSignedUrl(path, capability.data.token, png, {
          contentType: "image/png",
          cacheControl: "0",
          upsert: false,
        })
      ).error,
    ).toBeNull();
    expect((await viewer.client.from("page_files").select("id").eq("id", prepared.data)).data).toEqual([]);
    expect((await owner.client.storage.from("page-assets").download(path)).error).not.toBeNull();
    const uploaded = await admin.storage.from("page-assets").download(path);
    if (uploaded.error || !uploaded.data) throw new Error("Synthetic uploaded bytes unavailable.");
    const bytes = new Uint8Array(await uploaded.data.arrayBuffer());
    expect(verifyImageBytes(bytes, "image/png", png.length)).toBe("image/png");
    const ready = await admin.rpc("finalize_page_cover", {
      p_file_id: prepared.data,
      p_actor_id: owner.id,
      p_expected_revision: 0,
      p_actual_size: bytes.length,
      p_sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(ready.error).toBeNull();
    expect(ready.data).toBe(1);
    const readable = await viewer.client.storage.from("page-assets").download(path);
    expect(readable.error).toBeNull();
    expect(readable.data?.size).toBe(png.length);
    expect(
      (await viewer.client.storage.from("page-assets").createSignedUrl(path, 3600)).error,
    ).not.toBeNull();
    expect(
      (
        await anonymous.storage
          .from("page-assets")
          .uploadToSignedUrl(path, capability.data.token, Buffer.from("tampered"), {
            contentType: "image/png",
            upsert: true,
          })
      ).error,
    ).not.toBeNull();
    const unchanged = await owner.client.storage.from("page-assets").download(path);
    expect(unchanged.error).toBeNull();
    if (!unchanged.data) throw new Error("Verified synthetic object disappeared.");
    expect(Buffer.from(await unchanged.data.arrayBuffer()).equals(png)).toBe(true);
    if ((await admin.from("page_grants").delete().eq("page_id", page.data).eq("user_id", viewer.id)).error)
      throw new Error("Synthetic viewer revocation failed.");
    expect((await viewer.client.storage.from("page-assets").download(path)).error).not.toBeNull();
    expect((await viewer.client.from("page_files").select("id").eq("id", prepared.data)).data).toEqual([]);
    expect(
      (await owner.client.rpc("clear_page_cover", { p_page_id: page.data, p_expected_revision: 1 })).data,
    ).toBe(2);
  });
});
