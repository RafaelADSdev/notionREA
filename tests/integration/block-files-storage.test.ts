// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, it } from "vitest";
import { loadTestEnvironment } from "../../scripts/test-stack.mjs";
import { verifyImageDimensions } from "../../src/features/files/image-dimensions";
import type { Database } from "../../src/lib/supabase/database.types";

const environment = loadTestEnvironment();
if (environment.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55321" || !environment.SUPABASE_SECRET_KEY)
  throw new Error("Block Storage proof requires the isolated synthetic stack.");
const api = environment.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient<Database>(api, environment.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const accounts: { id: string; client: ReturnType<typeof client> }[] = [],
  scopes: { id: string; owner: string }[] = [],
  objects: { workspace: string; page: string; file: string; path: string }[] = [];
function client() {
  return createClient<Database>(api, environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function account() {
  const email = `block-storage-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user)
    throw new Error("Could not create synthetic block Storage account.");
  const value = { id: created.data.user.id, client: client() };
  accounts.push(value);
  if ((await value.client.auth.signInWithPassword({ email, password })).error)
    throw new Error("Synthetic sign-in failed.");
  return value;
}
afterEach(async () => {
  for (const value of objects.splice(0)) {
    if (value.path !== `${value.workspace}/${value.page}/${value.file}`)
      throw new Error("Refusing unowned Storage cleanup.");
    if ((await admin.storage.from("page-assets").remove([value.path])).error)
      throw new Error("Synthetic Storage cleanup failed.");
  }
  for (const scope of scopes.splice(0))
    if ((await admin.from("workspaces").delete().eq("id", scope.id).eq("created_by", scope.owner)).error)
      throw new Error("Synthetic workspace cleanup failed.");
  for (const value of accounts.splice(0)) {
    await value.client.auth.signOut();
    if ((await admin.auth.admin.deleteUser(value.id)).error)
      throw new Error("Synthetic account cleanup failed.");
  }
});
it("uploads immutable block images and opaque attachments without changing covers, then revokes both", async () => {
  const owner = await account(),
    viewer = await account();
  const created = await owner.client.rpc("create_workspace", {
    p_name: "Block Storage fixture",
    p_request_id: randomUUID(),
  });
  if (created.error || !created.data) throw new Error("Synthetic workspace unavailable.");
  const workspace = created.data;
  scopes.push({ id: workspace, owner: owner.id });
  if (
    (
      await admin
        .from("workspace_members")
        .insert({ workspace_id: workspace, user_id: viewer.id, role: "member" })
    ).error
  )
    throw new Error("Synthetic membership unavailable.");
  const page = await owner.client.rpc("create_page", {
    p_workspace_id: workspace,
    p_title: "Block images and downloads",
    p_request_id: randomUUID(),
  });
  if (page.error || !page.data) throw new Error("Synthetic page unavailable.");
  const pageId = page.data;
  if (
    (
      await admin
        .from("page_grants")
        .insert({ workspace_id: workspace, page_id: pageId, user_id: viewer.id, role: "viewer" })
    ).error
  )
    throw new Error("Synthetic grant unavailable.");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8d8AAAAASUVORK5CYII=",
    "base64",
  );
  const attachment = Buffer.from("<html><script>opaque synthetic attachment</script></html>");
  for (const fixture of [
    { kind: "image" as const, type: "image/png", bytes: png, name: "Synthetic.png" },
    { kind: "file" as const, type: "text/html", bytes: attachment, name: "Synthetic.html" },
  ]) {
    const prepared = await owner.client.rpc("prepare_block_file", {
      p_page_id: pageId,
      p_name: fixture.name,
      p_mime_type: fixture.type,
      p_size: fixture.bytes.length,
      p_kind: fixture.kind,
    });
    expect(prepared.error).toBeNull();
    if (!prepared.data) throw new Error("Synthetic block preparation failed.");
    const fileId = prepared.data;
    const metadata = await owner.client
      .from("page_files")
      .select("object_path,mime_type,purpose")
      .eq("id", fileId)
      .single();
    if (metadata.error || !metadata.data) throw new Error("Synthetic block metadata unavailable.");
    const path = metadata.data.object_path;
    objects.push({ workspace, page: pageId, file: fileId, path });
    expect(metadata.data.purpose).toBe("block");
    expect(metadata.data.mime_type).toBe(fixture.kind === "file" ? "application/octet-stream" : "image/png");
    const capability = await owner.client.storage
      .from("page-assets")
      .createSignedUploadUrl(path, { upsert: false });
    if (capability.error || !capability.data) throw new Error("Synthetic upload capability unavailable.");
    const anonymous = client();
    expect(
      (
        await anonymous.storage
          .from("page-assets")
          .uploadToSignedUrl(path, capability.data.token, fixture.bytes, {
            contentType: metadata.data.mime_type,
            upsert: false,
          })
      ).error,
    ).toBeNull();
    expect((await viewer.client.storage.from("page-assets").download(path)).error).not.toBeNull();
    const reserved = await admin.rpc("reserve_page_file_validation", {
      p_file_id: fileId,
      p_actor_id: owner.id,
    });
    expect(reserved.error).toBeNull();
    const actual = await admin.storage.from("page-assets").download(path);
    if (actual.error || !actual.data) throw new Error("Synthetic object unavailable.");
    const bytes = new Uint8Array(await actual.data.arrayBuffer()),
      dimensions = fixture.kind === "image" ? verifyImageDimensions(bytes, fixture.type) : null;
    const finalized = await admin.rpc("finalize_page_block_file", {
      p_file_id: fileId,
      p_actor_id: owner.id,
      p_actual_size: bytes.length,
      p_sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(dimensions ? { p_width: dimensions.width, p_height: dimensions.height } : {}),
    });
    expect(finalized.error).toBeNull();
    expect(finalized.data).toBe(fileId);
    const downloaded = await viewer.client.storage.from("page-assets").download(path);
    expect(downloaded.error).toBeNull();
    if (!downloaded.data) throw new Error("Verified object unavailable.");
    expect(Buffer.from(await downloaded.data.arrayBuffer())).toEqual(fixture.bytes);
    expect(
      (await viewer.client.storage.from("page-assets").createSignedUrl(path, 3600)).error,
    ).not.toBeNull();
    expect(
      (
        await anonymous.storage
          .from("page-assets")
          .uploadToSignedUrl(path, capability.data.token, Buffer.from("changed"), {
            contentType: metadata.data.mime_type,
            upsert: true,
          })
      ).error,
    ).not.toBeNull();
  }
  const metadata = await owner.client.rpc("get_page_metadata", {
    p_page_id: pageId,
    p_workspace_id: workspace,
  });
  expect(metadata.error).toBeNull();
  expect(metadata.data).toMatchObject({ revision: 0, cover_file_id: null });
  if ((await admin.from("page_grants").delete().eq("page_id", pageId).eq("user_id", viewer.id)).error)
    throw new Error("Synthetic revoke failed.");
  for (const value of objects)
    expect((await viewer.client.storage.from("page-assets").download(value.path)).error).not.toBeNull();
});
