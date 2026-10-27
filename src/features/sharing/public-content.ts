import { readBoundedJson } from "@/lib/http";
import {
  PUBLIC_CONTENT_CHUNK_BYTES,
  type PublicContentManifest,
  publicationToken,
  publicChunkSchema,
  publicContentManifest,
  publicContentSchema,
} from "./model";

export class PublicTransferError extends Error {
  constructor(public readonly status: number) {
    super("Public transfer unavailable");
  }
}

/** Assemble bytes before decoding: a UTF-8 character can cross a chunk boundary. */
export async function loadPublicContent(
  token: string,
  expected: PublicContentManifest,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  publicationToken.parse(token);
  const manifest = publicContentManifest.parse(expected);
  const bytes = new Uint8Array(manifest.byteLength);
  for (let index = 0; index < manifest.chunks; index++) {
    signal.throwIfAborted();
    const query = new URLSearchParams({ hash: manifest.hash, index: String(index) });
    const response = await fetcher(`/api/public/${token}/content?${query}`, {
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new PublicTransferError(response.status);
    const chunk = publicChunkSchema.parse(await readBoundedJson(response, 400000));
    if (chunk.hash !== manifest.hash || chunk.index !== index || chunk.byteLength !== manifest.byteLength)
      throw new PublicTransferError(503);
    const decoded = atob(chunk.data);
    const offset = index * PUBLIC_CONTENT_CHUNK_BYTES;
    if (decoded.length !== Math.min(PUBLIC_CONTENT_CHUNK_BYTES, manifest.byteLength - offset))
      throw new PublicTransferError(503);
    for (let byte = 0; byte < decoded.length; byte++) bytes[offset + byte] = decoded.charCodeAt(byte);
  }
  signal.throwIfAborted();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== manifest.hash) throw new PublicTransferError(409);
  return publicContentSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
