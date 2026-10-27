import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (process.env.BLOCO_TEST_STACK !== "bloco-test" || api !== "http://127.0.0.1:55321" || !key)
  throw new Error("Editor UI tests require the isolated synthetic stack.");
const admin = createClient<Database>(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts: string[] = [];
test.describe.configure({ timeout: 90000 });

async function setup(page: Page) {
  const email = `editor-ui-${randomUUID()}@example.test`;
  const password = `Synthetic-Editor-${randomUUID()}`;
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error("Synthetic editor account failed.");
  accounts.push(result.data.user.id);
  await login(page, email, password);
  await page.getByLabel("Nome do workspace").fill("Caderno de pesquisa");
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  await page.getByRole("button", { name: "Nova página", exact: true }).click();
  await page.getByLabel("Nome da página", { exact: true }).fill("Notas do encontro");
  await page.getByRole("button", { name: "Salvar página", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Página atualizada." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Texto do bloco", exact: true })).toHaveCount(1);
  return { email, password, path: new URL(page.url()).pathname };
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:workspaces\/new|w\/[a-f0-9-]+)$/);
}

function text(page: Page) {
  return page.getByRole("textbox", { name: "Texto do bloco", exact: true });
}
async function saved(page: Page) {
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
}
async function command(page: Page, query: string, label: string) {
  await text(page).last().click();
  await page.keyboard.type(`/${query}`);
  const editorState = await page.locator(".page-editor").evaluate((element) => ({
    blocks: [...element.querySelectorAll('[role="textbox"]')].map((node) => node.outerHTML),
    focus: document.activeElement?.getAttribute("role"),
    menu: element.querySelector('[role="listbox"]')?.textContent,
  }));
  await expect(
    page.getByRole("listbox").getByRole("option", { name: label, exact: false }),
    JSON.stringify(editorState),
  ).toBeVisible();
  await page.keyboard.press("Enter");
}

test.afterAll(async () => {
  for (const id of accounts) {
    const removed = await admin.from("workspaces").delete().eq("created_by", id);
    if (removed.error) throw new Error("Synthetic editor workspace cleanup failed.");
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) throw new Error("Synthetic editor account cleanup failed.");
  }
});

test("Backspace and Delete edit text without removing the block and persist after reload", async ({
  page,
}) => {
  await setup(page);
  await text(page).click();
  await page.keyboard.type("Texto abc");
  await page.keyboard.press("Backspace");
  await expect(text(page)).toHaveText("Texto ab");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Delete");
  await expect(text(page)).toHaveText("Texto a");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await expect(text(page)).toHaveCount(1);
  await expect(text(page)).toHaveText("");
  await page.keyboard.type("A👨‍👩‍👧‍👦");
  await page.keyboard.press("Backspace");
  await expect(text(page)).toHaveText("A");
  await page.keyboard.press("Backspace");
  await expect(text(page)).toHaveText("");
  await page.keyboard.type("Texto preservado");
  await saved(page);
  await page.reload();
  await expect(text(page)).toHaveText("Texto preservado");
});

