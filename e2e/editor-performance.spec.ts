import { createHash, randomUUID } from "node:crypto";
import { cpus, platform, release } from "node:os";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { MAX_CONTENT_BYTES } from "../src/features/editor/model/content-limits";
import { validateContentDocument } from "../src/features/editor/model/content-schema";
import type { Database, Json } from "../src/lib/supabase/database.types";

const app = "http://127.0.0.1:3001",
  api = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY;
if (
  process.env.BLOCO_TEST_STACK !== "bloco-test" ||
  process.env.APP_URL !== app ||
  api !== "http://127.0.0.1:55321" ||
  !key
)
  throw new Error("The editor benchmark exclusively requires the isolated synthetic stack.");
const admin = createClient<Database>(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const count = 5000,
  target = 2500;
const blockId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const textAt = (index: number, characters: number) =>
  `${String(index).padStart(5, "0")}:`.padEnd(characters, "x");
function expectedProjection(characters: number) {
  return {
    schemaVersion: 1,
    text: Array.from({ length: count }, (_, index) => textAt(index, characters)).join("\n"),
    references: [],
    files: [],
    blocks: Array.from({ length: count }, (_, index) => ({
      id: blockId(index),
      type: "paragraph",
      parentId: null,
      position: `${index.toString(36).padStart(6, "0")}U`,
      attributes: {},
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: textAt(index, characters) }] }],
      },
    })),
  };
}
function fixtureDocument() {
  const baseline = Buffer.byteLength(JSON.stringify(expectedProjection(16)));
  const characters = 16 + Math.floor((MAX_CONTENT_BYTES - 65536 - baseline) / (2 * count));
  const document = new Y.Doc();
  document.transact(() => {
    document.getMap("meta").set("schemaVersion", 1);
    for (let index = 0; index < count; index++) {
      const id = blockId(index),
        paragraph = new Y.XmlElement("paragraph"),
        text = new Y.XmlText();
      document.getMap("identities").set(id, true);
      document.getMap("blocks").set(id, "paragraph");
      document
        .getMap("placements")
        .set(id, { parentId: null, position: `${index.toString(36).padStart(6, "0")}U` });
      paragraph.insert(0, [text]);
      document.getXmlFragment(`block-content:${id}`).insert(0, [paragraph]);
      text.insert(0, textAt(index, characters));
    }
  });
  const projection = validateContentDocument(document),
    snapshot = Y.encodeStateAsUpdate(document);
  const projectionBytes = Buffer.byteLength(JSON.stringify(projection));
  expect(projection.blocks).toHaveLength(count);
  expect(projectionBytes).toBeGreaterThan(MAX_CONTENT_BYTES - 131072);
  expect(projectionBytes).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
  expect(snapshot.byteLength).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
  return { document, snapshot, projection, projectionBytes, characters };
}
function textHash(rows: readonly { id: string; text: string }[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
async function persisted(pageId: string) {
  const head = await admin.from("document_heads").select("snapshot,revision").eq("page_id", pageId).single();
  if (head.error || !head.data || !head.data.snapshot.startsWith("\\x"))
    throw new Error("Synthetic durable snapshot unavailable.");
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, Buffer.from(head.data.snapshot.slice(2), "hex"));
    const projection = validateContentDocument(document);
    return {
      revision: head.data.revision,
      ids: projection.blocks.map((block) => block.id),
      hash: textHash(
        projection.blocks.map((block) => ({
          id: block.id,
          text: block.content.content
            .flatMap((paragraph) =>
              paragraph.content.map((inline) => (inline.type === "text" ? inline.text : "")),
            )
            .join(""),
        })),
      ),
    };
  } finally {
    document.destroy();
  }
}
async function saved(page: Page) {
  try {
    await expect(page.locator('[data-save-state="saved"]')).toBeVisible({ timeout: 45000 });
  } catch (error) {
    console.log(
      "EDITOR_SAVE_DIAGNOSTIC",
      JSON.stringify({
        state: await page.locator("[data-save-state]").getAttribute("data-save-state"),
        status: await page.locator("[data-save-state]").textContent(),
        alerts: await page.locator('[role="alert"]').allTextContents(),
      }),
    );
    throw error;
  }
}
async function endOfFragment(text: Locator, length: number) {
  await text.press("Control+End");
  await expect
    .poll(() =>
      text.evaluate((element) => {
        const selection = document.getSelection();
        if (!selection?.isCollapsed || !selection.focusNode || !element.contains(selection.focusNode))
          return -1;
        const range = document.createRange();
        range.selectNodeContents(element);
        range.setEnd(selection.focusNode, selection.focusOffset);
        return range.toString().length;
      }),
    )
    .toBe(length);
}

