import "server-only";
import { crc32 } from "node:zlib";
import { z } from "zod";
import {
  type PropertyDefinition,
  parsePropertyValue,
  propertyDefinitionSchema,
} from "@/features/databases/model";
import { INTERCHANGE_LIMITS, type InterchangeItem } from "../model/contracts";
import { csvRow } from "../model/csv";
import { exportMarkdown, normalizeImportProjection } from "../model/markdown";
import { safeExportName } from "../model/paths";
import { digest, InterchangeError, type JobRepository, rpc, toJson } from "./repository";
import { storedZipEnd, storedZipHeader, type ZipPart, zipDirectory, zipEntry } from "./zip";

const pageSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  title: z.string().max(500),
  databaseId: z.uuid().nullable(),
  recordDatabaseId: z.uuid().nullable(),
  isTemplate: z.boolean(),
});
const rowSchema = z.object({
  id: z.uuid(),
  title: z.string().max(500),
  values: z.record(z.string(), z.unknown()),
});
function partOffset(repo: JobRepository): number {
  return Number(repo.job.cursor.zipOffset ?? 0);
}
async function addPart(
  repo: JobRepository,
  key: string,
  bytes: Buffer,
  entry?: ZipPart,
): Promise<InterchangeItem> {
  const objectPath = repo.path(`export/${digest(Buffer.from(key))}.part`);
  await repo.upload(objectPath, bytes);
  const item = await repo.append(
    `part:${key}`,
    "zipPart",
    { objectPath, bytes: bytes.length, ...(entry ? { entry } : {}) },
    "done",
  );
  if (item.payload.objectPath !== objectPath || item.payload.bytes !== bytes.length)
    throw new InterchangeError("export-part-conflict", 409);
  await repo.check();
  return item;
}
async function addEntry(
  repo: JobRepository,
  key: string,
  name: string,
  bytes: Uint8Array,
  compress = true,
): Promise<void> {
  const existing = await repo.get(`zip:${key}`);
  if (existing) return;
  const packed = zipEntry(name, bytes, partOffset(repo), compress);
  const part = await addPart(repo, key, packed.bytes, packed.entry);
  await repo.append(`zip:${key}`, "zipEntry", part.payload.entry as Record<string, unknown>, "done");
}
async function csvExport(repo: JobRepository, item: InterchangeItem, deadline: number): Promise<boolean> {
  const databaseId = z.uuid().parse(item.payload.databaseId);
  let properties: PropertyDefinition[];
  if (Array.isArray(item.payload.properties))
    properties = item.payload.properties.map((value) => propertyDefinitionSchema.parse(value));
  else {
    const meta = z
      .object({
        revision: z.number().int().nonnegative(),
        properties: z.array(
          z.object({ id: z.uuid(), name: z.string(), type: z.string(), config: z.unknown() }),
        ),
        views: z.array(z.object({ id: z.uuid() })),
      })
      .parse(await rpc(repo.client, "get_database_metadata", { p_database_id: databaseId }));
    properties = meta.properties.map((value) => propertyDefinitionSchema.parse(value));
    const viewId = meta.views[0]?.id;
    if (!viewId) throw new InterchangeError("database-view-unavailable");
    const header = csvRow(properties.map((property) => property.name));
    const opened = storedZipHeader(String(item.payload.path), partOffset(repo));
    const part = await addPart(
      repo,
      `${item.key}:header`,
      Buffer.concat([opened.bytes, Buffer.from(header.text)]),
      opened.entry,
    );
    item.payload = {
      ...item.payload,
      properties,
      viewId,
      sourceRevision: meta.revision,
      entry: part.payload.entry,
      csvCrc: crc32(Buffer.from(header.text)),
      csvSize: Buffer.byteLength(header.text),
      rowCount: 0,
      escaped: header.neutralized,
      cursor: null,
      rowsComplete: false,
    };
    await repo.put(item);
  }
  const finish = async () => {
    const crc = Number(item.payload.csvCrc),
      size = Number(item.payload.csvSize);
    await addPart(repo, `${item.key}:end`, storedZipEnd(crc, size));
    const entry = { ...(item.payload.entry as ZipPart), crc, size, compressedSize: size };
    await repo.append(`zip:${item.key}`, "zipEntry", entry as unknown as Record<string, unknown>, "done");
    item.state = "done";
    await repo.put(item);
    return true;
  };
  if (item.payload.rowsComplete === true) return finish();
  for (let batch = 0; batch < 2 && Date.now() < deadline; batch++) {
    const result = z
      .object({
        revision: z.number().int().nonnegative(),
        rows: z.array(rowSchema).max(50),
        nextCursor: z.record(z.string(), z.unknown()).nullable(),
      })
      .parse(
        await rpc(repo.client, "query_database_records", {
          p_database_id: databaseId,
          p_view_id: z.uuid().parse(item.payload.viewId),
          p_filter: null,
          p_use_filter: true,
          p_sorts: [],
          p_cursor: toJson(item.payload.cursor ?? null),
        }),
      );
    if (result.revision !== item.payload.sourceRevision)
      throw new InterchangeError("source-database-changed", 409);
    const start = Number(item.payload.rowCount ?? 0);
    const csv: string[] = [];
    let escaped = Number(item.payload.escaped ?? 0);
    for (const [index, row] of result.rows.entries()) {
      const values = properties.map((property) => {
        const value = parsePropertyValue(property, row.values[property.id] ?? null);
        return value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
      });
      const encoded = csvRow(values);
      csv.push(encoded.text);
      escaped += encoded.neutralized;
      const receipt = await repo.append(
        `record:${databaseId}:${row.id}`,
        "recordMap",
        {
          id: row.id,
          databaseId,
          rowIndex: start + index,
          path: `pages/${safeExportName(row.title, row.id, "md")}`,
        },
        "done",
      );
      await repo.put({ ...receipt, sourcePageId: row.id });
    }
    const bytes = Buffer.from(csv.join(""));
    const crc = crc32(bytes, Number(item.payload.csvCrc ?? 0));
    const size = Number(item.payload.csvSize ?? 0) + bytes.length;
    await addPart(repo, `${item.key}:rows:${start}`, bytes);
    item.payload = {
      ...item.payload,
      csvCrc: crc,
      csvSize: size,
      rowCount: start + result.rows.length,
      escaped,
      cursor: result.nextCursor,
      rowsComplete: !result.nextCursor,
    };
    await repo.put(item);
    if (!result.nextCursor) {
      return finish();
    }
  }
  return false;
}
export async function runExport(repo: JobRepository): Promise<void> {
  const deadline = Date.now() + INTERCHANGE_LIMITS.batchMs;
  if (!repo.job.cursor.phase || repo.job.cursor.phase === "inventory") {
    const pages = z
      .array(pageSchema)
      .max(50)
      .parse(
        await rpc(repo.admin, "interchange_export_pages", {
          ...repo.args(),
          p_after_id: repo.job.cursor.afterPage ? z.uuid().parse(repo.job.cursor.afterPage) : null,
        }),
      );
    for (const page of pages) {
      const path = `pages/${safeExportName(page.title, page.id, "md")}`;
      const item = await repo.append(`page:${page.id}`, "exportPage", { ...page, path });
      await repo.put({ ...item, sourcePageId: page.id });
      if (page.databaseId) {
        const csv = await repo.append(`csv:${page.databaseId}`, "exportCsv", {
          databaseId: page.databaseId,
          pageId: page.id,
          title: page.title,
          path: `databases/${safeExportName(page.title, page.databaseId, "csv")}`,
        });
        await repo.put({ ...csv, sourcePageId: page.id });
      }
    }
    await repo.save("running", {
      ...repo.job.cursor,
      phase: pages.length === 50 ? "inventory" : "export",
      afterPage: pages.at(-1)?.id ?? repo.job.cursor.afterPage,
      zipOffset: partOffset(repo),
      processed: Number(repo.job.cursor.processed ?? 0) + pages.length,
    });
    return;
  }
  const pages = await repo.all("exportPage");
  const csvs = await repo.all("exportCsv");
  // A CSV is one stored ZIP entry, continued in independent private chunks.
  for (const csv of csvs) {
    if (csv.state === "done") continue;
    await csvExport(repo, csv, deadline);
    await repo.save("running", { ...repo.job.cursor, phase: "export" });
    return;
  }
  const pageMap = new Map(
    pages.map((item) => [
      String(item.payload.id),
      { href: String(item.payload.path).replace(/^pages\//, ""), label: String(item.payload.title) },
    ]),
  );
  let processed = 0;
  for (const item of pages) {
    if (item.state === "done") continue;
    if (Date.now() > deadline || processed >= 4) break;
    const sourcePageId = z.uuid().parse(item.payload.id);
    const cachePath = repo.path(`snapshots/${sourcePageId}.json`);
    let bytes = await repo.optionalDownload(cachePath, 50 * 1024 * 1024);
    if (!bytes) {
      const meta = await rpc(repo.client, "get_page_metadata", {
        p_page_id: sourcePageId,
        p_workspace_id: repo.job.workspaceId,
      });
      if (!meta) throw new InterchangeError("source-page-unavailable", 403);
      const head = await repo.client
        .from("document_heads")
        .select("projection")
        .eq("page_id", sourcePageId)
        .abortSignal(AbortSignal.timeout(15000))
        .maybeSingle();
      if (head.error) throw new InterchangeError("source-page-unavailable", 403);
      const projection = head.data
        ? normalizeImportProjection({
            schemaVersion: (head.data.projection as Record<string, unknown>).schemaVersion,
            blocks: (head.data.projection as Record<string, unknown>).blocks,
          })
        : normalizeImportProjection({ schemaVersion: 1, blocks: [] });
      bytes = Buffer.from(JSON.stringify(projection));
      await repo.upload(cachePath, bytes);
    }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<
      string,
      unknown
    >;
    const projection = normalizeImportProjection({ schemaVersion: raw.schemaVersion, blocks: raw.blocks });
    const resolved = new Map(pageMap);
    for (let offset = 0; offset < projection.references.length; offset += 100) {
      const names = z
        .array(z.object({ id: z.uuid(), title: z.string().max(500) }))
        .max(100)
        .parse(
          await rpc(repo.client, "resolve_page_mentions", {
            p_workspace_id: repo.job.workspaceId,
            p_page_ids: projection.references.slice(offset, offset + 100),
          }),
        );
      for (const name of names) {
        const known = resolved.get(name.id);
        resolved.set(name.id, {
          label: name.title,
          href: known?.href ?? `${process.env.APP_URL}/w/${repo.job.workspaceId}/p/${name.id}`,
        });
        if (!known) {
          const reference = await repo.append(`reference:${name.id}`, "reference", { id: name.id }, "done");
          await repo.put({ ...reference, sourcePageId: name.id });
        }
      }
      for (const id of projection.references.slice(offset, offset + 100))
        if (!names.some((name) => name.id === id)) resolved.delete(id);
    }
    const files = new Map<string, { href: string; name: string }>();
    for (let offset = 0; offset < projection.files.length; offset += 100) {
      const result = await repo.client
        .from("page_files")
        .select("id,object_path,original_name,actual_size,status,page_id")
        .eq("page_id", sourcePageId)
        .eq("status", "ready")
        .in("id", projection.files.slice(offset, offset + 100))
        .abortSignal(AbortSignal.timeout(15000));
      if (result.error) throw new InterchangeError("source-files-unavailable", 403);
      for (const file of result.data ?? []) {
        const fileId = z.uuid().parse(file.id);
        const name = safeExportName(String(file.original_name), fileId, "bin");
        const entryPath = `attachments/${name}`;
        const done = await repo.get(`zip:file:${fileId}`);
        if (!done) {
          const data = await repo.download(
            String(file.object_path),
            25 * 1024 * 1024,
            repo.client,
            "page-assets",
          );
          if (data.length !== file.actual_size) throw new InterchangeError("source-file-changed", 409);
          await addEntry(repo, `file:${fileId}`, entryPath, data, false);
        }
        files.set(fileId, { name: String(file.original_name), href: `../${entryPath}` });
      }
    }
    const markdown = exportMarkdown(projection, { pages: resolved, files });
    await addEntry(repo, item.key, String(item.payload.path), Buffer.from(markdown.text));
    item.state = "done";
    item.payload = { ...item.payload, warnings: markdown.warnings };
    await repo.put(item);
    processed++;
  }
  const latest = await repo.all("exportPage");
  if (latest.some((item) => item.state !== "done")) {
    await repo.save("running", {
      ...repo.job.cursor,
      phase: "export",
      processed: latest.filter((item) => item.state === "done").length,
      total: latest.length,
    });
    return;
  }
  const records = await repo.all("recordMap");
  const manifestPages: {
    path: string;
    title: string;
    parentPath: string | null;
    databasePath?: string;
    rowIndex?: number;
  }[] = latest.map((item) => {
    const csv = csvs.find((csv) => csv.payload.databaseId === item.payload.databaseId);
    const record = records.find((record) => record.payload.id === item.payload.id);
    const recordCsv = record
      ? csvs.find((csv) => csv.payload.databaseId === record.payload.databaseId)
      : undefined;
    return {
      path: String(item.payload.path),
      title: String(item.payload.title),
      parentPath: item.payload.parentId
        ? String(latest.find((other) => other.payload.id === item.payload.parentId)?.payload.path ?? "") ||
          null
        : null,
      ...(csv
        ? { databasePath: String(csv.payload.path) }
        : recordCsv
          ? { databasePath: String(recordCsv.payload.path), rowIndex: Number(record?.payload.rowIndex) }
          : {}),
    };
  });
  for (const csv of csvs)
    manifestPages.push({
      path: String(csv.payload.path),
      title: String(csv.payload.title),
      parentPath:
        manifestPages.find(
          (page) => "databasePath" in page && page.databasePath === csv.payload.path && !("rowIndex" in page),
        )?.parentPath ?? null,
    });
  const allLosses = [
    { code: "views-acl-comments-history-not-exported" },
    { code: "csv-null-empty-interop" },
    {
      code: "csv-formulas-neutralized",
      count: csvs.reduce((sum, item) => sum + Number(item.payload.escaped ?? 0), 0),
    },
    ...latest.flatMap((item) =>
      Array.isArray(item.payload.warnings) ? (item.payload.warnings as { code: string }[]) : [],
    ),
  ];
  const counts = new Map<string, number>();
  for (const warning of allLosses)
    counts.set(
      warning.code,
      (counts.get(warning.code) ?? 0) + ("count" in warning ? Number(warning.count) : 1),
    );
  const losses = [...counts].map(([code, count]) => ({ code, count }));
  await addEntry(
    repo,
    "manifest",
    "bloco-export.json",
    Buffer.from(
      JSON.stringify({
        format: "bloco-markdown-csv",
        version: 1,
        csvFormulaProtection: true,
        pages: manifestPages,
        losses,
      }),
    ),
    true,
  );
  const directoryReceipt = await repo.get("part:directory");
  if (!directoryReceipt) {
    const entries = await repo.all("zipEntry");
    const directory = zipDirectory(
      entries.map((item) => item.payload as unknown as ZipPart),
      partOffset(repo),
    );
    await addPart(repo, "directory", directory);
  } else if (directoryReceipt.kind !== "zipPart" || directoryReceipt.state !== "done") {
    throw new InterchangeError("export-part-conflict", 409);
  }
  // The committed directory receipt already advanced zipOffset atomically.
  // Regenerating its EOCD with that advanced offset would change immutable bytes.
  await repo.save(
    "complete",
    { ...repo.job.cursor, phase: "complete", processed: latest.length, total: latest.length },
    losses,
  );
}