test("real writing, split, inline marks, undo and reload preserve the saved document", async ({ page }) => {
  await setup(page);
  await text(page).click();
  await page.keyboard.type("Primeira ideia");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Segunda ideia");
  await expect(text(page)).toHaveCount(2);
  await expect(text(page).last()).toHaveText("Segunda ideia");
  await expect(text(page).last()).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Segunda ideia");
  await page.keyboard.press("Control+b");
  await expect(
    text(page).last().locator("strong"),
    JSON.stringify(
      await text(page)
        .last()
        .evaluate((element) => {
          const editor = (
            element as HTMLElement & {
              editor?: {
                state: { selection: { from: number; to: number }; storedMarks: unknown };
                isEditable: boolean;
              };
            }
          ).editor;
          return {
            html: element.outerHTML,
            from: editor?.state.selection.from,
            to: editor?.state.selection.to,
            marks: editor?.state.storedMarks,
            native: window.getSelection()?.toString(),
            editable: editor?.isEditable,
          };
        }),
    ),
  ).toHaveText("Segunda ideia");
  await saved(page);
  await page.reload();
  await expect(text(page).first()).toHaveText("Primeira ideia");
  await expect(text(page).last().locator("strong")).toHaveText("Segunda ideia");
  await text(page).last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" adicional");
  await page.keyboard.press("Control+z");
  await expect(text(page).last()).toHaveText("Segunda ideia");
  await page.keyboard.press("Control+Shift+z");
  await expect(text(page).last()).toHaveText("Segunda ideia adicional");
  await saved(page);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("slash commands and simple-table keyboard editing survive reload", async ({ page }) => {
  await setup(page);
  await command(page, "titulo", "Título 1");
  await page.keyboard.type("Caderno de campo");
  await expect(page.locator('[data-block-type="heading"]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(text(page)).toHaveCount(2);
  await command(page, "tabela", "Tabela simples");
  const cells = page.locator(".editor-table-cell");
  await expect(cells).toHaveCount(4);
  await cells.first().getByRole("textbox").click();
  await page.keyboard.type("Local");
  await page.keyboard.press("Tab");
  await expect(cells.nth(1).getByRole("textbox")).toBeFocused();
  await page.keyboard.type("Observação");
  await expect(cells.nth(1).getByRole("textbox")).toHaveText("Observação");
  await cells.last().getByRole("textbox").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("Nova linha");
  await expect(cells).toHaveCount(6);
  await expect(cells.nth(4).getByRole("textbox")).toHaveText("Nova linha");
  await saved(page);
  await page.reload();
  await expect(page.locator('[data-block-type="heading"]')).toContainText("Caderno de campo");
  await expect(cells.first().getByRole("textbox")).toHaveText("Local");
  await expect(cells.nth(1).getByRole("textbox")).toHaveText("Observação");
});

test("two real editor sessions merge typing and retain both contributions on reload", async ({
  page,
  browser,
}) => {
  const fixture = await setup(page);
  await text(page).click();
  await page.keyboard.type("Começo ");
  await saved(page);
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await login(other, fixture.email, fixture.password);
    await other.goto(fixture.path);
    await expect(text(other)).toHaveText("Começo ");
    await text(page).click();
    await page.keyboard.press("End");
    await text(other).click();
    await other.keyboard.press("End");
    await Promise.all([page.keyboard.type("daqui "), other.keyboard.type("de lá ")]);
    await saved(page);
    await saved(other);
    await page.reload();
    await other.reload();
    for (const view of [page, other]) {
      await expect(text(view)).toContainText("daqui");
      await expect(text(view)).toContainText("de lá");
    }
  } finally {
    await context.close();
  }
});

test("private image and attachment uploads remain usable after document reload", async ({ page }) => {
  await setup(page);
  await command(page, "imagem", "Imagem");
  const imageBlock = page.locator('[data-block-type="image"]');
  await expect(imageBlock).toHaveCount(1);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8d8AAAAASUVORK5CYII=",
    "base64",
  );
  await imageBlock
    .getByLabel("Imagem do bloco", { exact: true })
    .setInputFiles({ name: "caderno.png", mimeType: "image/png", buffer: png });
  await expect(imageBlock.getByRole("status")).toHaveText("Arquivo adicionado.");
  await imageBlock.getByLabel("Descrição da imagem", { exact: true }).fill("Ponto claro do caderno");
  await imageBlock.getByLabel("Legenda", { exact: true }).fill("Registro visual");
  await page.getByRole("button", { name: "Adicionar bloco de texto", exact: true }).click();
  await expect(text(page)).toHaveCount(1);
  await command(page, "arquivo", "Arquivo");
  const attachment = page.locator('[data-block-type="file"]');
  await expect(attachment).toHaveCount(1);
  await attachment.getByLabel("Arquivo do bloco", { exact: true }).setInputFiles({
    name: "notas.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Notas sintéticas de campo."),
  });
  await expect(attachment.getByRole("status")).toHaveText("Arquivo adicionado.");
  await saved(page);
  await page.reload();
  await expect(imageBlock.getByRole("img", { name: "Ponto claro do caderno", exact: true })).toBeVisible();
  await expect(imageBlock.locator("figcaption")).toHaveText("Registro visual");
  const link = attachment.getByRole("link");
  await expect(link).toContainText("notas.txt");
  const response = await page.request.get((await link.getAttribute("href")) ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(await response.text()).toBe("Notas sintéticas de campo.");
});

test("Markdown, composition and sanitized rich-text paste keep canonical writing safe", async ({ page }) => {
  await setup(page);
  await text(page).click();
  await page.keyboard.type("## ");
  await expect(page.locator('[data-block-type="heading"] [aria-level="2"]')).toBeVisible();
  await page.keyboard.type("Notas em campo");
  await page.keyboard.press("Enter");
  await expect(text(page).last()).toBeFocused();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "漢字", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "漢字" });
  await cdp.detach();
  await expect(text(page).last()).toContainText("漢字");
  await page.keyboard.press("Enter");
  await expect(text(page).last()).toBeFocused();
  await text(page)
    .last()
    .evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p><strong>Conteúdo seguro</strong><script>window.blocoInjected=true</script><a href="javascript:alert(1)"> endereço</a></p>',
      );
      clipboardData.setData("text/plain", "Conteúdo seguro endereço");
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
  await expect(text(page).last().locator("strong")).toHaveText("Conteúdo seguro");
  await expect(text(page).last().locator('script,a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, "blocoInjected"))).toBe(false);
  await saved(page);
  await page.reload();
  await expect(text(page).last().locator("strong")).toHaveText("Conteúdo seguro");
  await expect(page.locator(".page-editor")).toContainText("漢字");
});

