import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  INTERCHANGE_LIMITS,
  type InterchangeItem,
  type InterchangeJob,
  type InterchangeWarning,
  itemSchema,
  jobSchema,
} from "../model/contracts";

export class InterchangeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 422,
  ) {
    super("Interchange request failed");
  }
}
export function operationId(jobId: string, key: string): string {
  const h = createHash("sha256").update(`${jobId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
type Functions = Database["public"]["Functions"];
type RpcSchema = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: {
      [Name in keyof Functions]: Omit<Functions[Name], "Args"> & {
        Args: {
          [Key in keyof Functions[Name]["Args"]]: undefined extends Functions[Name]["Args"][Key]
            ? Functions[Name]["Args"][Key] | null
            : Functions[Name]["Args"][Key];
        };
      };
    };
  };
};
export type InterchangeClient = SupabaseClient<RpcSchema>;
export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
/** Item details stay paginated; repeated warnings use counts rather than an
 * unbounded list of path strings in the one-MiB job response. */
export function compactReport(warnings: readonly InterchangeWarning[]): InterchangeWarning[] {
  const unique = new Map(warnings.map((warning) => [JSON.stringify(warning), warning]));
  const groups = new Map<string, InterchangeWarning>();
  for (const warning of unique.values()) {
    const previous = groups.get(warning.code);
    if (previous)
      groups.set(warning.code, { code: warning.code, count: (previous.count ?? 1) + (warning.count ?? 1) });
    else groups.set(warning.code, { ...warning });
  }
  let result = [...groups.values()];
  if (Buffer.byteLength(JSON.stringify(result)) > 200000) {
    result = result.map(({ code, count }) => ({ code, ...(count === undefined ? {} : { count }) }));
    result.push({ code: "report-paths-in-item-inventory", count: unique.size });
  }
  if (result.length > 1000) {
    const additional = result.slice(999).reduce((count, warning) => count + (warning.count ?? 1), 0);
    result = [...result.slice(0, 999), { code: "additional-reports-in-item-inventory", count: additional }];
  }
  return result;
}
/** Call only around I/O, keeping content parsing outside the transport boundary. */
export async function withInterchangeTransport<T>(request: () => PromiseLike<T> | T): Promise<T> {
  try {
    return await request();
  } catch {
    throw new InterchangeError("transport-unavailable", 503);
  }
}
export function normalizeInterchangeError(error: unknown): InterchangeError {
  if (error instanceof InterchangeError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ["AbortError", "TimeoutError", "TypeError"].includes(String(error.name))
  )
    return new InterchangeError("transport-unavailable", 503);
  return new InterchangeError("job-validation-failed", 422);
}
export function isRetryableInterchangeError(error: InterchangeError): boolean {
  return [403, 409, 429, 503].includes(error.status);
}
export async function rpc<Name extends keyof Functions>(
  client: InterchangeClient,
  name: Name,
  args: RpcSchema["public"]["Functions"][Name]["Args"],
): Promise<unknown> {
  const result = await withInterchangeTransport(() =>
    client.rpc(name, args).abortSignal(AbortSignal.timeout(15000)),
  );
  if (result.status === 0 || result.status >= 500 || result.status === 408)
    throw new InterchangeError("transport-unavailable", 503);
  if (result.error) {
    const code = result.error.code;
    if (code === "42501" || code === "28000" || result.status === 401 || result.status === 403)
      throw new InterchangeError("access-denied", 403);
    if (code === "40001") throw new InterchangeError("job-busy", 409);
    if (code === "54000" || result.status === 429) throw new InterchangeError("rate-limit", 429);
    if (/^(?:22[A-Z0-9]{3}|23[A-Z0-9]{3}|P0001)$/.test(code)) throw new InterchangeError("job-invalid", 422);
    // Unknown gateway/server errors cannot establish that the input was invalid.
    throw new InterchangeError("transport-unavailable", 503);
  }
  if (result.status >= 400) throw new InterchangeError("transport-unavailable", 503);
  return result.data;
}

let active = 0;
const waiting: { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
export async function acquireInterchangeSlot(): Promise<() => void> {
  if (active >= 2) {
    if (waiting.length >= 8) throw new InterchangeError("server-busy", 503);
    await new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        reject: () => reject(new InterchangeError("server-busy", 503)),
        timer: setTimeout(() => {
          const index = waiting.indexOf(entry);
          if (index >= 0) waiting.splice(index, 1);
          entry.reject();
        }, 5000),
      };
      waiting.push(entry);
    });
  } else active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    } else active--;
  };
}
export async function withInterchangeSlot<T>(work: () => Promise<T>): Promise<T> {
  const release = await acquireInterchangeSlot();
  try {
    return await work();
  } finally {
    release();
  }
}
export class JobRepository {
  readonly admin: InterchangeClient = createAdminClient() as InterchangeClient;
  private nextIndex: number | undefined;
  constructor(
    readonly client: InterchangeClient,
    readonly actorId: string,
    public job: InterchangeJob,
    readonly lease = crypto.randomUUID(),
  ) {}
  static async claim(jobId: string, actorId: string): Promise<JobRepository> {
    const client = (await createClient()) as InterchangeClient;
    const admin: InterchangeClient = createAdminClient() as InterchangeClient;
    const lease = crypto.randomUUID();
    const job = jobSchema.parse(
      await rpc(admin, "claim_interchange_job", { p_job_id: jobId, p_actor_id: actorId, p_lease_id: lease }),
    );
    return new JobRepository(client, actorId, job, lease);
  }
  args() {
    return { p_job_id: this.job.id, p_actor_id: this.actorId, p_lease_id: this.lease };
  }
  async check(): Promise<void> {
    this.job = jobSchema.parse(await rpc(this.admin, "claim_interchange_job", this.args()));
  }
  async save(
    state: InterchangeJob["state"],
    cursor: Record<string, unknown>,
    report: InterchangeWarning[] = this.job.report,
    release = true,
  ): Promise<void> {
    this.job = jobSchema.parse(
      await rpc(this.admin, "write_interchange_job", {
        ...this.args(),
        p_state: state,
        p_cursor: toJson(cursor),
        p_report: toJson(compactReport(report)),
        p_release: release,
      }),
    );
  }
  async items(kind: string | null = null, after = -1): Promise<InterchangeItem[]> {
    return z
      .array(itemSchema)
      .max(50)
      .parse(
        await rpc(this.admin, "read_interchange_items", {
          ...this.args(),
          p_after_index: after,
          p_kind: kind,
        }),
      );
  }
  async all(kind: string): Promise<InterchangeItem[]> {
    const items: InterchangeItem[] = [];
    let after = -1;
    while (true) {
      const page = await this.items(kind, after);
      items.push(...page);
      if (page.length < 50) break;
      after = page.at(-1)?.index ?? after;
      if (items.length > 60000) throw new InterchangeError("job-item-limit");
    }
    return items;
  }
  async get(key: string): Promise<InterchangeItem | null> {
    const result = await this.admin
      .from("interchange_items")
      .select("key,index,kind,state,payload,page_id,database_id,file_id,source_page_id")
      .eq("job_id", this.job.id)
      .eq("key", key)
      .abortSignal(AbortSignal.timeout(15000))
      .maybeSingle();
    if (result.error) throw new InterchangeError("job-read-failed", 503);
    if (!result.data) return null;
    const row = result.data;
    return itemSchema.parse({
      ...row,
      pageId: row.page_id,
      databaseId: row.database_id,
      fileId: row.file_id,
      sourcePageId: row.source_page_id,
    });
  }
  async put(item: InterchangeItem & { sourcePageId?: string | null }): Promise<void> {
    await rpc(this.admin, "put_interchange_item", {
      ...this.args(),
      p_key: item.key,
      p_index: item.index,
      p_kind: item.kind,
      p_state: item.state,
      p_payload: toJson(item.payload),
      p_page_id: item.pageId,
      p_database_id: item.databaseId,
      p_file_id: item.fileId,
      p_source_page_id: item.sourcePageId ?? null,
    });
  }
  async append(
    key: string,
    kind: string,
    payload: Record<string, unknown>,
    state: InterchangeItem["state"] = "pending",
  ): Promise<InterchangeItem> {
    const existing = await this.get(key);
    if (existing) return existing;
    if (this.nextIndex === undefined) {
      const last = await this.admin
        .from("interchange_items")
        .select("index")
        .eq("job_id", this.job.id)
        .order("index", { ascending: false })
        .limit(1)
        .abortSignal(AbortSignal.timeout(15000));
      if (last.error) throw new InterchangeError("job-read-failed", 503);
      this.nextIndex = Number(last.data?.[0]?.index ?? -1) + 1;
    }
    const item: InterchangeItem = {
      key,
      index: this.nextIndex++,
      kind,
      state,
      payload,
      pageId: null,
      databaseId: null,
      fileId: null,
    };
    await this.put(item);
    return item;
  }
  path(suffix: string): string {
    return `${this.job.workspaceId}/${this.actorId}/${this.job.id}/${suffix}`;
  }
  async download(
    path: string,
    maximum = INTERCHANGE_LIMITS.chunkBytes,
    sourceClient: InterchangeClient = this.admin,
    bucket = "interchange",
  ): Promise<Buffer> {
    if (bucket === "interchange" && !path.startsWith(this.path("")))
      throw new InterchangeError("invalid-job-object");
    const result = await withInterchangeTransport(() =>
      sourceClient.storage
        .from(bucket)
        .download(path, {}, { signal: AbortSignal.timeout(15000), cache: "no-store" }),
    );
    if (result.error || !result.data) throw new InterchangeError("source-unavailable", 503);
    if (result.data.size > maximum) throw new InterchangeError("source-too-large", 413);
    return Buffer.from(await withInterchangeTransport(() => result.data.arrayBuffer()));
  }
  async optionalDownload(path: string, maximum: number): Promise<Buffer | null> {
    const result = await withInterchangeTransport(() =>
      this.admin.storage
        .from("interchange")
        .download(path, {}, { signal: AbortSignal.timeout(15000), cache: "no-store" }),
    );
    if (result.error) {
      const status = "status" in result.error ? Number(result.error.status) : 0;
      const code = "statusCode" in result.error ? String(result.error.statusCode) : "";
      const apiCode = "code" in result.error ? String(result.error.code) : "";
      if (
        status === 404 ||
        (status === 400 && (code === "404" || code === "NoSuchKey" || apiCode === "NoSuchKey"))
      )
        return null;
      throw new InterchangeError("storage-unavailable", 503);
    }
    if (!result.data || result.data.size > maximum) throw new InterchangeError("source-too-large", 413);
    return Buffer.from(await withInterchangeTransport(() => result.data.arrayBuffer()));
  }
  async upload(path: string, bytes: Uint8Array): Promise<void> {
    if (!path.startsWith(this.path("")) || bytes.byteLength > INTERCHANGE_LIMITS.sourceBytes)
      throw new InterchangeError("invalid-job-object");
    const existing = await this.optionalDownload(path, bytes.length);
    if (existing) {
      if (digest(existing) !== digest(bytes)) throw new InterchangeError("object-receipt-conflict", 409);
      return;
    }
    const cap = await withInterchangeTransport(() =>
      this.admin.storage.from("interchange").createSignedUploadUrl(path, { upsert: false }),
    );
    if (cap.error || !cap.data) throw new InterchangeError("storage-unavailable", 503);
    const url = new URL(cap.data.signedUrl, getEnvironment().NEXT_PUBLIC_SUPABASE_URL);
    if (url.origin !== new URL(getEnvironment().NEXT_PUBLIC_SUPABASE_URL).origin)
      throw new InterchangeError("invalid-storage-origin", 503);
    const form = new FormData();
    form.set("cacheControl", "0");
    form.set("file", new Blob([new Uint8Array(bytes).buffer], { type: "application/octet-stream" }));
    const response = await withInterchangeTransport(() =>
      fetch(url, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: form,
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (!response.ok) {
      const retry = await this.optionalDownload(path, bytes.length);
      if (!retry || digest(retry) !== digest(bytes)) throw new InterchangeError("storage-unavailable", 503);
    }
  }
}
