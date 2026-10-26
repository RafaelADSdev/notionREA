import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import * as Y from "yjs";
import AxeBuilder from "@axe-core/playwright";
import type { Database } from "../src/lib/supabase/database.types";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (api !== "http://127.0.0.1:55321" || !secret)
  throw new Error("E2E accepts only the isolated local Supabase project");
const admin = createClient<Database>(api, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const fixtures: { id: string; email: string; password: string }[] = [];

async function account() {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = `Fixture-Only-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error("Unable to prepare synthetic account");
  const fixture = { id: data.user.id, email, password };
  fixtures.push(fixture);
  return fixture;
}

async function login(page: Page, fixture: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
  await page.getByLabel("Senha", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function mailLink(email: string) {
  let link: string | null = null;
  await expect
    .poll(async () => {
      const response = await fetch("http://127.0.0.1:55324/api/v1/messages");
      const index = (await response.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
      const message = index.messages.find((item) => item.To.some((recipient) => recipient.Address === email));
      if (!message) return false;
      const detail = (await (await fetch(`http://127.0.0.1:55324/api/v1/message/${message.ID}`)).json()) as {
        HTML: string;
        Text: string;
      };
      const candidate = (detail.HTML || detail.Text).match(
        /https?:\/\/127\.0\.0\.1:55321\/auth\/v1\/verify[^\s"<>]+/,
      )?.[0];
      if (candidate) link = candidate.replaceAll("&amp;", "&");
      return Boolean(link);
    })
    .toBe(true);
  if (!link) throw new Error("Synthetic confirmation message not found");
  return link;
}

test.afterAll(async () => {
  for (const fixture of fixtures) {
    await admin.from("workspaces").delete().eq("created_by", fixture.id);
  }
  for (const fixture of fixtures) await admin.auth.admin.deleteUser(fixture.id);
});

test("public access, errors, callback boundaries and accessible login", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("E-mail", { exact: true }).fill("missing@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Incorrect-Password-42");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const failure = page.getByRole("alert").filter({ hasText: "Não foi possível entrar" });
  await expect(failure).toContainText("Não foi possível entrar");
  await expect(failure).toBeFocused();
  await page.goto("/auth/callback?code=invalid&next=https://untrusted.example");
  await expect(page).toHaveURL(/\/login\?status=callback-error/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Este link não pôde ser confirmado" }),
  ).toBeVisible();
  for (const name of ["Esqueci minha senha", "Criar uma conta"]) {
    const target = await page.getByRole("link", { name, exact: true }).boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
  }
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("email signup confirms a real local message before entering", async ({ page }) => {
  const email = `signup-${randomUUID()}@example.test`;
  const password = `Fixture-Signup-${randomUUID()}`;
  await page.goto("/register");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Confira seu e-mail");
  await page.goto(await mailLink(email));
  await expect(page).toHaveURL(/\/workspaces\/new$/);
  const publicClient = createClient(api, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false },
  });
  const { data } = await publicClient.auth.signInWithPassword({ email, password });
  if (!data.user) throw new Error("Synthetic account was not confirmed");
  fixtures.push({ id: data.user.id, email, password });
});

