import "server-only";
import { z } from "zod";
import { parsePropertyWrite, propertyDefinitionSchema } from "@/features/databases/model";
import { finishBlockUpload } from "@/features/files/block-actions";
import { createClient, currentUser } from "@/lib/supabase/server";
import { INTERCHANGE_LIMITS, jobSchema } from "../model/contracts";
import { normalizeImportProjection } from "../model/markdown";
import { resumeBodyOperations, stageBodyOperations } from "./body";
import {
  digest,
  type InterchangeClient,
  InterchangeError,
  isRetryableInterchangeError,
  JobRepository,
  normalizeInterchangeError,
  rpc,
  toJson,
  withInterchangeSlot,
  withInterchangeTransport,
} from "./repository";

const fileSchema = z.object({
  id: z.uuid(),
  object_path: z.string(),
  original_name: z.string(),
  mime_type: z.string(),
  actual_size: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
});
const planSchema = z.object({
  databaseId: z.uuid(),
  sourcePageId: z.uuid(),
  targetPageId: z.uuid(),
  projection: z.unknown(),
  cells: z.array(z.object({ property: propertyDefinitionSchema, value: z.unknown() })).max(500),
  files: z.array(fileSchema).max(10000),
});

/** Snapshot the source and defaults once, before any destination write. */
export async function planTemplateCopy(input: {
  databaseId: string;
  sourcePageId: string;
  targetPageId: string;
  actorId: string;
  operationId: string;
}): Promise<{ jobId: string; job: z.infer<typeof jobSchema> }> {
  const value = z
    .strictObject({
      databaseId: z.uuid(),
      sourcePageId: z.uuid(),
      targetPageId: z.uuid(),
      actorId: z.uuid(),
      operationId: z.uuid(),
    })
    .parse(input);
  const user = await currentUser();
  if (user?.id !== value.actorId) throw new InterchangeError("access-denied", 403);
  return withInterchangeSlot(async () => {
    const client = (await createClient()) as InterchangeClient;
    const records = await client
      .from("database_records")
      .select("page_id,is_template,workspace_id")
      .eq("database_id", value.databaseId)
      .in("page_id", [value.sourcePageId, value.targetPageId])
      .abortSignal(AbortSignal.timeout(15000));
    const source = records.data?.find((row) => row.page_id === value.sourcePageId && row.is_template);
    const target = records.data?.find(
      (row) => row.page_id === value.targetPageId && row.page_id !== value.sourcePageId,
    );
    if (records.error || !source || !target) throw new InterchangeError("template-unavailable", 403);
    const job = jobSchema.parse(
      await rpc(client, "create_interchange_job", {
        p_workspace_id: source.workspace_id,
        p_kind: "templateCopy",
        p_request_id: value.operationId,
        p_root_page_id: value.sourcePageId,
        p_parent_id: value.targetPageId,
        p_source_name: "Template",
      }),
    );
    if (job.state === "complete") return { jobId: job.id, job };
    const repo = await JobRepository.claim(job.id, value.actorId);
    try {
      const path = repo.path("template-plan.json");
      if (!(await repo.optionalDownload(path, 50 * 1024 * 1024))) {
        const existing = await client
          .from("document_heads")
          .select("revision")
          .eq("page_id", value.targetPageId)
          .abortSignal(AbortSignal.timeout(15000))
          .maybeSingle();
        if (existing.error || existing.data) throw new InterchangeError("template-destination-changed", 409);
        const meta = z
          .object({
            properties: z
              .array(z.object({ id: z.uuid(), name: z.string(), type: z.string(), config: z.unknown() }))
              .max(500),
          })
          .parse(await rpc(client, "get_database_metadata", { p_database_id: value.databaseId }));
        const head = await client
          .from("document_heads")
          .select("projection")
          .eq("page_id", value.sourcePageId)
          .abortSignal(AbortSignal.timeout(15000))
          .maybeSingle();
        if (head.error) throw new InterchangeError("template-unavailable", 403);
        const raw = z
          .record(z.string(), z.unknown())
          .parse(head.data?.projection ?? { schemaVersion: 1, blocks: [] });
        const projection = normalizeImportProjection({
          schemaVersion: raw.schemaVersion,
          blocks: raw.blocks,
        });
        const cells = await client
          .from("database_cells")
          .select("property_id,value")
          .eq("database_id", value.databaseId)
          .eq("page_id", value.sourcePageId)
          .order("property_id")
          .limit(501)
          .abortSignal(AbortSignal.timeout(15000));
        if (cells.error || !cells.data || cells.data.length > 500)
          throw new InterchangeError("template-default-limit");
        const defaults = cells.data.map((cell) => {
          const property = meta.properties.find((p) => p.id === cell.property_id);
          if (!property) throw new InterchangeError("template-schema-changed", 409);
          const definition = propertyDefinitionSchema.parse(property);
          return { property: definition, value: parsePropertyWrite(definition, cell.value) };
        });
        if (Buffer.byteLength(JSON.stringify(defaults)) > 262144)
          throw new InterchangeError("template-default-limit");
        const files: z.infer<typeof fileSchema>[] = [];
        for (let offset = 0; offset < projection.files.length; offset += 100) {
          const result = await client
            .from("page_files")
            .select("id,object_path,original_name,mime_type,actual_size")
            .eq("page_id", value.sourcePageId)
            .eq("status", "ready")
            .eq("purpose", "block")
            .in("id", projection.files.slice(offset, offset + 100))
            .abortSignal(AbortSignal.timeout(15000));
          if (result.error) throw new InterchangeError("template-file-unavailable", 403);
          files.push(...z.array(fileSchema).parse(result.data));
        }
        if (files.length !== projection.files.length)
          throw new InterchangeError("template-file-unavailable", 403);
        await repo.upload(
          path,
          Buffer.from(
            JSON.stringify({
              databaseId: value.databaseId,
              sourcePageId: value.sourcePageId,
              targetPageId: value.targetPageId,
              projection,
              cells: defaults,
              files,
            }),
          ),
        );
      }
      let item = await repo.append("template-body", "templateBody", { planPath: path });
      item = { ...item, pageId: value.targetPageId, databaseId: value.databaseId };
      await repo.put({ ...item, sourcePageId: value.sourcePageId });
      await repo.save("running", { phase: "template-copy" }, repo.job.report, false);
      try {
        await runTemplateCopy(repo);
      } catch (error) {
        const failure = normalizeInterchangeError(error);
        const transient = isRetryableInterchangeError(failure);
        await repo.save(transient ? "running" : "error", repo.job.cursor, [
          ...repo.job.report,
          { code: transient ? "retry-required" : "job-validation-failed" },
        ]);
      }
      return { jobId: repo.job.id, job: repo.job };
    } catch (error) {
      const failure = normalizeInterchangeError(error),
        transient = isRetryableInterchangeError(failure);
      try {
        await repo.save(transient ? "running" : "error", repo.job.cursor, [
          ...repo.job.report,
          { code: transient ? "retry-required" : "job-validation-failed" },
        ]);
      } catch {}
      throw failure;
    }
  });
}

