import "server-only";
import { z } from "zod";
import { parsePropertyValue } from "@/features/databases/model";
import { finishBlockUpload } from "@/features/files/block-actions";
import {
  type CsvMapping,
  csvMappingSchema,
  INTERCHANGE_LIMITS,
  type InterchangeItem,
} from "../model/contracts";
import { type CsvState, initialCsvState, parseCsvChunk, restoreCsvCell } from "../model/csv";
import { defaultCsvMapping, mappedCsvValue, mappingProperty, validateCsvMapping } from "../model/mapping";
import { importMarkdown, normalizeImportProjection } from "../model/markdown";
import { archivePath } from "../model/paths";
import { resumeBodyOperations, stageBodyOperations } from "./body";
import { digest, InterchangeError, type JobRepository, operationId, rpc, toJson } from "./repository";
import { extractArchive } from "./zip";

type CsvProgress = {
  chunk: number;
  offset: number;
  row: number;
  state: CsvState;
  header: string[];
  sample: string[][];
  done: boolean;
};
function progress(item: InterchangeItem): CsvProgress {
  return (
    (item.payload.csv as CsvProgress | undefined) ?? {
      chunk: 0,
      offset: 0,
      row: 0,
      state: initialCsvState(),
      header: [],
      sample: [],
      done: false,
    }
  );
}
const sourceKey = (index: number) => `entry:${index}`;
const sourceChunk = (repo: JobRepository, item: InterchangeItem, chunk: number) =>
  repo.path(`source/${Number(item.payload.entryIndex)}/${chunk}.bin`);
