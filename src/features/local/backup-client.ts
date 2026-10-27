import { z } from "zod";
import { localPageSchema, type LocalDocument, type LocalPage } from "./model";

const resultSchema = z.strictObject({
  pages: z.array(localPageSchema).max(2500),
  documents: z
    .array(
      z.strictObject({
        pageId: z.uuid(),
        revision: z.number().int().min(1),
        snapshot: z.instanceof(Uint8Array).refine((value) => value.length <= 8 * 1024 * 1024),
        text: z.string().max(8 * 1024 * 1024),
      }),
    )
    .max(2500),
});
/** Never decode untrusted Yjs on the UI thread; terminate an over-budget import. */
export function decodeBackupInWorker(
  text: string,
): Promise<{ pages: LocalPage[]; documents: LocalDocument[] }> {
  if (new TextEncoder().encode(text).length > 32 * 1024 * 1024)
    return Promise.reject(new Error("Backup too large"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./backup-worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Backup validation timed out"));
    }, 5000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      finish();
      const envelope = z.object({ ok: z.boolean(), value: z.unknown().optional() }).safeParse(event.data);
      if (!envelope.success || !envelope.data.ok) {
        reject(new Error("Invalid backup"));
        return;
      }
      const result = resultSchema.safeParse(envelope.data.value);
      if (!result.success) reject(new Error("Invalid backup response"));
      else resolve(result.data);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("Backup worker unavailable"));
    };
    worker.postMessage(text);
  });
}
