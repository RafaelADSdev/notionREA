import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CONTENT_CHUNK_BYTES, MAX_CONTENT_BYTES } from "../model/content-limits";
import { DocumentSaveBusyError, withDocumentSaveSlot } from "./document-save-slots";
import { DocumentValidationError, validateDocumentUpdate } from "./validate-update";

export class DocumentRequestError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 503) {
    super("Document request failed");
  }
}
function databaseError(code: string | undefined): DocumentRequestError {
  return new DocumentRequestError(
    code === "40001" ? 409 : code === "42501" ? 403 : code === "22023" ? 422 : code === "54000" ? 429 : 503,
  );
}
function fromBytea(value: string, max: number): Uint8Array {
  if (!value.startsWith("\\x") || value.length > max * 2 + 2 || (value.length - 2) % 2 !== 0)
    throw new DocumentRequestError(503);
  const bytes = Buffer.from(value.slice(2), "hex");
  if (bytes.length !== (value.length - 2) / 2) throw new DocumentRequestError(503);
  return bytes;
}

export async function documentManifest(pageId: string) {
  const client = await createClient();
  const { data, error } = await client.rpc("get_document_manifest", { p_page_id: pageId });
  if (error) throw databaseError(error.code);
  const row = data?.[0];
  if (!row) throw new DocumentRequestError(404);
  return { revision: row.revision, schemaVersion: row.schema_version, byteLength: row.byte_length };
}

export async function documentChunk(pageId: string, revision: number, offset: number): Promise<Uint8Array> {
  const client = await createClient();
  const { data, error } = await client.rpc("read_document_chunk", {
    p_page_id: pageId,
    p_revision: revision,
    p_offset: offset,
  });
  if (error) throw databaseError(error.code);
  if (typeof data !== "string") throw new DocumentRequestError(503);
  return fromBytea(data, CONTENT_CHUNK_BYTES);
}

export async function requireContentEditor(pageId: string): Promise<void> {
  const client = await createClient();
  const { data, error } = await client.rpc("get_page_role", { p_page_id: pageId });
  if (error || (data !== "owner" && data !== "editor")) throw new DocumentRequestError(403);
}

export async function saveContentOperation(
  pageId: string,
  actorId: string,
  operationId: string,
  delta: Uint8Array,
): Promise<number> {
  const client = await createClient();
  const admin = createAdminClient();
  const reservation = await admin.rpc("reserve_document_validation", {
    p_page_id: pageId,
    p_actor_id: actorId,
  });
  if (reservation.error) throw databaseError(reservation.error.code);
  const hash = createHash("sha256").update(delta).digest("hex");
  try {
    return await withDocumentSaveSlot(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = await client
          .from("document_heads")
          .select("revision,snapshot")
          .eq("page_id", pageId)
          .maybeSingle();
        if (head.error) throw databaseError(head.error.code);
        const revision = head.data?.revision ?? 0;
        const base = head.data ? fromBytea(head.data.snapshot, MAX_CONTENT_BYTES) : new Uint8Array();
        let result: Awaited<ReturnType<typeof validateDocumentUpdate>>;
        try {
          result = await validateDocumentUpdate(base, delta);
        } catch (error) {
          throw new DocumentRequestError(
            error instanceof DocumentValidationError && error.kind === "invalid" ? 422 : 503,
          );
        }
        const committed = await admin.rpc("commit_content_document", {
          p_page_id: pageId,
          p_actor_id: actorId,
          p_expected_revision: revision,
          p_operation_id: operationId,
          p_payload: `\\x${Buffer.from(delta).toString("hex")}`,
          p_hash: hash,
          p_snapshot: `\\x${Buffer.from(result.snapshot).toString("hex")}`,
          p_projection: result.projection,
        });
        if (committed.error?.code === "40001" && attempt < 2) continue;
        if (committed.error) throw databaseError(committed.error.code);
        if (typeof committed.data !== "number") throw new DocumentRequestError(503);
        return committed.data;
      }
      throw new DocumentRequestError(409);
    });
  } catch (error) {
    if (error instanceof DocumentSaveBusyError) throw new DocumentRequestError(503);
    throw error;
  }
}
