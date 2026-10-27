import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { ContentProjection } from "../model/content-schema";

// Keep the request boundary free of runtime Yjs imports and binary decoding.
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_UPDATE_BYTES = 256 * 1024;
const MAX_ACTIVE_WORKERS = 2;
const MAX_WAITING = 8;
const WORKER_TIMEOUT_MS = 3000;
type ValidationResult = { snapshot: Uint8Array; projection: ContentProjection };
type ValidationKind = "invalid" | "busy" | "timeout";
const messages: Record<ValidationKind, string> = {
  invalid: "Invalid document update",
  busy: "Document validation is busy",
  timeout: "Document validation timed out",
};

export class DocumentValidationError extends Error {
  constructor(public readonly kind: ValidationKind) {
    super(messages[kind]);
    this.name = "DocumentValidationError";
  }
}

let activeWorkers = 0;
const waiting: (() => void)[] = [];

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else activeWorkers -= 1;
}

async function acquireSlot(): Promise<void> {
  if (activeWorkers < MAX_ACTIVE_WORKERS) {
    activeWorkers += 1;
    return;
  }
  if (waiting.length >= MAX_WAITING) throw new DocumentValidationError("busy");
  await new Promise<void>((ready) => waiting.push(ready));
}

function runWorker(base: Uint8Array<ArrayBuffer>, delta: Uint8Array<ArrayBuffer>): Promise<ValidationResult> {
  return new Promise((accept, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(resolve(process.cwd(), ".editor-runtime", "validation-worker.mjs"), {
        workerData: { base, delta },
        transferList: [base.buffer, delta.buffer],
        env: {},
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        stdout: true,
        stderr: true,
      });
    } catch {
      releaseSlot();
      reject(new DocumentValidationError("invalid"));
      return;
    }
    // Some dependency decode failures write diagnostics; discard worker output.
    worker.stdout?.resume();
    worker.stderr?.resume();
    let finished = false;
    const finish = (result: ValidationResult | DocumentValidationError): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      // An error already queued while termination begins must remain handled.
      worker.on("error", () => undefined);
      // Keep the slot until termination completes: never exceed two live workers.
      void worker.terminate().then(
        () => {
          worker.removeAllListeners();
          releaseSlot();
          if (result instanceof DocumentValidationError) reject(result);
          else accept(result);
        },
        () => {
          worker.removeAllListeners();
          releaseSlot();
          reject(new DocumentValidationError("invalid"));
        },
      );
    };
    const timer = setTimeout(() => finish(new DocumentValidationError("timeout")), WORKER_TIMEOUT_MS);
    worker.once("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "ok" in message &&
        message.ok === true &&
        "snapshot" in message &&
        message.snapshot instanceof Uint8Array &&
        message.snapshot.byteLength <= MAX_CONTENT_BYTES &&
        "projection" in message &&
        typeof message.projection === "object" &&
        message.projection !== null
      )
        finish({ snapshot: message.snapshot, projection: message.projection as ContentProjection });
      else finish(new DocumentValidationError("invalid"));
    });
    worker.once("error", () => finish(new DocumentValidationError("invalid")));
    worker.once("exit", () => finish(new DocumentValidationError("invalid")));
  });
}

export async function validateDocumentUpdate(base: Uint8Array, delta: Uint8Array): Promise<ValidationResult> {
  if (
    !(base instanceof Uint8Array) ||
    !(delta instanceof Uint8Array) ||
    base.byteLength > MAX_CONTENT_BYTES ||
    delta.byteLength === 0 ||
    delta.byteLength > MAX_UPDATE_BYTES
  )
    throw new DocumentValidationError("invalid");
  // Snapshot caller bytes before waiting; bounded queue also bounds retained bytes.
  if (activeWorkers >= MAX_ACTIVE_WORKERS && waiting.length >= MAX_WAITING)
    throw new DocumentValidationError("busy");
  const baseCopy = new Uint8Array(base);
  const deltaCopy = new Uint8Array(delta);
  await acquireSlot();
  return runWorker(baseCopy, deltaCopy);
}
