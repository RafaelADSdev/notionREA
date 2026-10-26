import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (
  process.env.BLOCO_TEST_STACK !== "bloco-test" ||
  process.env.APP_URL !== "http://127.0.0.1:3001" ||
  api !== "http://127.0.0.1:55321" ||
  !publicKey ||
  !secret
)
  throw new Error("Page acceptance tests require the isolated synthetic stack.");

const admin = createClient<Database>(api, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
type Account = { id: string; email: string; password: string };
const accounts: Account[] = [];

test.describe.configure({ timeout: 90000 });

async function account(): Promise<Account> {
  const email = `pages-${randomUUID()}@example.test`;
  const password = `Synthetic-Pages-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error("Could not create synthetic page-test account.");
  const fixture = { id: data.user.id, email, password };
  accounts.push(fixture);
  return fixture;
}

async function workspace(page: Page) {
  const owner = await account();
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(owner.email);
  await page.getByLabel("Senha", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/new$/);
  const path = await createWorkspace(page);
  return { owner, path, id: path.split("/")[2] ?? "" };
}

async function createWorkspace(page: Page) {
  await page.getByLabel("Nome do workspace").fill(`Páginas ${randomUUID()}`);
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: "As suas páginas.", exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function saveMetadata(page: Page, title: string, icon?: string) {
  await page.getByLabel("Nome da página", { exact: true }).fill(title);
  if (icon !== undefined) await page.getByLabel("Ícone da página", { exact: true }).fill(icon);
  await page.getByRole("button", { name: "Salvar página", exact: true }).click();
  await expect(page.getByRole("button", { name: "Salvar página", exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Página atualizada." })).toBeVisible();
}

async function createRoot(page: Page, workspacePath: string, title: string) {
  await page.goto(workspacePath);
  await page.getByRole("button", { name: "Nova página", exact: true }).click();
  await expect(page.getByLabel("Nome da página", { exact: true })).toBeFocused();
  await saveMetadata(page, title);
  return new URL(page.url()).pathname;
}

async function createChild(page: Page, parentPath: string, title: string) {
  await page.goto(parentPath);
  await page.getByRole("button", { name: "Adicionar subpágina", exact: true }).click();
  await expect(page.getByLabel("Nome da página", { exact: true })).toBeFocused();
  await saveMetadata(page, title);
  return new URL(page.url()).pathname;
}

async function organize(page: Page) {
  await page.getByText("Organizar página", { exact: true }).click();
}

async function trash(page: Page) {
  await organize(page);
  await page.getByLabel("Mover esta página e suas filhas para a lixeira", { exact: true }).check();
  await page.getByRole("button", { name: "Mover para a lixeira", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lixeira", exact: true })).toBeVisible();
}

test.afterAll(async () => {
  for (const fixture of accounts) {
    const { error } = await admin.from("workspaces").delete().eq("created_by", fixture.id);
    if (error) throw new Error("Could not clean synthetic page-test workspaces.");
  }
  for (const fixture of accounts) {
    const { error } = await admin.auth.admin.deleteUser(fixture.id);
    if (error) throw new Error("Could not clean synthetic page-test accounts.");
  }
});

test("page identity, title, icon and children survive navigation with an accessible populated page", async ({
  page,
}) => {
  const fixture = await workspace(page);
  const parent = await createRoot(page, fixture.path, "Plano inicial");
  await saveMetadata(page, "Plano de pesquisa", "🌿");
  expect(new URL(page.url()).pathname).toBe(parent);
  const child = await createChild(page, parent, "Entrevistas");
  await page.reload();
  await expect(page.getByLabel("Nome da página", { exact: true })).toHaveValue("Entrevistas");
  await page.goto(parent);
  await expect(page.getByLabel("Nome da página", { exact: true })).toHaveValue("Plano de pesquisa");
  await expect(page.getByLabel("Ícone da página", { exact: true })).toHaveValue("🌿");
  const childLink = page.getByRole("main").getByRole("link", { name: "Entrevistas", exact: true });
  await expect(childLink).toHaveAttribute("href", child);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await childLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${child}$`));
});

