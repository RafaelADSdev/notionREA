import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { StablePage } from "../src/features/editor/model/stable-page";
import type { Database } from "../src/lib/supabase/database.types";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY;
if (process.env.BLOCO_TEST_STACK !== "bloco-test" || api !== "http://127.0.0.1:55321" || !key)
  throw new Error("Collaboration acceptance requires isolated synthetic accounts.");
const admin = createClient<Database>(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const users: string[] = [],
  contexts: BrowserContext[] = [],
  objects: string[] = [];
const origin = "http://127.0.0.1:3001";
async function account(name: string) {
  const email = `collaboration-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const result = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (result.error || !result.data.user) throw new Error("Synthetic collaboration account failed.");
  users.push(result.data.user.id);
  return { id: result.data.user.id, email, password };
}
async function login(page: Page, user: Awaited<ReturnType<typeof account>>) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:workspaces\/new|w\/[a-f0-9-]+)$/);
}
test.afterAll(async () => {
  for (const context of contexts) await context.close();
  if (objects.length) await admin.storage.from("page-assets").remove(objects);
  for (const id of users) {
    const workspace = await admin.from("workspaces").delete().eq("created_by", id);
    if (workspace.error) throw new Error("Synthetic workspace cleanup failed.");
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error) throw new Error("Synthetic account cleanup failed.");
  }
});
test("peers converge, comments follow roles, and public content and files revoke immediately", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const diagnostics: object[] = [];
  const observe = (surface: Page) => {
    surface.on("response", (response) => {
      if (/\/api\/(?:realtime\/session|pages\/[a-f0-9-]+\/presence)$/.test(new URL(response.url()).pathname))
        diagnostics.push({ kind: "http", path: new URL(response.url()).pathname, status: response.status() });
    });
    surface.on("websocket", (socket) => {
      const frame = (direction: string, value: string | Buffer) => {
        if (diagnostics.length > 120) return;
        try {
          const raw = JSON.parse(String(value)),
            data = Array.isArray(raw) ? { event: raw[3], topic: raw[2], payload: raw[4] } : raw;
          const reason = String(data.payload?.response?.reason ?? data.payload?.message ?? "")
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
            .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted]")
            .slice(0, 250);
          diagnostics.push({
            kind: "socket",
            direction,
            event: data.event,
            topic: data.topic,
            status: data.payload?.status,
            authenticated:
              direction === "sent" && data.event === "phx_join"
                ? Boolean(data.payload?.access_token)
                : undefined,
            reason,
          });
        } catch {
          /* Binary frames and payloads are never logged. */
        }
      };
      socket.on("framesent", (event) => frame("sent", event.payload));
      socket.on("framereceived", (event) => frame("received", event.payload));
    });
  };
  observe(page);
  const owner = await account("Pessoa A"),
    peer = await account("Pessoa B");
  await login(page, owner);
  await page.getByLabel("Nome do workspace").fill("Caderno coletivo");
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2] ?? "";
  const member = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: peer.id, role: "member" });
  expect(member.error).toBeNull();
  await page.getByRole("button", { name: "Nova página", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+\/p\/[a-f0-9-]+\?new=1$/);
  const pageId = new URL(page.url()).pathname.split("/").at(-1) ?? "",
    path = `/w/${workspaceId}/p/${pageId}`,
    endpoint = `/api/pages/${pageId}/sharing`;
  await expect(page.getByRole("textbox", { name: "Texto do bloco", exact: true })).toHaveCount(1);
  const sharing = async (role: "editor" | "viewer" | null) => {
    const metadata = await page.request.get(endpoint);
    expect(metadata.status()).toBe(200);
    const current = await metadata.json();
    const body = {
      action: "access",
      expectedRevision: current.revision,
      restricted: true,
      workspaceRole: null,
      ownerId: owner.id,
      grants: role ? [{ userId: peer.id, role }] : [],
    };
    let response = await page.request.post(endpoint, { headers: { Origin: origin }, data: body });
    expect(response.status(), await response.text()).toBe(200);
    let result = await response.json();
    if (result.requiresConfirmation) {
      response = await page.request.post(endpoint, {
        headers: { Origin: origin },
        data: { ...body, confirm: true, previewToken: result.previewToken },
      });
      expect(response.status(), await response.text()).toBe(200);
      result = await response.json();
    }
    expect(result.requiresConfirmation).toBe(false);
  };
  await sharing("editor");
  const peerContext = await browser.newContext();
  contexts.push(peerContext);
  const other = await peerContext.newPage();
  observe(other);
  await login(other, peer);
  await other.goto(path);
  const first = page.getByRole("textbox", { name: "Texto do bloco", exact: true }),
    second = other.getByRole("textbox", { name: "Texto do bloco", exact: true });
  await expect(second).toHaveCount(1);
  await Promise.all([first.fill("Ideia A"), second.fill("Ideia B")]);
  await expect.poll(async () => (await first.textContent()) ?? "", { timeout: 20000 }).toContain("Ideia B");
  await expect.poll(async () => (await second.textContent()) ?? "", { timeout: 20000 }).toContain("Ideia A");
  await expect.poll(async () => first.textContent()).toBe(await second.textContent());
  for (const surface of [page, other])
    await surface.route(new RegExp(`/api/documents/${pageId}(?:\\?|$)`), async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await route.fulfill({ response });
    });
  const propagation: number[] = [];
  for (let iteration = 0; iteration < 5; iteration++) {
    const marker = ` R${iteration}`;
    const ack = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/documents/${pageId}` &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );
    await first.press("End");
    await first.pressSequentially(marker);
    await ack;
    const started = performance.now();
    await expect
      .poll(async () => second.textContent(), { timeout: 1000, intervals: [10, 20, 50] })
      .toContain(marker);
    propagation.push(performance.now() - started);
  }
  const p95 = [...propagation].sort((a, b) => a - b).at(-1) ?? Infinity;
  expect(p95).toBeLessThanOrEqual(1000);
  console.info(
    JSON.stringify({
      metric: "ack-to-peer-visible",
      addedHttpDelayMs: 50,
      samples: propagation.length,
      p95Ms: Math.round(p95),
    }),
  );
  await expect(page.locator(".collaborators"), JSON.stringify(diagnostics)).toContainText("Pessoa B", {
    timeout: 20000,
  });
  await first.press("Home");
  await first.press("ArrowRight");
  await expect(other.locator(".remote-cursor")).toBeVisible({ timeout: 10000 });
  const comments = page.getByRole("region", { name: "Comentários", exact: true });
  await comments.getByRole("textbox").first().fill("Comentário <script> literal e seguro");
  await comments.getByRole("button", { name: "Enviar comentário", exact: true }).click();
  await expect(comments).toContainText("Comentário <script> literal e seguro");
  expect(await comments.locator("script").count()).toBe(0);
  await first.press("Home");
  for (let index = 0; index < 3; index++) await first.press("Shift+ArrowRight");
  const selectedText = (await first.textContent())?.slice(0, 3);
  await page.getByRole("button", { name: "Comentários do bloco 1", exact: true }).click();
  const blockDialog = page.getByRole("dialog", { name: "Comentários do bloco", exact: true });
  await blockDialog.getByLabel("Novo comentário no bloco", { exact: true }).fill("Comentário ancorado");
  await blockDialog.getByRole("button", { name: "Enviar comentário", exact: true }).click();
  await expect(blockDialog).toContainText("Comentário ancorado");
  await blockDialog.getByRole("button", { name: "Ir ao bloco", exact: true }).click();
  await expect(blockDialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selectedText);
  await other
    .getByRole("region", { name: "Comentários", exact: true })
    .getByRole("button", { name: "Atualizar comentários", exact: true })
    .click();
  await expect(other.getByRole("region", { name: "Comentários", exact: true })).toContainText(
    "Comentário <script> literal e seguro",
  );
  await sharing("viewer");
  const deniedComment = await other.request.post(`/api/pages/${pageId}/comments`, {
    headers: { Origin: origin },
    data: { body: "Não autorizado", requestId: randomUUID() },
  });
  expect(deniedComment.status()).toBe(403);
  const fileId = randomUUID(),
    bytes = Buffer.from("Anexo público sintético", "utf8"),
    objectPath = `${workspaceId}/${pageId}/${fileId}`;
  objects.push(objectPath);
  const uploaded = await admin.storage
    .from("page-assets")
    .upload(objectPath, bytes, { contentType: "application/octet-stream", upsert: false });
  expect(uploaded.error).toBeNull();
  const file = await admin.from("page_files").insert({
    id: fileId,
    workspace_id: workspaceId,
    page_id: pageId,
    object_path: objectPath,
    original_name: "pesquisa.txt",
    mime_type: "application/octet-stream",
    expected_size: bytes.length,
    actual_size: bytes.length,
    status: "ready",
    finalized_at: new Date().toISOString(),
    uploaded_by: owner.id,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    purpose: "block",
  });
  expect(file.error).toBeNull();
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  const head = await admin.from("document_heads").select("snapshot").eq("page_id", pageId).single();
  if (head.error || !head.data) throw new Error("Synthetic durable head missing.");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(head.data.snapshot.slice(2), "hex"));
  const vector = Y.encodeStateVector(doc),
    model = new StablePage(doc, "synthetic-fixture");
  const blockId = randomUUID();
  model.createBlock({ id: blockId, type: "file", parentId: null, position: "zz" });
  model.setBlockAttributes(blockId, { fileId, displayName: "pesquisa.txt" });
  const saved = await page.request.post(`/api/documents/${pageId}`, {
    headers: { Origin: origin, "Content-Type": "application/octet-stream", "X-Operation-Id": randomUUID() },
    data: Buffer.from(Y.encodeStateAsUpdate(doc, vector)),
  });
  expect(saved.status(), await saved.text()).toBe(200);
  model.destroy();
  doc.destroy();
  const metadata = await (await page.request.get(endpoint)).json();
  const published = await page.request.post(endpoint, {
    headers: { Origin: origin },
    data: { action: "publication", expectedRevision: metadata.revision, enabled: true, fields: [] },
  });
  expect(published.status(), await published.text()).toBe(200);
  const token = (await published.json()).publication.token;
  const anonymous = await browser.newContext();
  contexts.push(anonymous);
  const publicPage = await anonymous.newPage();
  await publicPage.goto(`/s/${token}`);
  await expect(publicPage.locator("article")).toBeVisible();
  await expect(publicPage.locator("article")).toContainText("Ideia A");
  await expect(publicPage.locator("article")).toContainText("Ideia B");
  await mkdir(".impeccable/review/m5", { recursive: true });
  await publicPage.setViewportSize({ width: 1440, height: 1000 });
  await publicPage.screenshot({
    path: ".impeccable/review/m5/public-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Compartilhar", exact: true }).click();
  const shareDialog = page.getByRole("dialog", { name: "Compartilhar página", exact: true });
  await expect(shareDialog).toContainText("Link público somente leitura");
  await page.screenshot({
    path: ".impeccable/review/m5/sharing-mobile-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await shareDialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await publicPage.locator("body").textContent()).not.toContain("Comentário <script>");
  const download = await publicPage.request.get(`/api/public/${token}/files/${fileId}`);
  expect(download.status()).toBe(200);
  expect(await download.text()).toBe(bytes.toString());
  const current = await (await page.request.get(endpoint)).json();
  const revoked = await page.request.post(endpoint, {
    headers: { Origin: origin },
    data: { action: "publication", expectedRevision: current.revision, enabled: false, fields: [] },
  });
  expect(revoked.status()).toBe(200);
  expect((await publicPage.request.get(`/api/public/${token}/files/${fileId}`)).status()).toBe(404);
  await publicPage.reload();
  await expect(publicPage.locator("body")).not.toContainText("Ideia A");
  await sharing(null);
  const deniedRead = await other.request.get(`/api/documents/${pageId}`);
  expect([403, 404]).toContain(deniedRead.status());
  await first.fill("Conteúdo novo após revogação");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await expect(other.locator('[data-save-state="denied"]')).toBeVisible({ timeout: 20000 });
  await expect(other.locator(".page-editor")).not.toContainText("Conteúdo novo após revogação");
});
