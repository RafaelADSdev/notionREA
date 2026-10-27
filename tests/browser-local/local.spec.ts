import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function saved(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved");
}
test("local notes survive reload and a full backup restores in an empty browser", async ({
  page,
  browser,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.hostname.endsWith(".supabase.co") || url.port === "55321")
      requests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Seu próximo texto começa aqui." })).toBeVisible();
  await page.locator(".local-sidebar").getByRole("button", { name: "Nova página", exact: true }).click();
  await page.getByLabel("Título da página", { exact: true }).fill("Minha nota local");
  const body = page.getByRole("textbox", { name: "Texto do bloco", exact: true }).first();
  await body.click();
  await page.keyboard.type("Texto persistente sem servidor");
  await saved(page);
  await page.reload();
  await expect(page.getByLabel("Título da página", { exact: true })).toHaveValue("Minha nota local");
  await expect(body).toHaveText("Texto persistente sem servidor");
  await page.getByRole("button", { name: "Favoritar", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar backup", exact: true }).click();
  const download = await downloadPromise,
    path = await download.path();
  if (!path) throw new Error("Backup download unavailable");
  const backup = await readFile(path);
  expect(JSON.parse(backup.toString()).format).toBe("bloco-local");
  const context = await browser.newContext();
  try {
    const restored = await context.newPage();
    await restored.goto("http://127.0.0.1:3002");
    await expect(restored.getByRole("heading", { name: "Seu próximo texto começa aqui." })).toBeVisible();
    await restored
      .locator('input[type="file"]')
      .setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: backup });
    await expect(restored.getByRole("status")).toContainText("Páginas ausentes restauradas");
    await restored.locator(".local-pages").getByRole("button", { name: "Minha nota local" }).click();
    await expect(restored.getByRole("textbox", { name: "Texto do bloco", exact: true }).first()).toHaveText(
      "Texto persistente sem servidor",
    );
    await restored.getByRole("button", { name: "Mover para lixeira", exact: true }).click();
    await restored.getByRole("button", { name: "Lixeira", exact: true }).click();
    await restored.getByRole("button", { name: "Restaurar página: Minha nota local", exact: true }).click();
    await restored.getByRole("button", { name: "Todas", exact: true }).click();
    await restored.locator(".local-pages").getByRole("button", { name: "Minha nota local" }).click();
    await expect(restored.getByRole("textbox", { name: "Texto do bloco", exact: true }).first()).toHaveText(
      "Texto persistente sem servidor",
    );
  } finally {
    await context.close();
  }
  await page.getByRole("combobox", { name: "Idioma", exact: true }).selectOption("en");
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue(
    "Minha nota local",
  );
  await page.getByRole("button", { name: "Change theme", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue(
    "Minha nota local",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("pt-BR");
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Abrir páginas", exact: true });
  await menu.click();
  await expect(page.getByRole("dialog", { name: "Páginas", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze())
      .violations,
  ).toEqual([]);
  expect(requests).toEqual([]);
});

test("two tabs merge edits and a failed IndexedDB write keeps the draft until retry", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.locator(".local-sidebar").getByRole("button", { name: "Nova página", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Texto do bloco", exact: true }).first();
  await expect(body).toBeVisible();
  await saved(page);
  const other = await context.newPage();
  await other.goto(page.url());
  const otherBody = other.getByRole("textbox", { name: "Texto do bloco", exact: true }).first();
  await expect(otherBody).toBeVisible();
  await body.click();
  await page.keyboard.type("Alpha");
  await otherBody.click();
  await other.keyboard.type("Beta");
  await expect(body).toContainText("Alpha");
  await expect(body).toContainText("Beta");
  await expect(otherBody).toContainText("Alpha");
  await expect(otherBody).toContainText("Beta");
  await saved(page);
  await saved(other);
  await other.close();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("Synthetic quota failure", "QuotaExceededError");
    };
  });
  await body.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" retained");
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "error");
  await expect(body).toContainText("retained");
  await page.getByRole("button", { name: "Tentar salvar novamente", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(body).toContainText("Alpha");
  await expect(body).toContainText("Beta");
  await expect(body).toContainText("retained");
});
