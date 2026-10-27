import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { DatabaseCommandResult, DatabaseData } from "../src/features/databases/types";
import type { Database } from "../src/lib/supabase/database.types";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (process.env.BLOCO_TEST_STACK !== "bloco-test" || api !== "http://127.0.0.1:55321" || !key)
  throw new Error("Database acceptance requires the isolated synthetic stack.");
const admin = createClient<Database>(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts: string[] = [];
test.afterAll(async () => {
  for (const id of accounts) {
    const workspace = await admin.from("workspaces").delete().eq("created_by", id);
    if (workspace.error) throw new Error("Synthetic database cleanup failed.");
    const account = await admin.auth.admin.deleteUser(id);
    if (account.error) throw new Error("Synthetic account cleanup failed.");
  }
});

test("one database keeps typed values and independent template content across all five views", async ({
  page,
}) => {
  test.setTimeout(90000);
  const email = `database-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const account = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (account.error || !account.data.user) throw new Error("Synthetic database fixture failed.");
  accounts.push(account.data.user.id);
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nome do workspace").fill("Projetos de pesquisa");
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("button", { name: "Nova base de dados", exact: true }).click();
  await expect(page.locator(".db-workspace")).toBeVisible();
  const containerId = new URL(page.url()).pathname.split("/").at(-1);
  const databaseRow = await admin
    .from("databases")
    .select("id")
    .eq("page_id", containerId ?? "")
    .single();
  if (databaseRow.error || !databaseRow.data) throw new Error("Missing synthetic database.");
  const databaseId = databaseRow.data.id;
  const endpoint = `/api/databases/${databaseId}`;
  const read = async (): Promise<DatabaseData> => {
    const response = await page.request.get(endpoint);
    expect(response.status()).toBe(200);
    return response.json();
  };
  const command = async (value: object): Promise<DatabaseCommandResult> => {
    const response = await page.request.post(endpoint, {
      headers: { Origin: "http://127.0.0.1:3001", "X-Operation-Id": randomUUID() },
      data: value,
    });
    expect(response.status(), JSON.stringify(await response.json())).toBe(200);
    const result: DatabaseCommandResult = await response.json();
    expect(result.ok, result.error).toBe(true);
    return result;
  };
  const choice = randomUUID();
  const status = await command({
    action: "property",
    id: null,
    name: "Etapa",
    type: "select",
    config: { options: [{ id: choice, label: "Em andamento", color: "indigo" }] },
    expectedRevision: 0,
  });
  const date = await command({
    action: "property",
    id: null,
    name: "Entrega",
    type: "date",
    config: { mode: "civil" },
    expectedRevision: 0,
  });
  const number = await command({
    action: "property",
    id: null,
    name: "Valor",
    type: "number",
    config: {},
    expectedRevision: 0,
  });
  const row = await command({ action: "createRecord", title: "Pesquisa de campo" });
  const recordId = row.pageId ?? row.id;
  if (!recordId || !status.id || !date.id || !number.id)
    throw new Error("Missing synthetic typed identities.");
  const today = new Date(),
    day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
  for (const [propertyId, value] of [
    [status.id, choice],
    [date.id, { kind: "civil", start: day, end: null }],
    [number.id, "0"],
  ])
    await command({ action: "cell", recordId, propertyId, value, expectedRevision: 0 });
  let data = await read();
  const visibleProperties = data.properties.map((property) => property.id);
  for (const [type, name] of [
    ["board", "Quadro"],
    ["list", "Lista"],
    ["calendar", "Calendário"],
    ["gallery", "Galeria"],
  ])
    await command({
      action: "view",
      id: null,
      name,
      type,
      config: {
        visibleProperties,
        sorts: [],
        filter: null,
        groupBy: type === "board" ? status.id : null,
        datePropertyId: type === "calendar" ? date.id : null,
      },
      expectedRevision: 0,
    });
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(5);
  const captures = ".impeccable/review/m4";
  await mkdir(captures, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${captures}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: `${captures}/mobile-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  for (const name of ["Quadro", "Lista", "Calendário", "Galeria"]) {
    await page.getByRole("tab", { name: new RegExp(`^${name} · `) }).click({ timeout: 10000 });
    await expect(
      page.getByRole("tabpanel").getByRole("button", { name: "Pesquisa de campo", exact: true }).first(),
    ).toBeVisible();
  }
  data = await read();
  const filtered = await page.request.post(endpoint, {
    headers: { Origin: "http://127.0.0.1:3001" },
    data: {
      action: "query",
      filter: { kind: "condition", propertyId: number.id, operator: "eq", value: "0" },
    },
  });
  expect(filtered.status()).toBe(200);
  expect((await filtered.json()).rows.map((item: { id: string }) => item.id)).toEqual([recordId]);
  const template = await command({ action: "template", id: null, title: "Roteiro", expectedRevision: 0 });
  if (!template.id || !template.pageId) throw new Error("Missing synthetic template.");
  await page.goto(`/w/${workspaceId}/p/${template.pageId}`);
  const text = page.getByRole("textbox", { name: "Texto do bloco", exact: true });
  await expect(text).toHaveCount(1);
  await text.fill("Roteiro independente do template");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  const instance = await command({ action: "createRecord", title: "Nova pesquisa", templateId: template.id });
  const instanceId = instance.pageId ?? instance.id;
  const documents = await admin
    .from("document_heads")
    .select("page_id,projection")
    .in("page_id", [template.pageId, instanceId ?? ""]);
  expect(documents.error).toBeNull();
  expect(documents.data).toHaveLength(2);
  const projections =
    documents.data?.map((item) => item.projection as { text: string; blocks: { id: string }[] }) ?? [];
  expect(projections.map((item) => item.text)).toEqual([
    "Roteiro independente do template",
    "Roteiro independente do template",
  ]);
  expect(projections[0]?.blocks[0]?.id).not.toBe(projections[1]?.blocks[0]?.id);
  expect(data.rows.some((item) => item.id === recordId)).toBe(true);
});
