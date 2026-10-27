"use client";
import { z } from "zod";
import { readBoundedJson } from "@/lib/http";
import {
  createJobSchema,
  csvMappingSchema,
  INTERCHANGE_LIMITS,
  type InterchangeJob,
  jobCommandSchema,
  jobSchema,
} from "../model/contracts";

export const uploadSchema = z.strictObject({
  path: z.string().min(1).max(1200),
  token: z.string().min(1).max(8192),
  signedUrl: z.string().min(1).max(16384),
});
export type InterchangeUpload = z.infer<typeof uploadSchema>;
export const previewItemSchema = z.strictObject({
  key: z.string().min(1).max(1100),
  index: z.number().int().nonnegative(),
  kind: z.string().max(40),
  state: z.enum(["pending", "ready", "running", "done", "error", "skipped"]),
  pageId: z.uuid().nullable(),
  databaseId: z.uuid().nullable(),
  fileId: z.uuid().nullable(),
  path: z.string().max(1000).optional(),
  size: z.number().nonnegative().optional(),
  header: z.array(z.string().max(120)).max(500).optional(),
  sample: z
    .array(z.array(z.string().max(200)).max(10))
    .max(5)
    .optional(),
  error: z.string().max(1000).optional(),
  mapping: csvMappingSchema.optional(),
});
export type InterchangePreviewItem = z.infer<typeof previewItemSchema>;
export const detailSchema = z.strictObject({
  job: jobSchema,
  items: z.array(previewItemSchema).max(50),
  nextIndex: z.number().int().nonnegative().nullable(),
  upload: uploadSchema.optional(),
});
export type InterchangeDetail = z.infer<typeof detailSchema>;
const createdSchema = z.strictObject({ job: jobSchema, upload: uploadSchema.optional() });
const listSchema = z.strictObject({
  jobs: z.array(jobSchema).max(50),
  nextCursor: z.string().max(2048).nullable(),
});
export type StartInterchange =
  | {
      kind: "import";
      workspaceId: string;
      parentId: string | null;
      name: string;
      size: number;
      digest: string;
    }
  | { kind: "export"; workspaceId: string; pageId: string };