test("restoring a subtree keeps its identities without reviving an earlier independently trashed child", async ({
  page,
}) => {
  const fixture = await workspace(page);
  const parent = await createRoot(page, fixture.path, "Projeto a restaurar");
  const activeChild = await createChild(page, parent, "Filha ativa");
  const earlierChild = await createChild(page, parent, "Exclusão anterior");
  await trash(page);
  await page.goto(parent);
  await trash(page);
  const parentEntry = page.getByRole("article", { name: "Projeto a restaurar", exact: true });
  await expect(parentEntry.getByLabel("Usar local original", { exact: true })).toBeChecked();
  await parentEntry.getByRole("button", { name: "Restaurar página", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${parent}$`));
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Filha ativa", exact: true })).toHaveAttribute(
    "href",
    activeChild,
  );
  await expect(main.getByRole("link", { name: "Exclusão anterior", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Nome da página", { exact: true })).toHaveValue("Projeto a restaurar");
  await page.getByRole("link", { name: "Lixeira", exact: true }).click();
  const earlierEntry = page.getByRole("article", { name: "Exclusão anterior", exact: true });
  await expect(earlierEntry).toBeVisible();
  await earlierEntry.getByRole("button", { name: "Restaurar página", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${earlierChild}$`));
});

test("favorites and accent-insensitive keyboard search remain confined to the current workspace", async ({
  page,
}) => {
  const fixture = await workspace(page);
  const visibleTitle = "Orçamento café público";
  const hiddenTitle = "Orçamento café reservado";
  const visiblePath = await createRoot(page, fixture.path, visibleTitle);
  await page.getByRole("button", { name: "Adicionar aos favoritos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remover dos favoritos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Favoritos", exact: true }).click();
  await expect(page.getByRole("main").getByRole("link", { name: visibleTitle, exact: true })).toHaveAttribute(
    "href",
    visiblePath,
  );
  await page.goto("/workspaces/new");
  const otherWorkspace = await createWorkspace(page);
  await createRoot(page, otherWorkspace, hiddenTitle);
  await page.goto(fixture.path);
  const searchTrigger = page.getByRole("button", { name: /^Buscar páginas/ });
  await searchTrigger.click();
  const query = page.getByRole("combobox", { name: "Buscar neste workspace", exact: true });
  await expect(query).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(query).toBeHidden();
  await expect(searchTrigger).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(query).toBeFocused();
  await query.fill("orcamento cafe");
  await expect(page.getByRole("option", { name: visibleTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: hiddenTitle, exact: true })).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${visiblePath}$`));
  await page.getByRole("button", { name: "Remover dos favoritos", exact: true }).click();
  await page.getByRole("link", { name: "Favoritos", exact: true }).click();
  await expect(page.getByRole("main").getByRole("link", { name: visibleTitle, exact: true })).toHaveCount(0);

  await page.goto(fixture.path);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
  const navigation = page.getByRole("dialog", { name: "Navegação do workspace", exact: true });
  const mobileTrigger = navigation.getByRole("button", { name: /^Buscar páginas/ });
  await mobileTrigger.click();
  await expect(query).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(query).toBeHidden();
  await expect(navigation).toBeVisible();
  await expect(mobileTrigger).toBeFocused();
  await mobileTrigger.click();
  await query.fill("orcamento cafe");
  await expect(page.getByRole("option", { name: visibleTitle, exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${visiblePath}$`));
  await expect(query).toBeHidden();
  await expect(navigation).toBeHidden();
  await expect
    .poll(() => page.getByRole("main").evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
});