test("5,000 real TipTap fragments keep bounded DOM, paint latency, IME and durable identities", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = `editor-performance-${randomUUID()}@example.test`,
    password = `Synthetic-Performance-${randomUUID()}`;
  const account = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (account.error || !account.data.user) throw new Error("Synthetic performance account creation failed.");
  const actorId = account.data.user.id,
    workspaceId = randomUUID(),
    pageId = randomUUID();
  const fixture = fixtureDocument();
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith(`/api/documents/${pageId}`) && response.status() >= 400)
      console.log("EDITOR_DOCUMENT_HTTP", response.request().method(), response.status());
  });
  try {
    const workspace = await admin
      .from("workspaces")
      .insert({ id: workspaceId, name: "Performance 5000", created_by: actorId });
    const member = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: actorId, role: "owner" });
    const metadata = await admin.from("pages").insert({
      id: pageId,
      workspace_id: workspaceId,
      owner_id: actorId,
      created_by: actorId,
      title: "Documento de 5.000 blocos",
      position: "V",
      restricted: true,
    });
    // Admin is used only to seed this already validated synthetic snapshot. All
    // measured input, composition, comments, undo and saving use the real UI.
    const serializedProjection: NonNullable<Json> = JSON.parse(JSON.stringify(fixture.projection));
    const seed = await admin.from("document_heads").insert({
      page_id: pageId,
      workspace_id: workspaceId,
      revision: 1,
      compacted_through: 1,
      snapshot: `\\x${Buffer.from(fixture.snapshot).toString("hex")}`,
      projection: serializedProjection,
    });
    if (workspace.error || member.error || metadata.error || seed.error)
      throw new Error("Synthetic performance seed failed.");
    await page.goto("/login");
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
    await page.goto(`/w/${workspaceId}/p/${pageId}`);
    const first = page.locator(`[data-block-text="${blockId(0)}"] [role="textbox"]`);
    await expect(first).toHaveText(textAt(0, fixture.characters), { timeout: 45000 });
    const initialMounted = await page.locator('.page-editor [contenteditable="true"]').count();
    expect(initialMounted).toBeGreaterThan(0);
    expect(initialMounted).toBeLessThan(100);
    const suffix = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    await first.click();
    await endOfFragment(first, fixture.characters);
    await page.evaluate((id) => {
      const measurements: number[] = [];
      Object.defineProperty(window, "__editorPaintSamples", { configurable: true, value: measurements });
      document.addEventListener(
        "beforeinput",
        (event) => {
          if (
            !(event.target instanceof Element) ||
            event.target.closest("[data-block-text]")?.getAttribute("data-block-text") !== id
          )
            return;
          const start = performance.now();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => measurements.push(performance.now() - start)),
          );
        },
        true,
      );
    }, blockId(0));
    for (let index = 0; index < suffix.length; index++) {
      const character = suffix[index];
      if (!character) continue;
      await page.keyboard.type(character);
      await page.waitForFunction((length) => {
        const samples = Reflect.get(window, "__editorPaintSamples");
        return Array.isArray(samples) && samples.length >= length;
      }, index + 1);
    }
    const samples = await page.evaluate(() => {
      const samples = Reflect.get(window, "__editorPaintSamples");
      if (!Array.isArray(samples) || samples.some((sample) => typeof sample !== "number"))
        throw new Error("Missing paint samples");
      return samples.filter((sample): sample is number => typeof sample === "number");
    });
    samples.sort((first, second) => first - second);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? Infinity;
    const measurements = {
      blocks: count,
      projectionBytes: fixture.projectionBytes,
      snapshotBytes: fixture.snapshot.byteLength,
      initialMounted,
      samples: samples.length,
      inputToCompletedPaintP95Ms: p95,
      method: "beforeinput to second requestAnimationFrame; one new key after each measured paint",
      viewport: "1440x900",
      chromium: browser.version(),
      node: process.version,
      cpu: cpus()[0]?.model ?? "unknown",
      os: `${platform()} ${release()}`,
      throttling: "none",
      network: "isolated localhost; no artificial RTT",
    };
    console.log("EDITOR_PERFORMANCE", JSON.stringify(measurements));
    await testInfo.attach("editor-performance.json", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    expect(samples).toHaveLength(40);
    expect(p95, JSON.stringify(measurements)).toBeLessThanOrEqual(50);
    await saved(page);
    console.log("EDITOR_PERFORMANCE_PHASE", "initial-save");

    const targetId = blockId(target),
      original = textAt(target, fixture.characters);
    const text = fixture.document.getXmlFragment(`block-content:${targetId}`).get(0);
    if (!(text instanceof Y.XmlElement) || !(text.get(0) instanceof Y.XmlText))
      throw new Error("Missing canonical fixture text.");
    const content = text.get(0);
    if (!(content instanceof Y.XmlText)) throw new Error("Expected shared text.");
    const anchor = {
      type: "relative",
      start: Buffer.from(
        Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(content, 0)),
      ).toString("base64url"),
      end: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(content, 10))).toString(
        "base64url",
      ),
    };
    for (const value of [
      { body: "Salto distante sem trecho", anchor: undefined },
      { body: "Salto distante com trecho", anchor },
    ]) {
      const response = await page.request.post(`/api/pages/${pageId}/comments`, {
        headers: { Origin: app },
        data: {
          body: value.body,
          requestId: randomUUID(),
          blockId: targetId,
          ...(value.anchor ? { anchor: value.anchor } : {}),
        },
      });
      expect(response.ok()).toBe(true);
    }
    console.log("EDITOR_PERFORMANCE_PHASE", "comments-created");
    await page.getByRole("button", { name: "Atualizar comentários", exact: true }).click();
    const nullThread = page.locator(".comment-thread").filter({ hasText: "Salto distante sem trecho" });
    await nullThread.getByRole("button", { name: "Ir ao bloco", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.locator(`[data-editor-block="${targetId}"]`).count()).toBe(0);
    await nullThread.getByRole("button", { name: "Ir ao bloco", exact: true }).click();
    const targetFrame = page.locator(`[data-editor-block="${targetId}"]`),
      targetText = targetFrame.getByRole("textbox", { name: "Texto do bloco", exact: true });
    await expect(targetFrame).toBeFocused();
    await expect(targetText).toHaveText(original);
    console.log("EDITOR_PERFORMANCE_PHASE", "distant-frame-focus");
    // An anchor jump from a modal closes it before focusing the underlying page.
    await targetFrame
      .getByRole("button", {
        name: `Comentários do bloco ${new Intl.NumberFormat("pt-BR").format(target + 1)}`,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", { name: "Comentários do bloco", exact: true });
    await expect(dialog).toBeVisible();
    await dialog
      .locator(".comment-thread")
      .filter({ hasText: "Salto distante com trecho" })
      .getByRole("button", { name: "Ir ao bloco", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(targetText).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.getSelection()?.toString()))
      .toBe(original.slice(0, 10));
    console.log("EDITOR_PERFORMANCE_PHASE", "modal-relative-selection");
    await endOfFragment(targetText, original.length);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "漢字", selectionStart: 2, selectionEnd: 2 });
    const beforeScroll = await targetText.elementHandle();
    await page.locator(".editor-add-block").scrollIntoViewIfNeeded();
    expect(
      await beforeScroll?.evaluate((element) => element.isConnected && element === document.activeElement),
    ).toBe(true);
    expect(await page.locator('.page-editor [contenteditable="true"]').count()).toBeLessThan(100);
    await cdp.send("Input.insertText", { text: "漢字" });
    await cdp.detach();
    await expect(targetText).toHaveText(`${original}漢字`);
    console.log("EDITOR_PERFORMANCE_PHASE", "composition-after-scroll");
    await page.keyboard.press("Control+z");
    await expect(targetText).toHaveText(original);
    await page.keyboard.press("Control+Shift+z");
    await expect(targetText).toHaveText(`${original}漢字`);
    await saved(page);
    console.log("EDITOR_PERFORMANCE_PHASE", "undo-redo-save");
    const expected = textHash(
      Array.from({ length: count }, (_, index) => ({
        id: blockId(index),
        text: `${textAt(index, fixture.characters)}${index === 0 ? suffix : index === target ? "漢字" : ""}`,
      })),
    );
    const beforeReload = await persisted(pageId);
    expect(beforeReload.ids).toEqual(Array.from({ length: count }, (_, index) => blockId(index)));
    expect(beforeReload.hash).toBe(expected);
    await page.reload();
    await expect(first).toHaveText(`${textAt(0, fixture.characters)}${suffix}`, { timeout: 45000 });
    await page.evaluate(
      ({ pageId, targetId }) =>
        document.dispatchEvent(
          new CustomEvent("bloco:reveal-block", { detail: { pageId, blockId: targetId } }),
        ),
      { pageId, targetId },
    );
    await expect(targetText).toHaveText(`${original}漢字`);
    const afterReload = await persisted(pageId);
    expect(afterReload.ids).toEqual(beforeReload.ids);
    expect(afterReload.hash).toBe(expected);
  } finally {
    fixture.document.destroy();
    const removed = await admin.from("workspaces").delete().eq("id", workspaceId).eq("created_by", actorId);
    expect.soft(removed.error, "Synthetic performance workspace cleanup").toBeNull();
    const user = await admin.auth.admin.deleteUser(actorId);
    expect.soft(user.error, "Synthetic performance account cleanup").toBeNull();
  }
});