export class InterchangeHttpError extends Error {
  constructor(public readonly status: number) {
    super("Interchange request failed");
  }
}
export class InterchangeClient {
  private operations = new Map<string, string>();
  constructor(readonly workspaceId: string) {
    z.uuid().parse(workspaceId);
  }
  beginNewOperation() {
    this.operations.clear();
  }
  private async request<T>(
    url: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new InterchangeHttpError(response.status);
    try {
      return schema.parse(await readBoundedJson(response, 1048576));
    } catch {
      throw new InterchangeHttpError(503);
    }
  }
  private checkJob(job: InterchangeJob) {
    if (job.workspaceId.toLowerCase() !== this.workspaceId.toLowerCase()) throw new InterchangeHttpError(403);
    if (["complete", "cancelled", "error"].includes(job.state)) {
      for (const [key, operation] of this.operations)
        if (operation === job.operationId) this.operations.delete(key);
    }
    return job;
  }
  async create(input: StartInterchange, signal?: AbortSignal) {
    if (input.workspaceId !== this.workspaceId) throw new InterchangeHttpError(403);
    const key = JSON.stringify(input);
    const operationId = this.operations.get(key) ?? crypto.randomUUID();
    this.operations.set(key, operationId);
    const body = createJobSchema.parse({ ...input, operationId });
    const result = await this.request("/api/interchange", createdSchema, body, signal);
    this.checkJob(result.job);
    if (result.job.operationId !== operationId || result.job.kind !== input.kind)
      throw new InterchangeHttpError(503);
    return result;
  }
  async list(cursor?: string | null, signal?: AbortSignal) {
    const parameters = new URLSearchParams({ workspaceId: this.workspaceId });
    if (cursor) parameters.set("cursor", cursor);
    const result = await this.request(`/api/interchange?${parameters}`, listSchema, undefined, signal);
    for (const job of result.jobs) this.checkJob(job);
    return result;
  }
  async detail(id: string, afterIndex = -1, signal?: AbortSignal): Promise<InterchangeDetail> {
    z.uuid().parse(id);
    z.number().int().min(-1).parse(afterIndex);
    const result = await this.request(
      `/api/interchange/${id}?afterIndex=${afterIndex}`,
      detailSchema,
      undefined,
      signal,
    );
    this.checkJob(result.job);
    if (result.job.id !== id) throw new InterchangeHttpError(503);
    return result;
  }
  async action(id: string, input: unknown, signal?: AbortSignal): Promise<InterchangeDetail> {
    z.uuid().parse(id);
    const result = await this.request(
      `/api/interchange/${id}`,
      detailSchema,
      jobCommandSchema.parse(input),
      signal,
    );
    this.checkJob(result.job);
    if (result.job.id !== id) throw new InterchangeHttpError(503);
    return result;
  }
}
export class InterchangeQueue {
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(
    private readonly client: InterchangeClient,
    private readonly maximumBatches = 20,
  ) {
    if (!Number.isInteger(maximumBatches) || maximumBatches < 1 || maximumBatches > 100)
      throw new Error("Invalid queue budget");
  }
  stop() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }
  async run(
    initial: InterchangeJob,
    onUpdate: (detail: InterchangeDetail) => void,
  ): Promise<{ job: InterchangeJob; reason: "ready" | "bounded" | "stopped" | "unchanged" }> {
    this.stop();
    const generation = this.generation,
      controller = new AbortController();
    this.controller = controller;
    let job = initial;
    try {
      for (let batch = 0; batch < this.maximumBatches; batch++) {
        if (generation !== this.generation || controller.signal.aborted) return { job, reason: "stopped" };
        const action =
          job.state === "scanning" ? "scan" : job.state === "running" && job.confirmed ? "run" : null;
        if (!action) return { job, reason: "ready" };
        const detail = await this.client.action(job.id, { action }, controller.signal);
        if (generation !== this.generation || controller.signal.aborted) return { job, reason: "stopped" };
        const unchanged = detail.job.revision === job.revision && detail.job.state === job.state;
        job = detail.job;
        onUpdate(detail);
        if (unchanged) return { job, reason: "unchanged" };
      }
      return { job, reason: "bounded" };
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return { job, reason: "stopped" };
      throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}

/** A signed capability is accepted only for this authenticated job's private source object. */
export function authorizedUploadUrl(
  job: InterchangeJob,
  upload: InterchangeUpload,
  storageOrigin: string,
): string {
  const origin = new URL(storageOrigin);
  const url = new URL(upload.signedUrl, origin);
  const path = `${job.workspaceId}/${job.actorId}/${job.id}/source.zip`;
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash ||
    upload.path !== path ||
    job.sourcePath !== path ||
    decodeURIComponent(url.pathname) !== `/storage/v1/object/upload/sign/interchange/${path}` ||
    url.searchParams.get("token") !== upload.token
  )
    throw new InterchangeHttpError(400);
  return url.href;
}
export async function zipDigest(file: File, signal?: AbortSignal): Promise<string> {
  if (file.size < 1 || file.size > INTERCHANGE_LIMITS.sourceBytes || !/\.zip$/i.test(file.name))
    throw new InterchangeHttpError(400);
  signal?.throwIfAborted();
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  signal?.throwIfAborted();
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function uploadInterchangeSource(
  job: InterchangeJob,
  upload: InterchangeUpload,
  file: File,
  signal: AbortSignal,
  onProgress: (bytes: number, total: number) => void,
): Promise<void> {
  const expectedOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!expectedOrigin) return Promise.reject(new InterchangeHttpError(503));
  const url = authorizedUploadUrl(job, upload, expectedOrigin);
  if (file.size !== job.sourceSize || file.size > INTERCHANGE_LIMITS.sourceBytes)
    return Promise.reject(new InterchangeHttpError(400));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => {
      xhr.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new InterchangeHttpError(xhr.status));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new InterchangeHttpError(503));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", new Blob([file], { type: "application/zip" }), file.name);
    xhr.send(body);
  });
}
