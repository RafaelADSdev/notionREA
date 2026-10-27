import { parentPort, workerData } from "node:worker_threads";
import * as Y from "yjs";
import { MAX_CONTENT_BYTES, MAX_UPDATE_BYTES, validateContentDocument } from "../model/content-schema";

// Yjs 13.6.33 exposes these fields in StructStore's shipped types. Keep this
// dependency-specific causal check here and revalidate it when upgrading Yjs:
// encoding a document with pending operations would preserve unvalidated data.
function requireCompleteCausality(document: Y.Doc): void {
  if (document.store.pendingStructs !== null || document.store.pendingDs !== null)
    throw new Error("Incomplete document update");
}

const document = new Y.Doc();
try {
  const { base, delta } = workerData as { base: Uint8Array; delta: Uint8Array };
  if (
    !(base instanceof Uint8Array) ||
    !(delta instanceof Uint8Array) ||
    base.byteLength > MAX_CONTENT_BYTES ||
    delta.byteLength === 0 ||
    delta.byteLength > MAX_UPDATE_BYTES
  )
    throw new Error("Invalid document update");
  if (base.byteLength) Y.applyUpdate(document, base);
  Y.applyUpdate(document, delta);
  requireCompleteCausality(document);
  const projection = validateContentDocument(document);
  const encoded = Y.encodeStateAsUpdate(document);
  // V8 resourceLimits exclude ArrayBuffers; byte caps apply independently.
  if (
    encoded.byteLength > MAX_CONTENT_BYTES ||
    Buffer.byteLength(JSON.stringify(projection), "utf8") > MAX_CONTENT_BYTES
  )
    throw new Error("Content size limit exceeded");
  const snapshot = new Uint8Array(encoded);
  parentPort?.postMessage({ ok: true, snapshot, projection }, [snapshot.buffer]);
} catch {
  // Do not transmit exceptions, stacks, schema paths or attacker-controlled text.
  parentPort?.postMessage({ ok: false });
} finally {
  document.destroy();
  parentPort?.close();
}
