import "server-only";
import { templateContentUpdates } from "@/features/databases/model/template-content";
import { MAX_CONTENT_BYTES, MAX_UPDATE_BYTES } from "@/features/editor/model/content-limits";
import type { ContentProjection } from "@/features/editor/model/content-schema";
import { withDocumentSaveSlot } from "@/features/editor/server/document-save-slots";
import { validateDocumentUpdate } from "@/features/editor/server/validate-update";
import type { InterchangeItem } from "../model/contracts";
import { digest, InterchangeError, type JobRepository, operationId, rpc, toJson } from "./repository";

export function encodeBodyOperations(updates: readonly Uint8Array[]): Buffer {
  let size = 4;
  for (const update of updates) {
    if (!update.length || update.length > MAX_UPDATE_BYTES)
      throw new InterchangeError("invalid-body-operation");
    size += 4 + update.length;
  }
  if (updates.length > 10000 || size > 50 * 1024 * 1024) throw new InterchangeError("body-package-too-large");
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(updates.length);
  let offset = 4;
  for (const update of updates) {
    bytes.writeUInt32BE(update.length, offset);
    offset += 4;
    bytes.set(update, offset);
    offset += update.length;
  }
  return bytes;
}
export function decodeBodyOperations(bytes: Buffer): Uint8Array[] {
  if (bytes.length < 4 || bytes.length > 50 * 1024 * 1024) throw new InterchangeError("invalid-body-package");
  const count = bytes.readUInt32BE(0);
  if (count > 10000) throw new InterchangeError("invalid-body-package");
  const updates: Uint8Array[] = [];
  let offset = 4;
  for (let index = 0; index < count; index++) {
    if (offset + 4 > bytes.length) throw new InterchangeError("invalid-body-package");
    const size = bytes.readUInt32BE(offset);
    offset += 4;
    if (!size || size > MAX_UPDATE_BYTES || offset + size > bytes.length)
      throw new InterchangeError("invalid-body-package");
    updates.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  if (offset !== bytes.length) throw new InterchangeError("invalid-body-package");
  return updates;
}
/** Atomic private package stores the fresh identities before any target update.
 * A lost ACK reuses its exact operation bytes and deterministic receipts. */
export async function stageBodyOperations(
  repo: JobRepository,
  item: InterchangeItem,
  projection: ContentProjection,
): Promise<Uint8Array[]> {
  const path = repo.path(`bodies/${digest(Buffer.from(item.key))}.bin`);
  const existing = await repo.optionalDownload(path, 50 * 1024 * 1024);
  if (existing) return decodeBodyOperations(existing);
  const updates = templateContentUpdates(projection, new Map(projection.files.map((id) => [id, id])));
  await repo.upload(path, encodeBodyOperations(updates));
  return updates;
}
function bytea(value: string): Uint8Array {
  if (!value.startsWith("\\x") || value.length > MAX_CONTENT_BYTES * 2 + 2)
    throw new InterchangeError("invalid-document-head", 503);
  const bytes = Buffer.from(value.slice(2), "hex");
  if (bytes.length * 2 !== value.length - 2) throw new InterchangeError("invalid-document-head", 503);
  return bytes;
}
export async function resumeBodyOperations(
  repo: JobRepository,
  item: InterchangeItem,
  updates: readonly Uint8Array[],
  deadline: number,
): Promise<boolean> {
  if (!item.pageId) throw new InterchangeError("missing-import-page");
  const pageId = item.pageId;
  let next = Number(item.payload.nextUpdate ?? 0);
  let count = 0;
  for (; next < updates.length && count < 4 && Date.now() < deadline; next++, count++) {
    await repo.check();
    const delta = updates[next];
    if (!delta) throw new InterchangeError("missing-body-operation");
    await rpc(repo.admin, "reserve_document_validation", {
      p_page_id: item.pageId,
      p_actor_id: repo.actorId,
    });
    await withDocumentSaveSlot(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = await repo.client
          .from("document_heads")
          .select("revision,snapshot")
          .eq("page_id", pageId)
          .abortSignal(AbortSignal.timeout(15000))
          .maybeSingle();
        if (head.error) throw new InterchangeError("document-unavailable", 403);
        const base = head.data ? bytea(String(head.data.snapshot)) : new Uint8Array();
        const result = await validateDocumentUpdate(base, delta);
        try {
          await rpc(repo.admin, "commit_interchange_document", {
            ...repo.args(),
            p_key: item.key,
            p_expected_revision: Number(head.data?.revision ?? 0),
            p_operation_id: operationId(repo.job.id, `${item.key}:body:${next}`),
            p_payload: `\\x${Buffer.from(delta).toString("hex")}`,
            p_hash: digest(delta),
            p_snapshot: `\\x${Buffer.from(result.snapshot).toString("hex")}`,
            p_projection: toJson(result.projection),
          });
          return;
        } catch (error) {
          if (error instanceof InterchangeError && error.status === 409 && attempt < 2) continue;
          throw error;
        }
      }
      throw new InterchangeError("document-conflict", 409);
    });
    item.payload = { ...item.payload, nextUpdate: next + 1 };
    await repo.put(item);
  }
  return next >= updates.length;
}