test("moving a page requires an explicit access preview before another member gains inherited access", async ({
  page,
}) => {
  const fixture = await workspace(page);
  const destination = await createRoot(page, fixture.path, "Destino compartilhado");
  const subject = await createRoot(page, fixture.path, "Conteúdo a mover");
  const subjectId = subject.split("/")[4] ?? "";
  const destinationId = destination.split("/")[4] ?? "";
  const reader = await account();
  const membership = await admin
    .from("workspace_members")
    .insert({ workspace_id: fixture.id, user_id: reader.id, role: "member" });
  expect(membership.error).toBeNull();
  const grant = await admin
    .from("page_grants")
    .insert({ workspace_id: fixture.id, page_id: destinationId, user_id: reader.id, role: "viewer" });
  expect(grant.error).toBeNull();
  const inheritance = await admin.from("pages").update({ restricted: false }).eq("id", subjectId);
  expect(inheritance.error).toBeNull();
  const readerClient = createClient<Database>(api, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await readerClient.auth.signInWithPassword({
    email: reader.email,
    password: reader.password,
  });
  expect(signedIn.error).toBeNull();
  const before = await readerClient.from("pages").select("id").eq("id", subjectId);
  expect(before.error).toBeNull();
  expect(before.data).toEqual([]);
  await page.goto(subject);
  await organize(page);
  await page.getByLabel("Buscar destino", { exact: true }).fill("Destino compartilhado");
  const destinations = page.getByLabel("Mover para", { exact: true });
  await expect(destinations).toContainText("Destino compartilhado");
  await destinations.selectOption({ label: "Destino compartilhado" });
  const moveButton = page.getByRole("button", { name: "Mover página", exact: true });
  await moveButton.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("checkbox", { name: "Confirmo a mudança de acesso", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(destinations).toHaveValue(destinationId);
  const unchanged = await readerClient.from("pages").select("id").eq("id", subjectId);
  expect(unchanged.error).toBeNull();
  expect(unchanged.data).toEqual([]);
  await confirmation.check();
  await moveButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Página movida." })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(subject);
  const after = await readerClient.from("pages").select("id").eq("id", subjectId);
  expect(after.error).toBeNull();
  expect(after.data).toEqual([{ id: subjectId }]);
  await page.goto(destination);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Conteúdo a mover", exact: true }),
  ).toHaveAttribute("href", subject);
});

test("a real PNG cover survives reload and removal while SVG input is rejected", async ({ page }) => {
  const fixture = await workspace(page);
  const subject = await createRoot(page, fixture.path, "Capa verificada");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const input = page.getByLabel("Capa da página", { exact: true });
  const cover = page.getByRole("img", { name: /capa/i });
  await input.setInputFiles({
    name: "denied.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error("unsafe")</script></svg>',
    ),
  });
  await expect(page.getByRole("alert").filter({ hasText: /PNG|JPEG|WebP|GIF/ })).toBeVisible();
  await expect(cover).toHaveCount(0);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8d8AAAAASUVORK5CYII=",
    "base64",
  );
  const imageResponse = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "image" &&
      response.headers()["content-type"]?.startsWith("image/png") === true,
  );
  await input.setInputFiles({ name: "synthetic-cover.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("status").filter({ hasText: "Capa atualizada." })).toBeVisible();
  await expect(cover).toBeVisible();
  const delivered = await imageResponse;
  expect(delivered.status()).toBe(200);
  expect(await delivered.body()).toEqual(png);
  await page.reload();
  await expect(cover).toBeVisible();
  await page.getByRole("button", { name: "Remover capa", exact: true }).click();
  await expect(cover).toHaveCount(0);
  await page.reload();
  expect(new URL(page.url()).pathname).toBe(subject);
  await expect(page.getByLabel("Nome da página", { exact: true })).toHaveValue("Capa verificada");
  await expect(cover).toHaveCount(0);
});

test("mobile tree and creation release navigation focus while long keyboard search stays visible", async ({
  page,
}) => {
  const fixture = await workspace(page);
  const subject = await createRoot(page, fixture.path, "Página para navegar");
  const favorite = page.getByRole("button", { name: "Adicionar aos favoritos", exact: true });
  await favorite.click();
  const selectedFavorite = page.getByRole("button", { name: "Remover dos favoritos", exact: true });
  await expect(selectedFavorite).toHaveAttribute("aria-pressed", "true");
  await expect(selectedFavorite.locator("svg")).not.toHaveCSS("fill", "none");
  const inserted = await admin.from("pages").insert(
    Array.from({ length: 60 }, (_, index) => ({
      workspace_id: fixture.id,
      owner_id: fixture.owner.id,
      created_by: fixture.owner.id,
      title: `Resultado longo ${index.toString().padStart(2, "0")}`,
      position: `b${index.toString().padStart(2, "0")}`,
    })),
  );
  expect(inserted.error).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
  const navigation = page.getByRole("dialog", { name: "Navegação do workspace", exact: true });
  await navigation.getByRole("link", { name: "Página para navegar", exact: true }).click();
  await expect(navigation).toBeHidden();
  await expect(page.getByRole("main")).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(subject);
  await page.keyboard.press("ControlOrMeta+k");
  const query = page.getByRole("combobox", { name: "Buscar neste workspace", exact: true });
  await query.fill("Resultado");
  await expect(
    page.getByRole("listbox", { name: "Páginas encontradas", exact: true }).getByRole("option"),
  ).toHaveCount(50);
  for (let index = 0; index < 40; index++) await page.keyboard.press("ArrowDown");
  const activeId = await query.getAttribute("aria-activedescendant");
  if (!activeId) throw Error("Search selection must identify its active result");
  const visible = await page.locator(`[id="${activeId}"]`).evaluate((element) => {
    const option = element.getBoundingClientRect();
    const bounds = element.closest("dialog")?.getBoundingClientRect();
    return Boolean(bounds && option.top >= bounds.top && option.bottom <= bounds.bottom);
  });
  expect(visible).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
  await navigation.getByRole("button", { name: "Criar página no workspace", exact: true }).click();
  await expect(navigation).toBeHidden();
  await expect(page.getByLabel("Nome da página", { exact: true })).toBeFocused();
});

test("keyboard and pointer organization persist while Escape cancels a pending drag", async ({ page }) => {
  const fixture = await workspace(page);
  for (const title of ["Primeira", "Segunda", "Terceira"]) await createRoot(page, fixture.path, title);
  await page.goto(fixture.path);
  const list = page.getByRole("main").getByRole("list", { name: "Páginas", exact: true });
  const links = list.getByRole("link");
  await expect(links).toHaveText(["Primeira", "Segunda", "Terceira"]);

  await list.getByRole("button", { name: "Mover Primeira", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: "Página movida." })).toBeVisible();
  await expect(links).toHaveText(["Segunda", "Primeira", "Terceira"]);
  await page.reload();
  await expect(links).toHaveText(["Segunda", "Primeira", "Terceira"]);

  await list.getByRole("button", { name: "Mover Segunda", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(links).toHaveText(["Segunda", "Primeira", "Terceira"]);
  await page.reload();
  await expect(links).toHaveText(["Segunda", "Primeira", "Terceira"]);

  const handle = await list.getByRole("button", { name: "Mover Terceira", exact: true }).boundingBox();
  const destination = await links.filter({ hasText: "Segunda" }).boundingBox();
  if (!handle || !destination) throw new Error("Reorder controls must be visible for pointer interaction.");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 12, { steps: 3 });
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 4, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(page.getByRole("status").filter({ hasText: "Página movida." })).toBeVisible();
  await expect(links).toHaveText(["Terceira", "Segunda", "Primeira"]);
  await page.reload();
  await expect(links).toHaveText(["Terceira", "Segunda", "Primeira"]);

  const firstPath = await links.filter({ hasText: "Primeira" }).getAttribute("href");
  const thirdPath = await links.filter({ hasText: "Terceira" }).getAttribute("href");
  if (!firstPath || !thirdPath) throw new Error("Pages must retain navigable identities before reparenting.");
  const moving = await list.getByRole("button", { name: "Mover Terceira", exact: true }).boundingBox();
  if (!moving) throw new Error("Reparent control must be visible.");
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2);
  await page.mouse.down();
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2 + 12, { steps: 3 });
  const inside = list.locator('[title="Colocar dentro de Primeira"]');
  await expect(inside).toBeVisible();
  const folder = await inside.boundingBox();
  if (!folder) throw new Error("Visible folder drop destination must have a pointer target.");
  const outside = Math.min((page.viewportSize()?.width ?? 1280) - 8, folder.x + folder.width + 40);
  await page.mouse.move(outside, moving.y + moving.height / 2, { steps: 10 });
  const destinationFolder = await inside.boundingBox();
  if (!destinationFolder) throw new Error("Folder destination must remain visible during the drag.");
  await page.mouse.move(outside, destinationFolder.y + destinationFolder.height / 2, { steps: 10 });
  await inside.hover();
  await expect(inside).toHaveAttribute("data-drop-target", "true");
  await page.mouse.up();
  await expect(page.getByRole("status").filter({ hasText: "Página movida." })).toBeVisible();
  await expect(links).toHaveText(["Segunda", "Primeira"]);
  await page.reload();
  await expect(links).toHaveText(["Segunda", "Primeira"]);
  const movedPage = await admin
    .from("pages")
    .select("parent_id")
    .eq("id", thirdPath.split("/")[4] ?? "")
    .single();
  expect(movedPage.error).toBeNull();
  const movedParent = await admin
    .from("pages")
    .select("title")
    .eq("id", movedPage.data?.parent_id ?? "")
    .single();
  expect(movedParent.error).toBeNull();
  expect(movedParent.data?.title).toBe("Primeira");
  expect(movedPage.data).toEqual({ parent_id: firstPath.split("/")[4] });
  await page.goto(firstPath);
  await expect(page.getByRole("main").getByRole("link", { name: "Terceira", exact: true })).toHaveAttribute(
    "href",
    thirdPath,
  );
});
