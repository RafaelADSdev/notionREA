import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { validateContentDocument } from "../src/features/editor/model/content-schema";
import { initialContentUpdate } from "../src/features/editor/model/initial-content";
import { StablePage } from "../src/features/editor/model/stable-page";
import type { Database } from "../src/lib/supabase/database.types";

const app = "http://127.0.0.1:3001";
const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (
  process.env.BLOCO_TEST_STACK !== "bloco-test" ||
  process.env.APP_URL !== app ||
  api !== "http://127.0.0.1:55321" ||
  !publicKey ||
  !secret
)
  throw new Error("Editor API acceptance requires the isolated synthetic stack.");
const admin = createClient<Database>(api, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const databaseUrl = api;
const databasePublicKey = publicKey;
type Account = { id: string; email: string; password: string };
type Fixture = { owner: Account; workspaceId: string };
type Manifest = { revision: number; schemaVersion: number; byteLength: number };
const accounts: Account[] = [];
const contexts: BrowserContext[] = [];
const documents: Y.Doc[] = [];
const models: StablePage[] = [];
test.describe.configure({ timeout: 90000 });

async function account(): Promise<Account> {
  const email = `editor-api-${randomUUID()}@example.test`;
  const password = `Synthetic-Editor-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error("Could not create synthetic editor account.");
  const fixture = { id: data.user.id, email, password };
  accounts.push(fixture);
  return fixture;
}

async function login(page: Page, fixture: Account) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
  await page.getByLabel("Senha", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:workspaces\/new|w\/[a-f0-9-]+)$/);
}

async function workspace(page: Page): Promise<Fixture> {
  const owner = await account();
  await login(page, owner);
  await page.getByLabel("Nome do workspace").fill(`Editor API ${randomUUID()}`);
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  if (!workspaceId) throw new Error("Missing synthetic workspace identity.");
  return { owner, workspaceId };
}

async function pages(fixture: Fixture, titles: string[]) {
  const records = titles.map((title, index) => ({
    id: randomUUID(),
    workspace_id: fixture.workspaceId,
    owner_id: fixture.owner.id,
    created_by: fixture.owner.id,
    title,
    position: `m${index}`,
    restricted: true,
  }));
  // Metadata-only setup keeps this proof independent of editor mounting/autosave.
  const { error } = await admin.from("pages").insert(records);
  if (error) throw new Error("Could not create owned synthetic page metadata.");
  return records;
}

async function member(fixture: Fixture, pageId: string, role: "editor" | "viewer") {
  const user = await account();
  const membership = await admin
    .from("workspace_members")
    .insert({ workspace_id: fixture.workspaceId, user_id: user.id, role: "member" });
  const grant = await admin
    .from("page_grants")
    .insert({ workspace_id: fixture.workspaceId, page_id: pageId, user_id: user.id, role });
  if (membership.error || grant.error) throw new Error("Could not grant synthetic page access.");
  return user;
}

async function session(browser: Browser, fixture?: Account) {
  const context = await browser.newContext({ baseURL: app });
  contexts.push(context);
  const page = await context.newPage();
  if (fixture) await login(page, fixture);
  return page;
}

async function readClient(fixture: Account) {
  const client = createClient<Database>(databaseUrl, databasePublicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  });
  if (error) throw new Error("Could not authenticate synthetic read-only assertions.");
  return client;
}

function document(snapshot = initialContentUpdate()) {
  const value = new Y.Doc();
  documents.push(value);
  Y.applyUpdate(value, snapshot);
  return value;
}

function firstText(value: Y.Doc) {
  const model = new StablePage(value, "acceptance");
  models.push(model);
  const first = model.visibleChildren()[0];
  if (!first) throw new Error("Expected the shared initial paragraph.");
  const paragraph = model.fragment(first.id).get(0);
  if (!(paragraph instanceof Y.XmlElement)) throw new Error("Expected an inline paragraph.");
  let text = paragraph.get(0);
  if (text === undefined) {
    text = new Y.XmlText();
    paragraph.insert(0, [text]);
  }
  if (!(text instanceof Y.XmlText)) throw new Error("Expected rich text.");
  return { text, paragraph };
}

function mention(paragraph: Y.XmlElement, pageId: string) {
  const node = new Y.XmlElement("pageMention");
  node.setAttribute("pageId", pageId);
  paragraph.insert(paragraph.length, [node]);
}

function post(
  request: APIRequestContext,
  pageId: string,
  bytes: Uint8Array,
  operationId = randomUUID(),
  origin = app,
) {
  return request.post(`/api/documents/${pageId}`, {
    headers: { Origin: origin, "Content-Type": "application/octet-stream", "X-Operation-Id": operationId },
    data: Buffer.from(bytes),
  });
}

async function saved(request: APIRequestContext, pageId: string) {
  const manifestResponse = await request.get(`/api/documents/${pageId}`);
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["cache-control"]).toContain("no-store");
  const manifest = (await manifestResponse.json()) as Manifest;
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.byteLength).toBeGreaterThan(0);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < manifest.byteLength; offset += 512 * 1024) {
    const response = await request.get(
      `/api/documents/${pageId}?revision=${manifest.revision}&offset=${offset}`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/octet-stream");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    const bytes = await response.body();
    expect(bytes.byteLength).toBe(Math.min(512 * 1024, manifest.byteLength - offset));
    chunks.push(bytes);
  }
  const snapshot = new Uint8Array(Buffer.concat(chunks));
  const value = document(snapshot);
  return { manifest, snapshot, document: value, projection: validateContentDocument(value), chunks };
}

async function search(request: APIRequestContext, fixture: Fixture, query: string) {
  const response = await request.post("/api/pages/search", {
    headers: { Origin: app },
    data: { workspaceId: fixture.workspaceId, query },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { items: { id: string; title: string }[] };
}

test.afterEach(async () => {
  for (const model of models.splice(0)) model.destroy();
  for (const value of documents.splice(0)) value.destroy();
  for (const context of contexts.splice(0)) await context.close();
});
test.afterAll(async () => {
  for (const fixture of accounts) {
    const { error } = await admin.from("workspaces").delete().eq("created_by", fixture.id);
    if (error) throw new Error("Could not clean synthetic editor workspaces.");
  }
  for (const fixture of accounts) {
    const { error } = await admin.auth.admin.deleteUser(fixture.id);
    if (error) throw new Error("Could not clean synthetic editor accounts.");
  }
});

test("canonical HTTP saves survive reload and old ACK retries cannot rewind search or backlinks", async ({
  page,
}) => {
  const fixture = await workspace(page);
  const [source, target] = await pages(fixture, ["API source", "API referenced page"]);
  if (!source || !target) throw new Error("Missing synthetic content pages.");
  const value = document();
  const { text, paragraph } = firstText(value);
  text.insert(0, "café neutronalpha");
  text.format(0, 4, { bold: {} });
  mention(paragraph, target.id);
  const initial = Y.encodeStateAsUpdate(value);
  const operation = randomUUID();
  const first = await post(page.request, source.id, initial, operation);
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ revision: 1 });
  expect((await saved(page.request, source.id)).projection).toEqual(validateContentDocument(value));
  const reads = await readClient(fixture.owner);
  const backlinks = await reads.rpc("list_page_backlinks", { p_page_id: target.id });
  expect(backlinks.error).toBeNull();
  expect(backlinks.data?.map((entry) => entry.id)).toEqual([source.id]);
  const previous = Y.encodeStateVector(value);
  text.delete(0, text.length);
  text.insert(0, "durablebeta coração");
  paragraph.delete(1, 1);
  const next = await post(page.request, source.id, Y.encodeStateAsUpdate(value, previous));
  expect(next.status()).toBe(200);
  expect(await next.json()).toEqual({ revision: 2 });
  // Model an ACK that never reached the caller: retry the exact operation bytes.
  const retry = await post(page.request, source.id, initial, operation);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual({ revision: 1 });
  const reloaded = await saved(page.request, source.id);
  expect(reloaded.manifest.revision).toBe(2);
  expect(reloaded.projection).toEqual(validateContentDocument(value));
  expect((await search(page.request, fixture, "durablebeta coracao")).items.map((entry) => entry.id)).toEqual(
    [source.id],
  );
  expect((await search(page.request, fixture, "neutronalpha")).items).toEqual([]);
  const currentBacklinks = await reads.rpc("list_page_backlinks", { p_page_id: target.id });
  expect(currentBacklinks.error).toBeNull();
  expect(currentBacklinks.data).toEqual([]);
});

test("parallel owner and editor deltas converge through durable server CAS retries", async ({
  page,
  browser,
}) => {
  const fixture = await workspace(page);
  const [source] = await pages(fixture, ["Parallel API content"]);
  if (!source) throw new Error("Missing synthetic content page.");
  const editor = await member(fixture, source.id, "editor");
  const editorPage = await session(browser, editor);
  const value = document();
  firstText(value).text.insert(0, "Original");
  expect((await post(page.request, source.id, Y.encodeStateAsUpdate(value))).status()).toBe(200);
  const ownerBase = await saved(page.request, source.id);
  const editorBase = await saved(editorPage.request, source.id);
  expect(editorBase.projection).toEqual(ownerBase.projection);
  const ownerState = Y.encodeStateVector(ownerBase.document);
  const editorState = Y.encodeStateVector(editorBase.document);
  const ownerText = firstText(ownerBase.document).text;
  const editorText = firstText(editorBase.document).text;
  ownerText.insert(ownerText.length, " Alice");
  editorText.insert(editorText.length, " Bob");
  const ownerDelta = Y.encodeStateAsUpdate(ownerBase.document, ownerState);
  const editorDelta = Y.encodeStateAsUpdate(editorBase.document, editorState);
  const responses = await Promise.all([
    post(page.request, source.id, ownerDelta),
    post(editorPage.request, source.id, editorDelta),
  ]);
  for (const response of responses) expect(response.status()).toBe(200);
  expect(
    (
      await Promise.all(
        responses.map(async (response) => ((await response.json()) as { revision: number }).revision),
      )
    ).sort(),
  ).toEqual([2, 3]);
  Y.applyUpdate(ownerBase.document, editorDelta);
  const final = await saved(page.request, source.id);
  expect(final.manifest.revision).toBe(3);
  expect(final.projection).toEqual(validateContentDocument(ownerBase.document));
  expect(final.projection.text).toContain("Alice");
  expect(final.projection.text).toContain("Bob");
});

test("current page ACL denies malformed writes before decoding and never resolves hidden reference labels", async ({
  page,
  browser,
}) => {
  const fixture = await workspace(page);
  const [source, target] = await pages(fixture, ["Shared source", "Hidden API destination"]);
  if (!source || !target) throw new Error("Missing synthetic content pages.");
  const viewer = await member(fixture, source.id, "viewer");
  const viewerPage = await session(browser, viewer);
  const outsider = await account();
  const outsiderPage = await session(browser, outsider);
  const anonymousPage = await session(browser);
  const value = document();
  const { text, paragraph } = firstText(value);
  text.insert(0, "Authorized opaque reference");
  mention(paragraph, target.id);
  expect((await post(page.request, source.id, Y.encodeStateAsUpdate(value))).status()).toBe(200);
  expect((await saved(viewerPage.request, source.id)).projection.references).toEqual([target.id]);
  expect((await post(viewerPage.request, source.id, new Uint8Array([255]))).status()).toBe(403);
  expect((await post(outsiderPage.request, source.id, new Uint8Array([255]))).status()).toBe(403);
  expect((await outsiderPage.request.get(`/api/documents/${source.id}`)).status()).toBe(403);
  expect((await anonymousPage.request.get(`/api/documents/${source.id}`)).status()).toBe(401);
  expect((await post(anonymousPage.request, source.id, new Uint8Array([255]))).status()).toBe(401);
  const viewerReads = await readClient(viewer);
  const resolved = await viewerReads.rpc("resolve_page_mentions", {
    p_workspace_id: fixture.workspaceId,
    p_page_ids: [target.id],
  });
  expect(resolved.error).toBeNull();
  expect(resolved.data).toEqual([]);
  const deniedBacklinks = await viewerReads.rpc("list_page_backlinks", { p_page_id: target.id });
  expect(deniedBacklinks.error?.code).toBe("42501");
  const ownerReads = await readClient(fixture.owner);
  const ownerBacklinks = await ownerReads.rpc("list_page_backlinks", { p_page_id: target.id });
  expect(ownerBacklinks.error).toBeNull();
  expect(ownerBacklinks.data?.map((entry) => entry.id)).toEqual([source.id]);
  const revoke = await admin.from("page_grants").delete().eq("page_id", source.id).eq("user_id", viewer.id);
  if (revoke.error) throw new Error("Could not revoke synthetic page grant.");
  expect((await viewerPage.request.get(`/api/documents/${source.id}?revision=1&offset=0`)).status()).toBe(
    403,
  );
});

test("HTTP bounds origin, bytes, binary/schema validation and fixed-size canonical chunk reads", async ({
  page,
}) => {
  const fixture = await workspace(page);
  const [source] = await pages(fixture, ["Bounded HTTP content"]);
  if (!source) throw new Error("Missing synthetic content page.");
  expect(
    (
      await post(page.request, source.id, initialContentUpdate(), randomUUID(), "https://invalid.example")
    ).status(),
  ).toBe(403);
  expect((await post(page.request, source.id, new Uint8Array(256 * 1024 + 1))).status()).toBe(413);
  expect((await post(page.request, source.id, new Uint8Array([255]))).status()).toBe(422);
  const unsupported = document();
  unsupported.getMap("meta").set("schemaVersion", 99);
  expect((await post(page.request, source.id, Y.encodeStateAsUpdate(unsupported))).status()).toBe(422);
  const untouched = await page.request.get(`/api/documents/${source.id}`);
  expect(await untouched.json()).toEqual({ revision: 0, schemaVersion: 1, byteLength: 0 });
  const value = document();
  const text = firstText(value).text;
  let state: Uint8Array | undefined;
  for (let index = 0; index < 3; index += 1) {
    text.insert(text.length, "chunkword ".repeat(19000));
    const delta = Y.encodeStateAsUpdate(value, state);
    expect(delta.byteLength).toBeLessThanOrEqual(256 * 1024);
    const accepted = await post(page.request, source.id, delta);
    expect(accepted.status()).toBe(200);
    expect(await accepted.json()).toEqual({ revision: index + 1 });
    state = Y.encodeStateVector(value);
  }
  const reloaded = await saved(page.request, source.id);
  expect(reloaded.chunks).toHaveLength(2);
  expect(reloaded.projection).toEqual(validateContentDocument(value));
  expect((await page.request.get(`/api/documents/${source.id}?revision=2&offset=0`)).status()).toBe(409);
  expect((await page.request.get(`/api/documents/${source.id}?revision=3&offset=1`)).status()).toBe(400);
});
