import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, currentUser } from "@/lib/supabase/server";
import { createJobSchema, INTERCHANGE_LIMITS, jobCommandSchema, jobSchema } from "../model/contracts";
import { runExport } from "./export";
import { configureImport, runImport, scanImport } from "./import";
import {
  acquireInterchangeSlot,
  type InterchangeClient,
  InterchangeError,
  isRetryableInterchangeError,
  JobRepository,
  normalizeInterchangeError,
  rpc,
  withInterchangeSlot,
  withInterchangeTransport,
} from "./repository";
import { boundedInterchangeStream } from "./streams";
import { runTemplateCopy } from "./template-copy";

async function actor(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new InterchangeError("authentication-required", 401);
  return user.id;
}
const envelopeSchema = z.object({
  job: jobSchema,
  items: z.array(z.unknown()).max(50),
  nextIndex: z.number().int().nullable(),
});
async function uploadCapability(job: z.infer<typeof jobSchema>) {
  if (job.state !== "uploading") return {};
  const result = await withInterchangeTransport(() =>
    createAdminClient().storage.from("interchange").createSignedUploadUrl(job.sourcePath, { upsert: false }),
  );
  if (result.error || !result.data) throw new InterchangeError("upload-unavailable", 503);
  return { upload: { path: result.data.path, token: result.data.token, signedUrl: result.data.signedUrl } };
}
export async function createInterchange(input: unknown) {
  const parsed = createJobSchema.parse(input);
  await actor();
  const client = (await createClient()) as InterchangeClient;
  const job = jobSchema.parse(
    await rpc(client, "create_interchange_job", {
      p_workspace_id: parsed.workspaceId,
      p_kind: parsed.kind,
      p_request_id: parsed.operationId,
      p_root_page_id: parsed.kind === "export" ? parsed.pageId : null,
      p_parent_id: parsed.kind === "import" ? parsed.parentId : null,
      p_source_size: parsed.kind === "import" ? parsed.size : 0,
      p_source_digest: parsed.kind === "import" ? parsed.digest : "",
      p_source_name: parsed.kind === "import" ? parsed.name : "Exportação",
    }),
  );
  return { job, ...(await uploadCapability(job)) };
}
export async function interchangeStatus(id: string, after = -1) {
  z.uuid().parse(id);
  await actor();
  const client = (await createClient()) as InterchangeClient;
  const result = envelopeSchema.parse(
    await rpc(client, "get_interchange_job", { p_job_id: id, p_after_index: after }),
  );
  return { ...result, ...(await uploadCapability(result.job)) };
}
export async function listInterchange(workspaceId: string, cursor?: string) {
  z.uuid().parse(workspaceId);
  await actor();
  let after: { createdAt: string; id: string } | undefined;
  if (cursor) {
    if (cursor.length > 512) throw new InterchangeError("invalid-cursor", 400);
    after = z
      .object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  }
  const client = (await createClient()) as InterchangeClient;
  const result = z
    .object({
      jobs: z.array(jobSchema).max(50),
      nextCursor: z.object({ createdAt: z.string(), id: z.uuid() }).nullable(),
    })
    .parse(
      await rpc(client, "list_interchange_jobs", {
        p_workspace_id: workspaceId,
        p_after_created_at: after?.createdAt ?? null,
        p_after_id: after?.id ?? null,
      }),
    );
  return {
    jobs: result.jobs,
    nextCursor: result.nextCursor
      ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url")
      : null,
  };
}
export async function commandInterchange(id: string, input: unknown) {
  z.uuid().parse(id);
  const userId = await actor();
  const command = jobCommandSchema.parse(input);
  const client = (await createClient()) as InterchangeClient;
  if (command.action === "cancel") {
    await rpc(client, "cancel_interchange_job", { p_job_id: id });
    return interchangeStatus(id);
  }
  if (command.action === "confirm") {
    await rpc(client, "confirm_interchange_job", { p_job_id: id });
    return interchangeStatus(id);
  }
  await withInterchangeSlot(async () => {
    const repo = await JobRepository.claim(id, userId);
    try {
      if (command.action === "configure") {
        if (repo.job.kind !== "import") throw new InterchangeError("invalid-job-action");
        await configureImport(repo, command.mappings);
      } else if (repo.job.kind === "export") await runExport(repo);
      else if (repo.job.kind === "import") {
        if (repo.job.state === "running") await runImport(repo);
        else if (["uploading", "scanning"].includes(repo.job.state)) await scanImport(repo);
        else throw new InterchangeError("invalid-job-action");
      } else if (repo.job.kind === "templateCopy") await runTemplateCopy(repo);
      else throw new InterchangeError("unsupported-job-action");
    } catch (error) {
      const failure = normalizeInterchangeError(error);
      const transient = isRetryableInterchangeError(failure);
      try {
        await repo.save(
          transient ? (repo.job.state === "uploading" ? "scanning" : repo.job.state) : "error",
          repo.job.state === "uploading" ? { ...repo.job.cursor, phase: "extract" } : repo.job.cursor,
          [...repo.job.report, { code: transient ? "retry-required" : "job-validation-failed" }],
        );
      } catch {
        /* Revocation/cancellation must prevent any later writes. */
      }
      throw failure;
    }
  });
  return interchangeStatus(id);
}
const partSchema = z.object({
  index: z.number().int(),
  path: z.string(),
  size: z.number().int().min(0).max(INTERCHANGE_LIMITS.sourceBytes),
});
export async function downloadInterchange(
  id: string,
): Promise<{ stream: ReadableStream<Uint8Array>; filename: string }> {
  const userId = await actor();
  const status = await interchangeStatus(id);
  if (status.job.state !== "complete" || status.job.kind !== "export")
    throw new InterchangeError("export-incomplete");
  const client = (await createClient()) as InterchangeClient;
  const repo = new JobRepository(client, userId, status.job);
  const release = await acquireInterchangeSlot();
  let parts: z.infer<typeof partSchema>[] = [];
  let after = -1;
  let exhausted = false;
  const stream = boundedInterchangeStream(async () => {
    if (!parts.length && !exhausted) {
      parts = z
        .array(partSchema)
        .max(50)
        .parse(await rpc(client, "interchange_download_parts", { p_job_id: id, p_after_index: after }));
      exhausted = parts.length < 50;
    }
    const part = parts.shift();
    if (!part) return null;
    // Reauthorize before each buffered part; no download capability reaches the client.
    await rpc(client, "get_interchange_job", { p_job_id: id, p_after_index: -1 });
    const bytes = await repo.download(part.path, part.size);
    if (bytes.length !== part.size) throw new InterchangeError("export-part-invalid", 503);
    after = part.index;
    return new Uint8Array(bytes);
  }, release);
  return { stream, filename: `Bloco-${id}.zip` };
}