test("team pagination keeps every member reachable without duplicate rows", async ({ page }) => {
  const owner = await account();
  await login(page, owner);
  await page.getByLabel("Nome do workspace").fill("Equipe paginada");
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  const workspacePath = new URL(page.url()).pathname;
  const members = [];
  for (let batch = 0; batch < 6; batch += 1) {
    members.push(...(await Promise.all(Array.from({ length: 10 }, () => account()))));
  }
  const { error } = await admin.from("workspace_members").insert(
    members.map((member) => ({
      workspace_id: workspacePath.split("/").at(-1) ?? "",
      user_id: member.id,
      role: "member",
    })),
  );
  if (error) throw new Error("Unable to prepare paginated synthetic team");
  await page.getByRole("link", { name: "Abrir equipe", exact: true }).click();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(50);
  const firstPage = await rows.locator("td:first-child").allTextContents();
  await page.getByRole("link", { name: "Próximos membros", exact: true }).click();
  await expect(rows).toHaveCount(11);
  const secondPage = await rows.locator("td:first-child").allTextContents();
  expect(new Set([...firstPage, ...secondPage]).size).toBe(61);
  await expect(page.getByRole("link", { name: "Próximos membros", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Primeiros membros", exact: true }).click();
  await expect(rows).toHaveCount(50);
});

test("an open private revision channel never substitutes for current content authorization", async () => {
  const owner = await account();
  const viewer = await account();
  const client = createClient<Database>(api, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email: viewer.email,
    password: viewer.password,
  });
  if (signInError || !session.session) throw new Error("Synthetic viewer login failed");
  await client.realtime.setAuth(session.session.access_token);
  const workspaceId = randomUUID();
  const pageId = randomUUID();
  for (const result of [
    await admin
      .from("workspaces")
      .insert({ id: workspaceId, name: "Realtime fixture", created_by: owner.id }),
    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: owner.id, role: "owner" },
      { workspace_id: workspaceId, user_id: viewer.id, role: "member" },
    ]),
    await admin.from("pages").insert({
      id: pageId,
      workspace_id: workspaceId,
      owner_id: owner.id,
      created_by: owner.id,
      title: "Synthetic private page",
      position: "a",
    }),
    await admin
      .from("page_grants")
      .insert({ page_id: pageId, workspace_id: workspaceId, user_id: viewer.id, role: "viewer" }),
  ])
    if (result.error) throw new Error("Unable to prepare revision channel fixture");
  const events: unknown[] = [];
  let replicationReady = false;
  const channel = client
    .channel(`page:${pageId}`, { config: { private: true, broadcast: { replication_ready: true } } })
    .on("broadcast", { event: "revision" }, (event) => events.push(event.payload))
    .on("system", {}, (event) => {
      if (
        event.extension === "system" &&
        event.status === "ok" &&
        event.message === "Replication connection established"
      )
        replicationReady = true;
    });
  const document = new Y.Doc();
  document.getText("fixture").insert(0, "Synthetic confidential content");
  const bytes = Buffer.from(Y.encodeStateAsUpdate(document));
  const commit = (revision: number) =>
    admin.rpc("commit_document", {
      p_page_id: pageId,
      p_actor_id: owner.id,
      p_expected_revision: revision,
      p_operation_id: randomUUID(),
      p_payload: `\\x${bytes.toString("hex")}`,
      p_hash: createHash("sha256").update(bytes).digest("hex"),
      p_snapshot: `\\x${bytes.toString("hex")}`,
      p_projection: { text: "Synthetic confidential content" },
    });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Private channel subscribe timed out")), 12000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
        if (status === "CHANNEL_ERROR") {
          clearTimeout(timeout);
          reject(new Error("Private channel authorization failed"));
        }
      });
    });
    // Joining a socket does not imply that its database replication connection is ready.
    await expect.poll(() => replicationReady, { timeout: 15000 }).toBe(true);
    if ((await commit(0)).error) throw new Error("Initial durable commit failed");
    await expect.poll(() => events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ revision: 1, id: expect.any(String) });
    const before = await client.from("document_heads").select("projection").eq("page_id", pageId);
    expect(before.data).toHaveLength(1);
    if ((await admin.from("page_grants").delete().eq("page_id", pageId).eq("user_id", viewer.id)).error)
      throw new Error("Revocation failed");
    if ((await commit(1)).error) throw new Error("Owner commit after revocation failed");
    const after = await client.from("document_heads").select("projection").eq("page_id", pageId);
    expect(after.error).toBeNull();
    expect(after.data).toEqual([]);
    const log = await client.from("document_updates").select("payload").eq("page_id", pageId);
    expect(log.data).toEqual([]);
    // Supabase may cache channel authorization. Its events contain only a revision, never content.
    for (const event of events) {
      expect(Object.keys(event as object).sort()).toEqual(["id", "revision"]);
      expect(event).toMatchObject({
        id: expect.stringMatching(/^[a-f0-9-]{36}$/),
        revision: expect.any(Number),
      });
    }
  } finally {
    await client.removeAllChannels();
    await client.auth.signOut();
    document.destroy();
  }
});

test("workspaces, owner protection, invitations, switching, themes and mobile keyboard", async ({
  page,
  browser,
}) => {
  const owner = await account();
  const member = await account();
  await login(page, owner);
  await page.getByLabel("Nome do workspace").fill("Estúdio de teste");
  await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
  const workspacePath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "Abrir equipe", exact: true }).click();
  const ownerRow = page.getByRole("row").filter({ hasText: owner.email });
  await ownerRow.getByRole("combobox").selectOption("member");
  await ownerRow.getByRole("button").click();
  await expect(ownerRow.getByRole("alert")).toContainText("pelo menos um administrador");
  await page.getByLabel("E-mail da pessoa").fill(member.email);
  await page.getByRole("button", { name: "Criar convite", exact: true }).click();
  const invitation = await page.getByLabel("Link do convite", { exact: true }).inputValue();
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await login(second, member);
    await second.goto(workspacePath);
    await expect(second.getByRole("heading", { level: 1 })).toHaveText("Este espaço não está disponível.");
    await second.goto(invitation);
    await second.getByRole("button", { name: "Aceitar convite", exact: true }).click();
    await expect(second).toHaveURL(new RegExp(`${workspacePath}$`));
    await second.getByRole("link", { name: "Abrir equipe", exact: true }).click();
    await expect(second.getByText("Para convidar pessoas", { exact: false })).toBeVisible();
    await expect(second.getByLabel("E-mail da pessoa")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: member.email })).toBeVisible();
    await page.getByRole("link", { name: "Novo workspace", exact: true }).click();
    await page.getByLabel("Nome do workspace").fill("Outro estúdio");
    await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
    await page
      .getByLabel("Seu workspace", { exact: true })
      .selectOption(workspacePath.split("/").at(-1) ?? "");
    await expect(page).toHaveURL(new RegExp(`${workspacePath}$`));
    const theme = page.getByRole("button", { name: /^Tema:/ });
    await theme.click();
    await theme.click();
    await expect(theme).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Navegação do workspace" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Abrir navegação", exact: true })).toBeFocused();
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(workspacePath);
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});

test("password recovery uses a real local mail link", async ({ page }) => {
  const fixture = await account();
  await page.goto("/forgot-password");
  await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
  await page.getByRole("button", { name: "Enviar link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Se houver uma conta");
  await page.goto(await mailLink(fixture.email));
  await expect(page).toHaveURL(/\/reset-password$/);
  const password = `Changed-Only-${randomUUID()}`;
  await page.getByLabel("Nova senha", { exact: true }).fill(password);
  await page.getByLabel("Repita a nova senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/new$/);
  const publicClient = createClient(api, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false },
  });
  expect((await publicClient.auth.signInWithPassword({ email: fixture.email, password })).error).toBeNull();
});