export async function runTemplateCopy(repo: JobRepository): Promise<void> {
  const deadline = Date.now() + INTERCHANGE_LIMITS.batchMs;
  const body = await repo.get("template-body");
  if (!body?.pageId) throw new InterchangeError("template-plan-unavailable");
  const plan = planSchema.parse(
    JSON.parse((await repo.download(String(body.payload.planPath), 50 * 1024 * 1024)).toString("utf8")),
  );
  if (plan.targetPageId !== body.pageId || plan.sourcePageId !== repo.job.rootPageId)
    throw new InterchangeError("template-plan-invalid");
  let writes = 0;
  for (const cell of plan.cells) {
    const key = `default:${cell.property.id}`;
    if (await repo.get(key)) continue;
    if (Date.now() > deadline || writes++ >= 20) {
      await repo.save("running", { phase: "template-defaults" });
      return;
    }
    const value = parsePropertyWrite(cell.property, cell.value);
    const current = await repo.client
      .from("database_cells")
      .select("value")
      .eq("page_id", body.pageId)
      .eq("property_id", cell.property.id)
      .abortSignal(AbortSignal.timeout(15000))
      .maybeSingle();
    if (current.error) throw new InterchangeError("template-destination-unavailable", 403);
    if (current.data) {
      if (JSON.stringify(parsePropertyWrite(cell.property, current.data.value)) !== JSON.stringify(value))
        throw new InterchangeError("template-destination-changed", 409);
    } else
      await rpc(repo.client, "put_database_cell", {
        p_database_id: plan.databaseId,
        p_page_id: body.pageId,
        p_property_id: cell.property.id,
        p_value: toJson(value),
        p_expected_revision: 0,
      });
    await repo.append(key, "templateDefault", { propertyId: cell.property.id }, "done");
  }
  const fileMap = new Map<string, string>();
  writes = 0;
  for (const file of plan.files) {
    const key = `template-file:${file.id}`;
    let receipt = await repo.append(key, "templateFile", { source: file.id });
    if (receipt.state !== "done") {
      if (Date.now() > deadline || writes++ >= 4) {
        await repo.save("running", { phase: "template-files" });
        return;
      }
      await repo.check();
      const bytes = await repo.download(file.object_path, file.actual_size, repo.client, "page-assets");
      if (bytes.length !== file.actual_size) throw new InterchangeError("template-file-changed", 409);
      const id = z.uuid().parse(
        await rpc(repo.client, "prepare_interchange_file", {
          p_job_id: repo.job.id,
          p_lease_id: repo.lease,
          p_key: key,
          p_page_id: body.pageId,
          p_name: file.original_name,
          p_mime_type: file.mime_type,
          p_size: file.actual_size,
          p_kind: file.mime_type === "application/octet-stream" ? "file" : "image",
        }),
      );
      const target = await repo.client
        .from("page_files")
        .select("object_path,status")
        .eq("id", id)
        .abortSignal(AbortSignal.timeout(15000))
        .single();
      if (target.error || !target.data) throw new InterchangeError("template-file-unavailable", 403);
      if (target.data.status !== "ready") {
        const destinationPath = target.data.object_path;
        const upload = await withInterchangeTransport(() =>
          repo.admin.storage
            .from("page-assets")
            .upload(destinationPath, new Blob([new Uint8Array(bytes).buffer], { type: file.mime_type }), {
              contentType: file.mime_type,
              upsert: false,
            }),
        );
        if (
          upload.error &&
          digest(
            await repo.download(target.data.object_path, file.actual_size, repo.admin, "page-assets"),
          ) !== digest(bytes)
        )
          throw new InterchangeError("template-file-conflict", 409);
      }
      const ready = await finishBlockUpload(id);
      if (!ready.ok) throw new InterchangeError("template-file-validation", 429);
      receipt = { ...receipt, pageId: body.pageId, fileId: id, state: "done" };
      await repo.put(receipt);
    }
    if (!receipt.fileId) throw new InterchangeError("template-file-unavailable");
    fileMap.set(file.id, receipt.fileId);
  }
  const raw = z.record(z.string(), z.unknown()).parse(plan.projection);
  const projection = normalizeImportProjection({ schemaVersion: raw.schemaVersion, blocks: raw.blocks });
  for (const block of projection.blocks)
    if (typeof block.attributes.fileId === "string") {
      const id = fileMap.get(block.attributes.fileId);
      if (!id) throw new InterchangeError("template-file-unavailable");
      block.attributes.fileId = id;
    }
  projection.files = [...fileMap.values()];
  const updates = await stageBodyOperations(repo, body, projection);
  const done = await resumeBodyOperations(repo, body, updates, deadline);
  if (done) {
    body.state = "done";
    await repo.put(body);
  }
  await repo.save(done ? "complete" : "running", {
    phase: done ? "complete" : "template-body",
    processed: Number(body.payload.nextUpdate ?? 0),
    total: updates.length,
  });
}