test("structural keyboard selection duplicates, moves and restores blocks without changing their text", async ({
  page,
}) => {
  await setup(page);
  await text(page).click();
  await page.keyboard.type("Um");
  await page.keyboard.press("Enter");
  await expect(text(page).last()).toBeFocused();
  await page.keyboard.type("Dois");
  await page.keyboard.press("Escape");
  const frames = page.locator("[data-editor-block]");
  await expect(frames.last()).toBeFocused();
  await page.keyboard.press("Control+d");
  await expect(text(page)).toHaveCount(3);
  await expect(text(page).last()).toHaveText("Dois");
  await page.keyboard.press("Delete");
  await expect(text(page)).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(text(page)).toHaveCount(3);
  await saved(page);
  await page.reload();
  await expect(text(page)).toHaveText(["Um", "Dois", "Dois"]);
});

test("task names and popup choices are exposed by the focused writing control", async ({ page }) => {
  await setup(page);
  await text(page).click();
  await page.keyboard.type("[] Revisar o caderno");
  const task = page.locator('[data-block-type="task"]');
  await expect(task.getByRole("checkbox")).toHaveAccessibleName(/Revisar o caderno/);
  const toolbar = page.getByRole("toolbar", { name: "Formatar texto" });
  await expect(toolbar.getByText("Cor do texto", { exact: true })).toBeVisible();
  await expect(toolbar.getByText("Cor de fundo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Adicionar bloco de texto", exact: true }).click();
  await expect(text(page).last()).toBeFocused();
  await page.keyboard.type("/");
  const list = page.getByRole("listbox", { name: "Adicionar bloco", exact: true });
  await expect(list).toBeVisible();
  const id = await list.getAttribute("id");
  if (!id) throw new Error("Popup list must have an accessible identity.");
  await expect(text(page).last()).toHaveAttribute("aria-controls", id);
  await expect(text(page).last()).toHaveAttribute(
    "aria-activedescendant",
    (await list.getByRole("option").first().getAttribute("id")) ?? "",
  );
  await page.keyboard.press("ArrowDown");
  await expect(text(page).last()).toHaveAttribute(
    "aria-activedescendant",
    (await list.getByRole("option").nth(1).getAttribute("id")) ?? "",
  );
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(text(page).last()).not.toHaveAttribute("aria-controls");
});

