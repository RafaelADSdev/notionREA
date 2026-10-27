import { z } from "zod";
import { readBoundedBytes, readBoundedJson } from "@/lib/http";
import { CONTENT_CHUNK_BYTES, MAX_CONTENT_BYTES, MAX_UPDATE_BYTES } from "../model/content-limits";
import {
  DocumentTransportError,
  type DocumentOperation,
  type DocumentSnapshot,
  type DocumentTransport,
} from "../model/durable-document-provider";

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const manifestSchema = z.strictObject({
  revision,
  schemaVersion: z.number().int().min(-1).max(2147483647),
  byteLength: z.number().int().min(0).max(MAX_CONTENT_BYTES),
});
const receiptSchema = z.strictObject({ revision: revision.refine((value) => value > 0) });

function assertResponse(response: Response): void {
  if (response.ok) return;
  const status = response.status;
  throw new DocumentTransportError(
    status === 401 || status === 403 || status === 404
      ? "denied"
      : status === 409
        ? "conflict"
        : status === 429
          ? "busy"
          : status === 400 || status === 413 || status === 422
            ? "invalid"
            : "transient",
  );
}

export class HttpDocumentTransport implements DocumentTransport {
  private readonly path: string;
  constructor(pageId: string) {
    this.path = `/api/documents/${z.uuid().parse(pageId)}`;
  }

  async read(): Promise<DocumentSnapshot> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.readRevision();
      } catch (error) {
        if (error instanceof DocumentTransportError && error.code === "conflict" && attempt < 2) continue;
        if (error instanceof DocumentTransportError) throw error;
        throw new DocumentTransportError("transient");
      }
    }
    throw new DocumentTransportError("conflict");
  }

  private async readRevision(): Promise<DocumentSnapshot> {
    const response = await fetch(this.path, { cache: "no-store", credentials: "same-origin" });
    assertResponse(response);
    let manifest: z.infer<typeof manifestSchema>;
    try {
      manifest = manifestSchema.parse(await readBoundedJson(response, 2048));
    } catch {
      throw new DocumentTransportError("invalid");
    }
    if (manifest.schemaVersion !== 1)
      return {
        revision: manifest.revision,
        schemaVersion: manifest.schemaVersion,
        snapshot: new Uint8Array(),
      };
    const snapshot = new Uint8Array(manifest.byteLength);
    for (let start = 0; start < manifest.byteLength; start += CONTENT_CHUNK_BYTES * 4) {
      const offsets = Array.from({ length: 4 }, (_, index) => start + index * CONTENT_CHUNK_BYTES).filter(
        (offset) => offset < manifest.byteLength,
      );
      await Promise.all(
        offsets.map(async (offset) => {
          const query = new URLSearchParams({ revision: String(manifest.revision), offset: String(offset) });
          const chunkResponse = await fetch(`${this.path}?${query}`, {
            cache: "no-store",
            credentials: "same-origin",
          });
          assertResponse(chunkResponse);
          let bytes: Uint8Array;
          try {
            bytes = await readBoundedBytes(chunkResponse, CONTENT_CHUNK_BYTES);
          } catch {
            throw new DocumentTransportError("invalid");
          }
          if (bytes.length !== Math.min(CONTENT_CHUNK_BYTES, manifest.byteLength - offset))
            throw new DocumentTransportError("invalid");
          snapshot.set(bytes, offset);
        }),
      );
    }
    return { revision: manifest.revision, schemaVersion: manifest.schemaVersion, snapshot };
  }

  async write(operation: DocumentOperation): Promise<{ revision: number }> {
    if (
      !z.uuid().safeParse(operation.id).success ||
      operation.payload.length === 0 ||
      operation.payload.length > MAX_UPDATE_BYTES
    )
      throw new DocumentTransportError("invalid");
    let response: Response;
    try {
      response = await fetch(this.path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/octet-stream", "X-Operation-Id": operation.id },
        body: new Uint8Array(operation.payload),
      });
    } catch {
      throw new DocumentTransportError("transient");
    }
    assertResponse(response);
    try {
      return receiptSchema.parse(await readBoundedJson(response, 2048));
    } catch {
      throw new DocumentTransportError("invalid");
    }
  }
}