async function sourceBytes(repo: JobRepository, item: InterchangeItem, maximum: number): Promise<Buffer> {
  if (Number(item.payload.size) > maximum) throw new InterchangeError("entry-too-large");
  const parts: Buffer[] = [];
  let total = 0;
  for (let index = 0; index < Number(item.payload.chunks ?? 0); index++) {
    const bytes = await repo.download(sourceChunk(repo, item, index));
    total += bytes.length;
    if (total > maximum) throw new InterchangeError("entry-too-large");
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}
function pageTitle(path: string): string {
  return (
    (path.split("/").at(-1) ?? "Página")
      .replace(/\.(md|markdown|csv)$/i, "")
      .replace(/ [a-f0-9]{32}$/i, "")
      .slice(0, 500) || "Página"
  );
}
function isPage(item: InterchangeItem): boolean {
  return !item.payload.directory && ["markdown", "csv"].includes(String(item.payload.format));
}
function mapping(item: InterchangeItem, header: string[]): CsvMapping {
  return validateCsvMapping(
    item.payload.mapping ?? defaultCsvMapping(String(item.payload.path), header),
    header,
  );
}
async function validateReferences(
  repo: JobRepository,
  columns: CsvMapping["columns"],
  rows: readonly string[][],
): Promise<void> {
  for (const column of columns) {
    if (column.type !== "person" && column.type !== "relation") continue;
    const ids = new Set<string>();
    for (const row of rows) {
      const value = mappedCsvValue(
        column,
        row[column.index] ?? "",
        operationId(repo.job.id, `column:${column.index}`),
      );
      if (Array.isArray(value)) for (const id of value) ids.add(id);
    }
    const values = [...ids];
    for (let offset = 0; offset < values.length; offset += 1000)
      await rpc(repo.admin, "validate_interchange_references", {
        ...repo.args(),
        p_kind: column.type,
        p_ids: values.slice(offset, offset + 1000),
        p_target_database_id:
          column.type === "relation" ? z.uuid().parse(column.config.targetDatabaseId) : null,
      });
  }
}
async function csvBatch(repo: JobRepository, item: InterchangeItem, applying: boolean): Promise<boolean> {
  const state = structuredClone(progress(item));
  const rows: string[][] = [];
  const deadline = Date.now() + INTERCHANGE_LIMITS.batchMs;
  let writes = 0;
  while (rows.length < 100 && !state.done) {
    const chunks = Number(item.payload.chunks ?? 0);
    if (state.chunk >= chunks) {
      const parsed = parseCsvChunk(new Uint8Array(), state.state, 100 - rows.length, true);
      state.state = parsed.state;
      rows.push(...parsed.rows);
      state.done = true;
      break;
    }
    const bytes = await repo.download(sourceChunk(repo, item, state.chunk));
    const last = state.chunk === chunks - 1;
    const parsed = parseCsvChunk(bytes.subarray(state.offset), state.state, 100 - rows.length, last);
    state.state = parsed.state;
    state.offset += parsed.consumed;
    rows.push(...parsed.rows);
    if (state.offset >= bytes.length) {
      state.offset = 0;
      state.chunk++;
      if (last) state.done = true;
    } else break;
  }
  if (item.payload.csvFormulaProtection === true)
    for (const row of rows)
      for (let index = 0; index < row.length; index++) row[index] = restoreCsvCell(row[index] ?? "", true);
  if (!state.header.length) {
    const header = rows.shift();
    if (!header?.length) throw new InterchangeError("csv-header-required");
    header[0] = header[0]?.replace(/^\uFEFF/, "") ?? "";
    state.header = header;
  }
  const columns = mapping(item, state.header);
  for (const row of rows) {
    if (row.length !== state.header.length) throw new InterchangeError("csv-column-count");
    for (const column of columns.columns)
      mappedCsvValue(column, row[column.index] ?? "", operationId(repo.job.id, `column:${column.index}`));
  }
  await validateReferences(repo, columns.columns, rows);
  if (!applying) {
    for (const row of rows) {
      if (state.sample.length < 5) state.sample.push(row.slice(0, 10).map((cell) => cell.slice(0, 200)));
      state.row++;
    }
  } else {
    if (!item.databaseId) throw new InterchangeError("missing-import-database");
    const properties = z.record(z.string(), z.string()).parse(item.payload.properties ?? {});
    for (const row of rows) {
      const rowIndex = state.row;
      const rowKey = `row:${item.key}:${rowIndex}`;
      let receipt = await repo.append(rowKey, "row", { entry: item.key, row: rowIndex });
      const titleColumn = columns.columns.find((column) => column.type === "title");
      const title = titleColumn ? (row[titleColumn.index] ?? "") : "";
      const created = z.object({ pageId: z.uuid(), databaseId: z.uuid() }).parse(
        await rpc(repo.client, "ensure_interchange_page", {
          p_job_id: repo.job.id,
          p_lease_id: repo.lease,
          p_key: rowKey,
          p_title: title,
          p_database_id: item.databaseId,
        }),
      );
      receipt = { ...receipt, pageId: created.pageId, databaseId: created.databaseId };
      if (receipt.state !== "done") {
        for (const [columnIndex, column] of columns.columns.entries()) {
          if (column.type === "title" || columnIndex < Number(receipt.payload.nextColumn ?? 0)) continue;
          if (Date.now() > deadline || writes++ >= 20) {
            await repo.put(receipt);
            return false;
          }
          const propertyId = properties[String(column.index)];
          if (!propertyId) throw new InterchangeError("missing-import-property");
          const value = mappedCsvValue(column, row[column.index] ?? "", propertyId);
          const current = await repo.client
            .from("database_cells")
            .select("value,revision")
            .eq("page_id", created.pageId)
            .eq("property_id", propertyId)
            .abortSignal(AbortSignal.timeout(15000))
            .maybeSingle();
          if (current.error) throw new InterchangeError("cell-unavailable", 403);
          if (current.data) {
            if (
              JSON.stringify(parsePropertyValue(mappingProperty(column, propertyId), current.data.value)) !==
              JSON.stringify(value)
            )
              throw new InterchangeError("imported-cell-changed", 409);
          } else
            await rpc(repo.client, "put_database_cell", {
              p_database_id: item.databaseId,
              p_page_id: created.pageId,
              p_property_id: propertyId,
              p_value: toJson(value),
              p_expected_revision: 0,
            });
          receipt.payload = { ...receipt.payload, nextColumn: columnIndex + 1 };
          await repo.put(receipt);
        }
        receipt.state = "done";
        await repo.put(receipt);
      }
      state.row++;
      // Persist parser position only after every row in this parser batch has a receipt.
    }
  }
  item.payload = {
    ...item.payload,
    csv: state,
    header: state.header.map((value) => value.slice(0, 120)),
    sample: state.sample,
    mapping: columns,
    rowCount: state.row,
  };
  item.state = state.done ? (applying ? "done" : "ready") : "pending";
  await repo.put(item);
  return state.done;
}
export async function scanImport(repo: JobRepository): Promise<void> {
  const phase = String(repo.job.cursor.phase ?? "extract");
  if (phase === "extract") {
    const source = await repo.download(repo.job.sourcePath, INTERCHANGE_LIMITS.sourceBytes);
    if (source.length !== repo.job.sourceSize || digest(source) !== repo.job.sourceDigest)
      throw new InterchangeError("source-digest-mismatch");
    const completed = new Set(
      z
        .array(z.number().int().nonnegative())
        .max(10000)
        .parse(repo.job.cursor.extracted ?? []),
    );
    try {
      await extractArchive(source, {
        completed,
        async onEntry(info) {
          if (completed.has(info.index)) return;
          const existing = await repo.get(sourceKey(info.index));
          if (existing) return;
          const format = /\.(md|markdown)$/i.test(info.path)
            ? "markdown"
            : /\.csv$/i.test(info.path)
              ? "csv"
              : "asset";
          await repo.put({
            key: sourceKey(info.index),
            index: info.index,
            kind: "entry",
            state: info.directory ? "skipped" : "pending",
            payload: { ...info, entryIndex: info.index, format, title: pageTitle(info.path), chunks: 0 },
            pageId: null,
            databaseId: null,
            fileId: null,
          });
          if (info.directory) completed.add(info.index);
        },
        async onChunk(info, chunk, bytes) {
          await repo.check();
          await repo.upload(repo.path(`source/${info.index}/${chunk}.bin`), bytes);
        },
        async onComplete(info, chunks) {
          const item = await repo.get(sourceKey(info.index));
          if (!item) throw new InterchangeError("missing-source-entry");
          item.payload = { ...item.payload, chunks, extracted: true };
          item.state = "pending";
          await repo.put(item);
          completed.add(info.index);
          await repo.save(
            "scanning",
            { ...repo.job.cursor, phase: "extract", extracted: [...completed], processed: completed.size },
            repo.job.report,
            false,
          );
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "ZIP validation timed out") {
        await repo.save("scanning", {
          ...repo.job.cursor,
          phase: "extract",
          extracted: [...completed],
          processed: completed.size,
        });
        return;
      }
      throw error;
    }
    await repo.save(
      "scanning",
      { ...repo.job.cursor, phase: "preview", extracted: [...completed], processed: 0 },
      repo.job.report,
    );
    return;
  }
  const entries = await repo.all("entry");
  const deadline = Date.now() + INTERCHANGE_LIMITS.batchMs;
  const manifest = entries.find(
    (item) => item.payload.path === "bloco-export.json" && item.state === "pending",
  );
  if (manifest) {
    try {
      const data = z
        .strictObject({
          format: z.literal("bloco-markdown-csv"),
          version: z.literal(1),
          csvFormulaProtection: z.boolean(),
          pages: z
            .array(
              z.strictObject({
                path: z.string().max(1000),
                title: z.string().max(500),
                parentPath: z.string().max(1000).nullable(),
                databasePath: z.string().max(1000).optional(),
                rowIndex: z.number().int().nonnegative().optional(),
              }),
            )
            .max(10000),
          losses: z.array(z.unknown()).max(1000),
        })
        .parse(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              await sourceBytes(repo, manifest, 50 * 1024 * 1024),
            ),
          ),
        );
      const map = new Map(data.pages.map((page) => [archivePath(page.path), page]));
      if (map.size !== data.pages.length) throw new InterchangeError("manifest-duplicate-page");
      for (const page of data.pages)
        if (
          page.databasePath &&
          !entries.some(
            (item) =>
              item.payload.path === archivePath(page.databasePath ?? "") && item.payload.format === "csv",
          )
        )
          throw new InterchangeError("manifest-database-unavailable");
      for (const page of data.pages) {
        const seen = new Set<string>();
        let current: typeof page | undefined = page;
        while (
          current &&
          (current.parentPath || (current.databasePath && current.databasePath !== current.path))
        ) {
          if (seen.has(current.path)) throw new InterchangeError("manifest-parent-cycle");
          seen.add(current.path);
          current = map.get(
            archivePath(
              current.databasePath && current.databasePath !== current.path
                ? current.databasePath
                : (current.parentPath ?? ""),
            ),
          );
          if (!current) throw new InterchangeError("manifest-parent-unavailable");
        }
      }
      for (const item of entries) {
        const page = map.get(String(item.payload.path));
        if (page) {
          item.payload = {
            ...item.payload,
            title: page.title,
            parentPath: page.parentPath,
            csvFormulaProtection: data.csvFormulaProtection,
            ...(page.databasePath ? { databasePath: archivePath(page.databasePath) } : {}),
            ...(page.rowIndex !== undefined ? { rowIndex: page.rowIndex } : {}),
          };
          await repo.put(item);
        }
      }
      manifest.state = "skipped";
      manifest.payload = { ...manifest.payload, format: "metadata" };
      await repo.put(manifest);
    } catch {
      manifest.state = "error";
      manifest.payload = { ...manifest.payload, error: "manifest-invalid" };
      await repo.put(manifest);
    }
  }
  for (const item of entries) {
    if (item.state !== "pending") continue;
    if (Date.now() > deadline) break;
    try {
      if (item.payload.format === "markdown") {
        const bytes = await sourceBytes(repo, item, INTERCHANGE_LIMITS.pageBytes);
        const parsed = importMarkdown(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          String(item.payload.path),
        );
        item.state = "ready";
        item.payload = {
          ...item.payload,
          warnings: parsed.warnings,
          mediaEntries: parsed.media.flatMap((binding) => {
            const source = entries.find((value) => value.payload.path === binding.path);
            return source ? [source.index] : [];
          }),
        };
        await repo.put(item);
      } else if (item.payload.format === "csv") await csvBatch(repo, item, false);
      else {
        if (Number(item.payload.size) > 25 * 1024 * 1024) throw new InterchangeError("attachment-too-large");
        item.state = "ready";
        await repo.put(item);
      }
    } catch (error) {
      if (error instanceof InterchangeError && [403, 409, 429, 503].includes(error.status)) throw error;
      item.state = "error";
      item.payload = {
        ...item.payload,
        error: error instanceof InterchangeError ? error.code : "entry-invalid",
      };
      await repo.put(item);
    }
  }
  const latest = await repo.all("entry");
  const pending = latest.some((item) => item.state === "pending");
  await repo.save(
    pending ? "scanning" : "preview",
    {
      ...repo.job.cursor,
      phase: "preview",
      processed: latest.filter((item) => item.state !== "pending").length,
      total: latest.length,
    },
    [
      ...latest
        .filter((item) => item.state === "error")
        .map((item) => ({
          code: String(item.payload.error ?? "entry-invalid"),
          path: String(item.payload.path),
        })),
      ...latest.flatMap((item) =>
        Array.isArray(item.payload.warnings)
          ? (item.payload.warnings as { code: string; path?: string }[])
          : [],
      ),
      ...(latest.some((item) => item.payload.format === "csv")
        ? [{ code: "csv-types-require-confirmation" }]
        : []),
      { code: "views-acl-history-not-imported" },
    ],
  );
}
export async function configureImport(repo: JobRepository, mappings: CsvMapping[]): Promise<void> {
  if (repo.job.confirmed || !["preview", "scanning"].includes(repo.job.state))
    throw new InterchangeError("mapping-already-confirmed");
  const entries = await repo.all("entry");
  for (const input of mappings) {
    const item = entries.find((entry) => entry.payload.path === input.path && entry.payload.format === "csv");
    if (!item) throw new InterchangeError("csv-entry-unavailable");
    const header = progress(item).header;
    if (!header.length) throw new InterchangeError("csv-preview-required");
    const value = validateCsvMapping(csvMappingSchema.parse(input), header);
    for (const column of value.columns)
      mappingProperty(column, operationId(repo.job.id, `${item.key}:${column.index}`));
    const payload: Record<string, unknown> = {
      ...item.payload,
      mapping: value,
      csv: { chunk: 0, offset: 0, row: 0, state: initialCsvState(), header: [], sample: [], done: false },
    };
    delete payload.error;
    item.payload = payload;
    item.state = "pending";
    await repo.put(item);
  }
  await repo.save(
    "scanning",
    { ...repo.job.cursor, phase: "preview" },
    repo.job.report.filter((warning) => !mappings.some((mapping) => mapping.path === warning.path)),
  );
}
async function ensureDatabaseProperties(
  repo: JobRepository,
  item: InterchangeItem,
  deadline: number,
): Promise<boolean> {
  if (!item.databaseId) return true;
  let writes = 0;
  const csv = mapping(item, progress(item).header);
  const properties = z.record(z.string(), z.string()).parse(item.payload.properties ?? {});
  for (const column of csv.columns) {
    if (properties[String(column.index)]) continue;
    if (Date.now() > deadline || writes++ >= 20) return false;
    const definition = mappingProperty(column, operationId(repo.job.id, `${item.key}:${column.index}`));
    const id = z.uuid().parse(
      await rpc(repo.client, "ensure_interchange_property", {
        p_job_id: repo.job.id,
        p_lease_id: repo.lease,
        p_key: item.key,
        p_column: column.index,
        p_name: definition.name,
        p_type: definition.type,
        p_config: toJson(definition.config),
      }),
    );
    properties[String(column.index)] = id;
    item.payload = { ...item.payload, properties };
    await repo.put(item);
  }
  item.payload = { ...item.payload, properties };
  await repo.put(item);
  return true;
}
async function importAsset(
  repo: JobRepository,
  source: InterchangeItem,
  targetPage: string,
  owner: InterchangeItem,
  kind: "image" | "file",
): Promise<string | null> {
  const size = Number(source.payload.size);
  if (!size) return null;
  if (size > 25 * 1024 * 1024) throw new InterchangeError("attachment-too-large");
  const key = `asset:${operationId(repo.job.id, `${owner.key}:${source.key}`)}`;
  let item = await repo.append(key, "asset", { source: source.key, path: source.payload.path, size });
  if (item.state === "done" && item.fileId) return item.fileId;
  const bytes = await sourceBytes(repo, source, 25 * 1024 * 1024);
  const signature = bytes.subarray(0, 12);
  let mime = "application/octet-stream";
  if (kind === "image") {
    if (signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = "image/png";
    else if (signature[0] === 255 && signature[1] === 216) mime = "image/jpeg";
    else if (signature.subarray(0, 3).toString() === "GIF") mime = "image/gif";
    else if (
      signature.subarray(0, 4).toString() === "RIFF" &&
      signature.subarray(8, 12).toString() === "WEBP"
    )
      mime = "image/webp";
    else throw new InterchangeError("unsupported-image");
  }
  const fileId = z.uuid().parse(
    await rpc(repo.client, "prepare_interchange_file", {
      p_job_id: repo.job.id,
      p_lease_id: repo.lease,
      p_key: key,
      p_page_id: targetPage,
      p_name: String(source.payload.path).split("/").at(-1)?.slice(0, 180) || "Arquivo",
      p_mime_type: mime,
      p_size: bytes.length,
      p_kind: kind,
    }),
  );
  const file = await repo.client
    .from("page_files")
    .select("object_path,status,uploaded_by,page_id")
    .eq("id", fileId)
    .abortSignal(AbortSignal.timeout(15000))
    .single();
  if (file.error || !file.data || file.data.uploaded_by !== repo.actorId || file.data.page_id !== targetPage)
    throw new InterchangeError("file-unavailable", 403);
  if (file.data.status !== "ready") {
    const uploaded = await repo.admin.storage
      .from("page-assets")
      .upload(String(file.data.object_path), new Blob([new Uint8Array(bytes).buffer], { type: mime }), {
        contentType: mime,
        upsert: false,
      });
    if (uploaded.error) {
      const existing = await repo.download(
        String(file.data.object_path),
        25 * 1024 * 1024,
        repo.admin,
        "page-assets",
      );
      if (digest(existing) !== digest(bytes)) throw new InterchangeError("file-receipt-conflict", 409);
    }
  }
  const ready = await finishBlockUpload(fileId);
  if (!ready.ok) throw new InterchangeError("file-validation-failed", 429);
  item = { ...item, pageId: targetPage, fileId, state: "done" };
  await repo.put(item);
  return fileId;
}
export async function runImport(repo: JobRepository): Promise<void> {
  if (!repo.job.confirmed) throw new InterchangeError("confirmation-required", 403);
  const deadline = Date.now() + INTERCHANGE_LIMITS.batchMs;
  const entries = await repo.all("entry");
  let root = await repo.append("import-root", "root", {
    title: repo.job.sourceName.replace(/\.zip$/i, "") || "Importação",
  });
  if (!root.pageId) {
    const created = z.object({ pageId: z.uuid() }).parse(
      await rpc(repo.client, "ensure_interchange_page", {
        p_job_id: repo.job.id,
        p_lease_id: repo.lease,
        p_key: root.key,
        p_title: String(root.payload.title),
        p_parent_id: repo.job.parentId,
      }),
    );
    root = { ...root, pageId: created.pageId };
  }
  const pages = entries.filter(isPage);
  let created = 0;
  for (const item of pages) {
    if (item.pageId || item.payload.databasePath) continue;
    if (Date.now() > deadline || created >= 10) break;
    const path = String(item.payload.path);
    const dirname = path.split("/").slice(0, -1).join("/");
    const parent = pages.find((page) =>
      item.payload.parentPath
        ? String(page.payload.path) === String(item.payload.parentPath)
        : String(page.payload.path) === `${dirname}.md` ||
          String(page.payload.path) === `${dirname}.markdown`,
    );
    if (parent && !parent.pageId) continue;
    const value = z.object({ pageId: z.uuid(), databaseId: z.uuid().nullable() }).parse(
      await rpc(repo.client, "ensure_interchange_page", {
        p_job_id: repo.job.id,
        p_lease_id: repo.lease,
        p_key: item.key,
        p_title: String(item.payload.title),
        p_parent_id: parent?.pageId ?? root.pageId,
        p_is_database: item.payload.format === "csv",
      }),
    );
    item.pageId = value.pageId;
    item.databaseId = value.databaseId;
    created++;
  }
  // CSV records are allocated first so exported row bodies bind to those same
  // identities instead of creating a second ordinary page for every record.
  for (const item of pages) {
    if (item.payload.format !== "csv" || !item.pageId || item.state === "done") continue;
    if (Date.now() > deadline) break;
    if (!(await ensureDatabaseProperties(repo, item, deadline))) break;
    if (!item.payload.applying) {
      item.payload = {
        ...item.payload,
        applying: true,
        csv: { chunk: 0, offset: 0, row: 0, state: initialCsvState(), header: [], sample: [], done: false },
      };
      await repo.put(item);
    }
    await csvBatch(repo, item, true);
  }
  for (const item of pages) {
    if (item.pageId || !item.payload.databasePath) continue;
    const database = pages.find(
      (entry) => entry.payload.path === item.payload.databasePath && entry.payload.format === "csv",
    );
    if (database?.state !== "done") continue;
    const target =
      item.payload.rowIndex === undefined
        ? database
        : await repo.get(
            `row:${database.key}:${z.number().int().nonnegative().parse(item.payload.rowIndex)}`,
          );
    if (!target?.pageId) throw new InterchangeError("manifest-record-unavailable");
    item.pageId = target.pageId;
    item.databaseId = target.databaseId;
    await repo.put(item);
  }
  if (pages.some((item) => !item.pageId)) {
    await repo.save("running", {
      ...repo.job.cursor,
      phase: "create-pages",
      processed: pages.filter((item) => item.pageId).length,
      total: pages.length,
    });
    return;
  }
  const pageMap = new Map(
    pages.flatMap((item) => (item.pageId ? [[String(item.payload.path), item.pageId] as const] : [])),
  );
  for (const item of pages) {
    if (item.state === "done" || item.payload.format === "csv") continue;
    if (Date.now() > deadline) break;
    const source = await sourceBytes(repo, item, INTERCHANGE_LIMITS.pageBytes);
    const parsed = importMarkdown(
      new TextDecoder("utf-8", { fatal: true }).decode(source),
      String(item.payload.path),
      pageMap,
    );
    for (const binding of parsed.media) {
      const entry = entries.find((value) => value.payload.path === binding.path && !value.payload.directory);
      if (!entry) continue;
      const fileId = await importAsset(repo, entry, item.pageId ?? "", item, binding.kind);
      if (fileId) {
        const block = parsed.projection.blocks.find((block) => block.id === binding.blockId);
        if (block) block.attributes.fileId = fileId;
      }
    }
    parsed.projection.files = [
      ...new Set(
        parsed.projection.blocks.flatMap((block) =>
          typeof block.attributes.fileId === "string" ? [block.attributes.fileId] : [],
        ),
      ),
    ];
    const operations = await stageBodyOperations(repo, item, parsed.projection);
    const done = await resumeBodyOperations(repo, item, operations, deadline);
    if (done) {
      item.state = "done";
      await repo.put(item);
    }
  }
  const latest = await repo.all("entry");
  const pagesFinished = latest.filter(isPage).every((item) => item.state === "done");
  if (pagesFinished && root.state !== "done" && Date.now() < deadline) {
    const used = new Set(
      latest.flatMap((item) =>
        Array.isArray(item.payload.mediaEntries)
          ? item.payload.mediaEntries.filter((value): value is number => typeof value === "number")
          : [],
      ),
    );
    const assets = latest.filter(
      (item) =>
        item.payload.format === "asset" &&
        !item.payload.directory &&
        !used.has(item.index) &&
        Number(item.payload.size) > 0,
    );
    const blocks = [];
    for (const asset of assets) {
      if (Date.now() > deadline) break;
      const fileId = await importAsset(repo, asset, root.pageId ?? "", root, "file");
      if (fileId)
        blocks.push({
          id: crypto.randomUUID(),
          type: "file",
          parentId: null,
          position: `a${String(blocks.length).padStart(8, "0")}V`,
          attributes: {
            fileId,
            displayName: String(asset.payload.path).split("/").at(-1)?.slice(0, 180) || "Arquivo",
          },
          content: { type: "doc", content: [] },
        });
    }
    if (blocks.length === assets.length) {
      const projection = normalizeImportProjection({ schemaVersion: 1, blocks });
      const operations = await stageBodyOperations(repo, root, projection);
      if (await resumeBodyOperations(repo, root, operations, deadline)) {
        root.state = "done";
        await repo.put(root);
      }
    }
  }
  const finished = pagesFinished && root.state === "done";
  await repo.save(
    finished ? "complete" : "running",
    {
      ...repo.job.cursor,
      phase: "import",
      rootPageId: root.pageId,
      processed: latest.filter((item) => isPage(item) && item.state === "done").length,
      total: pages.length,
    },
    [
      ...repo.job.report,
      ...(pages.some(
        (item) =>
          item.payload.format === "csv" &&
          mapping(item, progress(item).header).columns.some((column) =>
            ["createdTime", "editedTime"].includes(column.type),
          ),
      )
        ? [{ code: "system-metadata-preserved-as-text" }]
        : []),
    ],
  );
}
