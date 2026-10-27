import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY;
if (
  process.env.BLOCO_TEST_STACK !== "bloco-test" ||
  api !== "http://127.0.0.1:55321" ||
  process.env.APP_URL !== "http://127.0.0.1:3001" ||
  !key
)
  throw new Error("Locale acceptance requires the isolated synthetic stack.");
const admin = createClient<Database>(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const users: string[] = [];
async function accessible(page: Page, scope: string) {
  const result = await new AxeBuilder({ page })
    .include(scope)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}
async function removeObjects(prefix: string, depth = 0): Promise<void> {
  if (depth > 8) throw new Error("Unexpected synthetic archive depth");
  const listed = await admin.storage.from("interchange").list(prefix, { limit: 1000 });
  if (listed.error) throw new Error("Synthetic archive cleanup failed");
  const files: string[] = [];
  for (const entry of listed.data) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id) files.push(path);
    else await removeObjects(path, depth + 1);
  }
  if (files.length && (await admin.storage.from("interchange").remove(files)).error)
    throw new Error("Synthetic object cleanup failed");
}
test.afterAll(async () => {
  for (const id of users) {
    const jobs = await admin.from("interchange_jobs").select("id,workspace_id").eq("actor_id", id);
    if (jobs.error) throw new Error("Synthetic job cleanup failed");
    for (const job of jobs.data) await removeObjects(`${job.workspace_id}/${id}/${job.id}`);
    if ((await admin.from("workspaces").delete().eq("created_by", id)).error)
      throw new Error("Synthetic workspace cleanup failed");
    if ((await admin.auth.admin.deleteUser(id)).error)
      throw new Error("Synthetic locale account cleanup failed");
  }
});
/** One stored ZIP member; real headers and CRC exercise the production parser. */
function archive(name: string, text: string): Buffer {
  const filename = Buffer.from(name),
    bytes = Buffer.from(text),
    crc = crc32(bytes);
  const local = Buffer.alloc(30),
    directory = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(filename.length, 26);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x800, 8);
  directory.writeUInt16LE(33, 14);
  directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(bytes.length, 20);
  directory.writeUInt32LE(bytes.length, 24);
  directory.writeUInt16LE(filename.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + bytes.length, 16);
  return Buffer.concat([local, filename, bytes, directory, filename, end]);
}

test("English preference persists through real auth, editor, database, comments, sharing and import", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const email = `locale-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const account = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Pessoa de teste" },
  });
  if (account.error || !account.data.user) throw new Error("Synthetic locale fixture failed");
  users.push(account.data.user.id);
  await page.goto("/login");
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
  await accessible(page, "#main");
  const preference = (await context.cookies()).find((cookie) => cookie.name === "bloco-locale");
  expect(preference).toMatchObject({ value: "en", httpOnly: true, secure: false, sameSite: "Lax" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Workspace name", { exact: true }).fill("Caderno autoral em português");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  const workspacePath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByLabel("Page name", { exact: true }).fill("Título escrito pela pessoa");
  await page.getByRole("button", { name: "Save page", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Page updated." })).toBeVisible();
  const pagePath = new URL(page.url()).pathname;
  const text = page.getByRole("textbox", { name: "Block text", exact: true });
  await text.first().click();
  await page.keyboard.type("Conteúdo autoral preservado.");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await page.getByLabel("New page comment", { exact: true }).fill("Comentário autoral preservado.");
  await page.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(
    page.locator(".comment-body").filter({ hasText: "Comentário autoral preservado." }),
  ).toBeVisible();
  const metadataResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/sharing") && url.search === "" && response.request().method() === "GET";
  });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const metadata = await metadataResponse;
  expect(metadata.status(), await metadata.text()).toBe(200);
  const sharing = page.getByRole("dialog", { name: "Share page", exact: true });
  await expect(sharing.getByRole("combobox", { name: /^Default member access/ })).toBeVisible();
  await sharing.getByRole("button", { name: "Publish page", exact: true }).click();
  const publicURL = await sharing.getByLabel("Public link", { exact: true }).inputValue();
  await accessible(page, ".sharing-dialog");
  await page.keyboard.press("Tab");
  await expect(sharing.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sharing).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeFocused();
  const published = await context.newPage();
  await published.goto(publicURL);
  await expect(published.getByText("Shared page · read only", { exact: true })).toBeVisible();
  await expect(published.getByText("Conteúdo autoral preservado.", { exact: true })).toBeVisible();
  await accessible(published, ".public-page");
  await published.close();
  await accessible(page, ".page-document");
  await page.getByLabel("Language", { exact: true }).selectOption("pt-BR");
  await expect(page.getByRole("textbox", { name: "Texto do bloco", exact: true }).first()).toHaveText(
    "Conteúdo autoral preservado.",
  );
  await expect(page.getByLabel("Nome da página", { exact: true })).toHaveValue("Título escrito pela pessoa");
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto(workspacePath);
  await page.getByRole("button", { name: "New database", exact: true }).click();
  await expect(page.locator(".db-workspace")).toBeVisible();
  await accessible(page, ".db-workspace");
  await page.getByRole("button", { name: "New record", exact: true }).click();
  const record = page.getByRole("dialog", { name: "New record", exact: true });
  await record.getByLabel("Record title", { exact: true }).fill("Registro autoral");
  await record.getByRole("button", { name: "Create record", exact: true }).click();
  await expect(page.getByLabel("Page name", { exact: true })).toHaveValue("Registro autoral");
  await page.goto(pagePath);
  await page.getByRole("button", { name: "Import / export", exact: true }).click();
  const interchange = page.getByRole("dialog", { name: "Import and export", exact: true });
  await interchange.getByLabel("Original ZIP archive", { exact: true }).setInputFiles({
    name: "English import.zip",
    mimeType: "application/zip",
    buffer: archive("Notas.md", "# Texto importado\n\nConteúdo importado preservado."),
  });
  await interchange.getByRole("button", { name: "Upload and validate ZIP", exact: true }).click();
  await expect(interchange.getByText("Preview for review", { exact: true }).first()).toBeVisible();
  await accessible(page, ".interchange-dialog");
  await interchange
    .getByLabel(
      "I reviewed the inventory, mappings and notices. I authorize creating new pages for this import.",
      { exact: true },
    )
    .check();
  await interchange.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(interchange.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(interchange.getByRole("button", { name: "Refresh job", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(interchange).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Import / export", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Page name", { exact: true })).toHaveValue("Título escrito pela pessoa");
});
