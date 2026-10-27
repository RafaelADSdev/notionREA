import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (
  process.env.BLOCO_TEST_STACK !== "bloco-test" ||
  api !== "http://127.0.0.1:55321" ||
  process.env.APP_URL !== "http://127.0.0.1:3001" ||
  !key
)
  throw new Error("Editor logout tests require the isolated synthetic stack.");
const admin = createClient<Database>(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts: string[] = [];

test.afterAll(async () => {
  for (const id of accounts) {
    const workspace = await admin.from("workspaces").delete().eq("created_by", id);
    if (workspace.error) throw new Error("Synthetic logout workspace cleanup failed.");
    const account = await admin.auth.admin.deleteUser(id);
    if (account.error) throw new Error("Synthetic logout account cleanup failed.");
  }
});

test("canceling logout retains a failed draft until retry saves it and logout can finish", async ({ page }) => {
  const email = `editor-logout-${randomUUID()}@example.test`;
  const password = `Synthetic-Logout-${randomUUID()}`;
  const account = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (account.error || !account.data.user) throw new Error("Synthetic logout account failed.");
  accounts.push(account.data.user.id);
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/new$/);
  await page.getByLabel("Nome do workspace").fill("Rascunhos de saída");
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  await page.getByRole("button", { name: "Nova página", exact: true }).click();
  await page.getByLabel("Nome da página", { exact: true }).fill("Rascunho da saída");
  await page.getByRole("button", { name: "Salvar página", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Página atualizada." })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Texto do bloco", exact: true });
  await expect(editor).toHaveCount(1);
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  const documentAddress = page.url();
  const documentPath = new URL(documentAddress).pathname;
  const pageId = documentPath.split("/").at(-1);
  if (!pageId || !/^[a-f0-9-]{36}$/.test(pageId)) throw new Error("Expected a synthetic page.");
  const documentUrl = `${process.env.APP_URL}/api/documents/${pageId}`;
  let blocked = true;
  let failedSaves = 0;
  await page.route(documentUrl, async (route) => {
    if (blocked && route.request().method() === "POST") {
      failedSaves++;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else await route.continue();
  });
  await editor.click();
  await page.keyboard.type("Rascunho preservado");
  await expect(page.locator('[data-save-state="error"]')).toBeVisible();
  expect(failedSaves).toBeGreaterThan(0);

  const warning = page.waitForEvent("dialog");
  const exit = page.getByRole("button", { name: "Sair", exact: true }).click();
  const dialog = await warning;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toContain("Sair descartará esses rascunhos");
  await dialog.dismiss();
  await exit;
  await expect(page).toHaveURL(documentAddress);
  await expect(editor).toHaveText("Rascunho preservado");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" e editável");
  await expect(editor).toHaveText("Rascunho preservado e editável");

  blocked = false;
  await page.getByRole("button", { name: "Tentar salvar novamente", exact: true }).click();
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await page.reload();
  await expect(editor).toHaveText("Rascunho preservado e editável");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
