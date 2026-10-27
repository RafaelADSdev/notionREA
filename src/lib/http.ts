export class PayloadLimitError extends Error {
  constructor() {
    super("Payload limit exceeded");
  }
}

export async function readBoundedBytes(
  request: Pick<Request, "headers" | "body">,
  limit: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid request budget");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new PayloadLimitError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new PayloadLimitError();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function readBoundedJson(
  request: Pick<Request, "headers" | "body">,
  limit: number,
): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBytes(request, limit)));
}