test("page mentions resolve current titles and selected text accepts a safe external link", async ({
  page,
}) => {
  const source = await setup(page);
  await page.getByRole("button", { name: "Adicionar subpágina", exact: true }).click();
  await page.getByLabel("Nome da página", { exact: true }).fill("Referência de leitura");
  await page.getByRole("button", { name: "Salvar página", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Página atualizada." })).toBeVisible();
  const targetPath = new URL(page.url()).pathname;
  await page.goto(source.path);
  await text(page).click();
  await page.keyboard.type("Veja @Referência");
  const choices = page.getByRole("listbox", { name: "Páginas disponíveis", exact: true });
  await expect(choices.getByRole("option", { name: "Referência de leitura", exact: true })).toBeVisible();
  await expect(text(page)).toHaveAttribute("aria-controls", (await choices.getAttribute("id")) ?? "");
  await page.keyboard.press("Enter");
  await expect(text(page).getByRole("link", { name: "Referência de leitura", exact: true })).toHaveAttribute(
    "href",
    targetPath,
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Abrir registro");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Adicionar link", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Endereço do link", { exact: true }).fill("https://example.test/registro");
  await dialog.getByRole("button", { name: "Salvar link", exact: true }).click();
  const link = text(page).last().getByRole("link", { name: "Abrir registro", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.test/registro");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await saved(page);
  await page.goto(targetPath);
  await page.getByLabel("Nome da página", { exact: true }).fill("Leitura revisada");
  await page.getByRole("button", { name: "Salvar página", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Página atualizada." })).toBeVisible();
  await page.goto(source.path);
  await expect(text(page).first().getByRole("link", { name: "Leitura revisada", exact: true })).toBeVisible();
  await expect(text(page).last().getByRole("link", { name: "Abrir registro", exact: true })).toHaveAttribute(
    "href",
    "https://example.test/registro",
  );
});

test("keyboard block dragging reorders stable identities and Escape cancels a later drag", async ({
  page,
}) => {
  await setup(page);
  await text(page).click();
  await page.keyboard.type("Primeiro");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Segundo");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Terceiro");
  const frames = page.locator("[data-editor-block]");
  const identities = await frames.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-editor-block")),
  );
  const handle = frames.first().getByRole("button", { name: "Mover ou selecionar bloco 1", exact: true });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(text(page)).toHaveText(["Segundo", "Primeiro", "Terceiro"]);
  await frames.first().getByRole("button", { name: "Mover ou selecionar bloco 1", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(text(page)).toHaveText(["Segundo", "Primeiro", "Terceiro"]);
  await saved(page);
  await page.reload();
  await expect(text(page)).toHaveText(["Segundo", "Primeiro", "Terceiro"]);
  expect(
    await frames.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-editor-block"))),
  ).toEqual([identities[1], identities[0], identities[2]]);
});

test("the remaining block catalog and column composition preserve content through reload", async ({
  page,
}) => {
  await setup(page);
  const commands = [
    ["h3", "Título 3", "heading"],
    ["marcadores", "Lista com marcadores", "bulletListItem"],
    ["numerada", "Lista numerada", "numberListItem"],
    ["toggle", "Recolhível", "toggle"],
    ["citacao", "Citação", "quote"],
    ["destaque", "Destaque", "callout"],
    ["divisor", "Divisor", "divider"],
    ["codigo", "Código", "code"],
  ];
  for (const [index, entry] of commands.entries()) {
    const [query, label, kind] = entry;
    if (!query || !label || !kind) throw new Error("Missing catalog fixture.");
    if (index) await page.getByRole("button", { name: "Adicionar bloco de texto", exact: true }).click();
    await command(page, query, label);
    const block = page.locator(`[data-block-type="${kind}"]`).last();
    await expect(block).toBeVisible();
    if (kind !== "divider") {
      await block.getByRole("textbox", { name: "Texto do bloco", exact: true }).click();
      await page.keyboard.type(kind === "code" ? "const registro = 1;" : `Conteúdo ${label}`);
    }
    if (kind === "code") {
      await block.getByLabel("Linguagem do código", { exact: true }).selectOption("javascript");
      await expect(block.locator(".code-keyword")).toContainText("const");
    }
  }
  await page.getByRole("button", { name: "Adicionar bloco de texto", exact: true }).click();
  await command(page, "colunas", "Colunas");
  const group = page.locator('[data-block-type="columns"]');
  const columns = group.locator('[data-block-type="column"]');
  await expect(columns).toHaveCount(2);
  await columns.first().getByRole("textbox").click();
  await page.keyboard.type("Material A");
  await columns.nth(1).getByRole("textbox").click();
  await page.keyboard.type("Material B");
  await group.getByRole("button", { name: "Adicionar coluna", exact: true }).click();
  await expect(columns).toHaveCount(3);
  await columns.nth(2).getByRole("button", { name: "Escrever nesta coluna", exact: true }).click();
  await page.keyboard.type("Material C");
  const movedId = await columns.nth(2).locator("[data-block-text]").getAttribute("data-block-text");
  if (!movedId) throw new Error("Column text must have a stable identity.");
  await group.getByLabel("Largura relativa da coluna 1", { exact: true }).fill("2");
  await page.keyboard.press("Enter");
  await group.getByRole("button", { name: "Remover coluna 3", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Remover coluna?", exact: true })
    .getByRole("button", { name: "Remover coluna", exact: true })
    .click();
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(1).locator(`[data-block-text="${movedId}"]`)).toHaveText("Material C");
  await saved(page);
  await page.reload();
  await expect(columns).toHaveCount(2);
  await expect(group.getByLabel("Largura relativa da coluna 1", { exact: true })).toHaveValue("2");
  await expect(columns.nth(1).locator(`[data-block-text="${movedId}"]`)).toHaveText("Material C");
  await expect(page.locator('[data-block-type="code"] .code-keyword')).toContainText("const");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(group.locator(".editor-columns > .editor-block-children")).toHaveCSS(
    "grid-template-columns",
    /^\d+(?:\.\d+)?px$/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
