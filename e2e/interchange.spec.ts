import { createHash, randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { fromBuffer } from "yauzl";
import * as Y from "yjs";
import { z } from "zod";
import { initialContentUpdate } from "../src/features/editor/model/initial-content";
import { StablePage } from "../src/features/editor/model/stable-page";
import { jobSchema } from "../src/features/interchange/model/contracts";
import { detailSchema } from "../src/features/interchange/ui/job-client";
import type { Database } from "../src/lib/supabase/database.types";

const app = "http://127.0.0.1:3001",
  api = process.env.NEXT_PUBLIC_SUPABASE_URL,
  secret = process.env.SUPABASE_SECRET_KEY;
if (
  process.env.BLOCO_TEST_STACK !== "bloco-test" ||
  process.env.APP_URL !== app ||
  api !== "http://127.0.0.1:55321" ||
  !secret
)
  throw Error("Interchange acceptance requires the isolated synthetic stack.");
const admin = createClient<Database>(api, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const createdSchema = z.object({
  job: jobSchema,
  upload: z.object({ signedUrl: z.string(), path: z.string() }).optional(),
});
const commandSchema = z.object({
  ok: z.boolean(),
  id: z.uuid().optional(),
  pageId: z.uuid().optional(),
  jobId: z.uuid().optional(),
});
const projectionSchema = z.object({
  text: z.string(),
  references: z.array(z.uuid()),
  files: z.array(z.uuid()),
  blocks: z.array(z.object({ id: z.string(), type: z.string() })),
});

/** A tiny stored ZIP fixture is independent of the production ZIP writer. */
function fixtureZip(values: readonly (readonly [string, string])[]): Buffer {
  let offset = 0;
  const local: Buffer[] = [],
    central: Buffer[] = [];
  for (const [name, value] of values) {
    const bytes = Buffer.from(value),
      filename = Buffer.from(name),
      crc = crc32(bytes),
      header = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, bytes);
    central.push(directory, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(values.length, 8);
  end.writeUInt16LE(values.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
async function unzip(source: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) =>
    fromBuffer(source, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) return reject(Error("Invalid exported ZIP"));
      const files = new Map<string, Buffer>();
      archive.on("error", reject);
      archive.on("end", () => resolve(files));
      archive.on("entry", (entry) =>
        archive.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(Error("Unreadable exported entry"));
          const chunks: Buffer[] = [];
          stream.on("data", (bytes: Buffer) => chunks.push(bytes));
          stream.on("error", reject);
          stream.on("end", () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            archive.readEntry();
          });
        }),
      );
      archive.readEntry();
    }),
  );
}
function bodyUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, initialContentUpdate());
  const model = new StablePage(doc, "interchange-acceptance");
  try {
    const block = model.visibleChildren()[0];
    if (!block) throw Error("Initial paragraph missing");
    const paragraph = model.fragment(block.id).get(0);
    if (!(paragraph instanceof Y.XmlElement)) throw Error("Paragraph missing");
    let node = paragraph.get(0);
    if (!(node instanceof Y.XmlText)) {
      node = new Y.XmlText();
      paragraph.insert(0, [node]);
    }
    node.insert(0, text);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    model.destroy();
    doc.destroy();
  }
}
async function removeJobObjects(workspaceId: string, actorId: string, jobId: string) {
  const prefixes = [`${workspaceId}/${actorId}/${jobId}`],
    objects: string[] = [];
  for (let index = 0; index < prefixes.length; index++) {
    const prefix = prefixes[index];
    if (!prefix) continue;
    const listed = await admin.storage.from("interchange").list(prefix, { limit: 1000 });
    if (listed.error) throw Error("Synthetic job cleanup failed");
    for (const file of listed.data) {
      if (file.id) objects.push(`${prefix}/${file.name}`);
      else prefixes.push(`${prefix}/${file.name}`);
    }
    if (prefixes.length > 10000) throw Error("Synthetic cleanup bound exceeded");
  }
  if (objects.length) {
    const removed = await admin.storage.from("interchange").remove(objects);
    if (removed.error) throw Error("Synthetic job object cleanup failed");
  }
}

test("authorized ZIP preview, typed import, export/reimport and durable template retries preserve content", async ({
  page,
}) => {
  test.setTimeout(120000);
  let actorId: string | undefined, workspaceId: string | undefined;
  const jobs: string[] = [];
  const request = async (path: string, input: unknown) => {
    const response = await page.request.post(app + path, { headers: { Origin: app }, data: input });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const step = async (id: string, action: string) =>
    detailSchema.parse(await request(`/api/interchange/${id}`, { action }));
  const advance = async (id: string, wanted: string, action: string) => {
    for (let index = 0; index < 80; index++) {
      const result = await step(id, action);
      if (result.job.state === wanted) return result;
      expect(result.job.state, JSON.stringify(result.job.report)).not.toBe("error");
    }
    throw Error("Synthetic batch budget reached");
  };
  const startImport = async (bytes: Buffer) => {
    const input = {
      kind: "import",
      workspaceId,
      parentId: null,
      operationId: randomUUID(),
      name: "Synthetic.zip",
      size: bytes.length,
      digest: createHash("sha256").update(bytes).digest("hex"),
    };
    const created = createdSchema.parse(await request("/api/interchange", input));
    jobs.push(created.job.id);
    const retry = createdSchema.parse(await request("/api/interchange", input));
    expect(retry.job.id).toBe(created.job.id);
    if (!created.upload) throw Error("Missing signed upload");
    const url = new URL(created.upload.signedUrl, api);
    expect(url.origin).toBe(api);
    const upload = await page.request.put(url.href, {
      headers: { "x-upsert": "false" },
      multipart: {
        cacheControl: "0",
        file: { name: "Synthetic.zip", mimeType: "application/zip", buffer: bytes },
      },
    });
    expect(upload.ok()).toBe(true);
    return created.job.id;
  };
  const saveBody = async (pageId: string, text: string) => {
    const saved = await page.request.post(`${app}/api/documents/${pageId}`, {
      headers: { Origin: app, "Content-Type": "application/octet-stream", "X-Operation-Id": randomUUID() },
      data: Buffer.from(bodyUpdate(text)),
    });
    expect(saved.status(), await saved.text()).toBe(200);
  };
  const readProjection = async (pageId: string) => {
    const result = await admin.from("document_heads").select("projection").eq("page_id", pageId).single();
    expect(result.error).toBeNull();
    return projectionSchema.parse(result.data?.projection);
  };
  try {
    expect((await page.request.get(`${app}/api/interchange?workspaceId=${randomUUID()}`)).status()).toBe(401);
    const email = `interchange-${randomUUID()}@example.test`,
      password = `Synthetic-${randomUUID()}`;
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (user.error || !user.data.user) throw Error("Synthetic account creation failed");
    actorId = user.data.user.id;
    await page.goto("/login");
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByLabel("Nome do workspace").fill("Interchange acceptance");
    await page.getByRole("button", { name: "Criar workspace", exact: true }).click();
    await expect(page).toHaveURL(/\/w\/[a-f0-9-]+$/);
    workspaceId = new URL(page.url()).pathname.split("/")[2];
    if (!workspaceId) throw Error("Synthetic workspace missing");
    const bytes = fixtureZip([
      [
        "Root.md",
        "# Café\n\n**Bold**\n\n[Filho](Root/Filho.md)\n\n[Arquivo](asset.txt)\n\n> [Bloco:toggle] Mais\n>\n> Texto",
      ],
      ["Root/Filho.md", "## Filho\n\nTexto filho"],
      ["Data.csv", '"Name","Count"\r\n"=Formula","0"\r\n"Second","-2"\r\n'],
      ["asset.txt", "Owned binary attachment"],
    ]);
    const id = await startImport(bytes),
      preview = await advance(id, "preview", "scan");
    const before = await admin
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    expect(before.count).toBe(0);
    expect(preview.items.every((item) => item.state !== "error")).toBe(true);
    await request(`/api/interchange/${id}`, {
      action: "configure",
      mappings: [
        {
          path: "Data.csv",
          columns: [
            { index: 0, name: "Name", type: "title", config: {} },
            { index: 1, name: "Count", type: "number", config: {} },
          ],
        },
      ],
    });
    await advance(id, "preview", "scan");
    await step(id, "confirm");
    await advance(id, "complete", "run");
    const pages = await admin.from("pages").select("id,title").eq("workspace_id", workspaceId);
    const root = pages.data?.find((row) => row.title === "Root"),
      record = pages.data?.find((row) => row.title === "=Formula");
    if (!root || !record) throw Error("Imported synthetic pages missing");
    const projection = await readProjection(root.id);
    expect(projection.references).toHaveLength(1);
    expect(projection.files).toHaveLength(1);
    expect(projection.blocks.some((block) => block.type === "toggle")).toBe(true);
    await saveBody(record.id, "CSV row body");
    const rootReceipt = await admin
      .from("interchange_items")
      .select("page_id")
      .eq("job_id", id)
      .eq("key", "import-root")
      .single();
    if (!rootReceipt.data?.page_id) throw Error("Import root receipt missing");
    const exported = createdSchema.parse(
      await request("/api/interchange", {
        kind: "export",
        workspaceId,
        pageId: rootReceipt.data.page_id,
        operationId: randomUUID(),
      }),
    );
    jobs.push(exported.job.id);
    expect(exported.job.state).toBe("running");
    expect(exported.job.confirmed).toBe(true);
    await advance(exported.job.id, "complete", "run");
    const download = await page.request.get(`${app}/api/interchange/${exported.job.id}/download`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-length"]).toBeUndefined();
    const output = await download.body(),
      files = await unzip(output);
    expect(files.has("bloco-export.json")).toBe(true);
    expect([...files.keys()].some((path) => path.endsWith(".csv"))).toBe(true);
    expect([...files.keys()].some((path) => path.startsWith("attachments/"))).toBe(true);
    const second = await startImport(output),
      secondPreview = await advance(second, "preview", "scan");
    expect(secondPreview.items.every((item) => item.state !== "error")).toBe(true);
    await step(second, "confirm");
    await advance(second, "complete", "run");
    const secondCsv = await admin
      .from("interchange_items")
      .select("database_id")
      .eq("job_id", second)
      .eq("kind", "entry")
      .not("database_id", "is", null)
      .limit(1)
      .single();
    if (!secondCsv.data?.database_id) throw Error("Reimported database missing");
    const rows = await admin
      .from("database_records")
      .select("page_id")
      .eq("database_id", secondCsv.data.database_id);
    expect(rows.data).toHaveLength(2);
    const bodies = await Promise.all((rows.data ?? []).map((row) => readProjection(row.page_id)));
    expect(bodies.some((body) => body.text === "CSV row body")).toBe(true);
    const firstDatabase = await admin
      .from("database_records")
      .select("database_id")
      .eq("page_id", record.id)
      .single();
    if (!firstDatabase.data) throw Error("Initial database missing");
    const databaseId = firstDatabase.data.database_id;
    const command = async (input: unknown, operationId = randomUUID()) => {
      const response = await page.request.post(`${app}/api/databases/${databaseId}`, {
        headers: { Origin: app, "X-Operation-Id": operationId },
        data: input,
      });
      expect(response.status(), await response.text()).toBe(200);
      return commandSchema.parse(await response.json());
    };
    const template = await command({
      action: "template",
      id: null,
      title: "Durable template",
      expectedRevision: 0,
    });
    if (!template.ok || !template.id || !template.pageId) throw Error("Template creation failed");
    await saveBody(template.pageId, "Immutable template body");
    const operationId = randomUUID(),
      input = { action: "createRecord", title: "Durable instance", templateId: template.id };
    const copy = await command(input, operationId);
    if (!copy.pageId || !copy.jobId) throw Error("Durable copy receipt missing");
    jobs.push(copy.jobId);
    const retry = await command(input, operationId);
    expect(retry.pageId).toBe(copy.pageId);
    expect(retry.jobId).toBe(copy.jobId);
    if (!copy.ok) await advance(copy.jobId, "complete", "run");
    const sourceBody = await readProjection(template.pageId),
      copiedBody = await readProjection(copy.pageId);
    expect(copiedBody.text).toBe("Immutable template body");
    expect(copiedBody.blocks[0]?.id).not.toBe(sourceBody.blocks[0]?.id);
  } finally {
    if (actorId) {
      if (workspaceId) for (const id of jobs) await removeJobObjects(workspaceId, actorId, id);
      const files = await admin.from("page_files").select("object_path").eq("uploaded_by", actorId);
      if (files.data?.length) {
        const removed = await admin.storage
          .from("page-assets")
          .remove(files.data.map((file) => file.object_path));
        expect(removed.error).toBeNull();
      }
      if (workspaceId) {
        const removed = await admin
          .from("workspaces")
          .delete()
          .eq("id", workspaceId)
          .eq("created_by", actorId);
        expect(removed.error).toBeNull();
      }
      const deleted = await admin.auth.admin.deleteUser(actorId);
      expect(deleted.error).toBeNull();
    }
  }
});
