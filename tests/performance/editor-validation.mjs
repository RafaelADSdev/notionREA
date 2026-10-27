import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import * as Y from "yjs";

// This benchmark intentionally uses the existing production artifact. It never builds or replaces it.
const artifact = resolve(".editor-runtime", "validation-worker.mjs");
const contentLimit = 8 * 1024 * 1024;
const updateLimit = 256 * 1024;
const deadlineMs = 3000;
const blockCount = 5000;
const resourceLimits = { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 };
const sampleArgument = process.argv.find((argument) => argument.startsWith("--samples="));
const samples = sampleArgument ? Number(sampleArgument.slice("--samples=".length)) : 5;
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error("Use --samples=<positive integer>");
const artifactDigest = async () =>
  createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex");
const digestBefore = await artifactDigest();
const artifactMetadata = await stat(artifact);

function details(index, characters) {
  return {
    id: `perf-block-${String(index).padStart(5, "0")}`,
    position: `${index.toString(36).padStart(6, "0")}U`,
    text: `${String(index).padStart(5, "0")}:`.padEnd(characters, "x"),
  };
}
function expectedProjection(characters) {
  const rows = Array.from({ length: blockCount }, (_, index) => details(index, characters));
  return {
    schemaVersion: 1,
    text: rows.map((row) => row.text).join("\n"),
    references: [],
    files: [],
    blocks: rows.map((row) => ({
      id: row.id,
      type: "paragraph",
      parentId: null,
      position: row.position,
      attributes: {},
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: row.text }] }] },
    })),
  };
}
// ASCII payload avoids ambiguity from escaping; the worker's actual projection bytes are checked too.
const baselineCharacters = 16;
const baselineProjectionBytes = Buffer.byteLength(JSON.stringify(expectedProjection(baselineCharacters)));
const targetProjectionBytes = contentLimit - 64 * 1024;
const characters =
  baselineCharacters + Math.floor((targetProjectionBytes - baselineProjectionBytes) / (2 * blockCount));
if (characters < baselineCharacters) throw new Error("Invalid synthetic fixture calibration");

function makeFixture() {
  const document = new Y.Doc();
  const initialVector = Y.encodeStateVector(document);
  document.getMap("meta").set("schemaVersion", 1);
  const blocks = document.getMap("blocks");
  const placements = document.getMap("placements");
  const identities = document.getMap("identities");
  const batches = [];
  let previousVector = initialVector;
  // Leave substantial room for identifiers, CRDT clocks and root names in every transport update.
  const batchSize = Math.max(1, Math.floor((updateLimit - 8192) / (characters + 512)));
  for (let first = 0; first < blockCount; first += batchSize) {
    const end = Math.min(blockCount, first + batchSize);
    document.transact(() => {
      for (let index = first; index < end; index++) {
        const row = details(index, characters);
        identities.set(row.id, true);
        blocks.set(row.id, "paragraph");
        placements.set(row.id, { parentId: null, position: row.position });
        const paragraph = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        document.getXmlFragment(`block-content:${row.id}`).insert(0, [paragraph]);
        text.insert(0, row.text);
      }
    }, "synthetic-fixture");
    const delta = Y.encodeStateAsUpdate(document, previousVector);
    if (delta.byteLength > updateLimit) throw new Error("Fixture builder exceeded the update budget");
    batches.push({ delta, blocks: end });
    previousVector = Y.encodeStateVector(document);
  }
  const base = Y.encodeStateAsUpdate(document);
  const vector = Y.encodeStateVector(document);
  const last = document.getXmlFragment(`block-content:${details(blockCount - 1, characters).id}`).get(0);
  const text = last instanceof Y.XmlElement ? last.get(0) : undefined;
  if (!(text instanceof Y.XmlText)) throw new Error("Invalid synthetic last paragraph");
  text.insert(text.length, "!");
  const delta = Y.encodeStateAsUpdate(document, vector);
  const expected = expectedProjection(characters);
  expected.text += "!";
  const final = expected.blocks.at(-1)?.content.content[0]?.content[0];
  if (!final) throw new Error("Missing expected final paragraph");
  final.text += "!";
  const finalProjectionBytes = Buffer.byteLength(JSON.stringify(expected));
  const finalSnapshotBytes = Y.encodeStateAsUpdate(document).byteLength;
  document.destroy();
  if (
    finalProjectionBytes > contentLimit ||
    finalSnapshotBytes > contentLimit ||
    delta.byteLength > updateLimit
  )
    throw new Error("Fixture does not fit every production byte budget");
  return { base, delta, batches, expected, finalProjectionBytes, finalSnapshotBytes };
}

async function runWorker(base, delta, expectedBlocks, expectedText) {
  const baseCopy = new Uint8Array(base);
  const deltaCopy = new Uint8Array(delta);
  const start = performance.now();
  return new Promise((accept) => {
    let finished = false;
    let pendingSample = false;
    const heap = { observations: 0, observedUsedBytes: 0, observedTotalBytes: 0, heapSizeLimitBytes: 0 };
    const worker = new Worker(artifact, {
      workerData: { base: baseCopy, delta: deltaCopy },
      transferList: [baseCopy.buffer, deltaCopy.buffer],
      env: {},
      execArgv: [],
      resourceLimits,
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const sampleHeap = async () => {
      if (finished || pendingSample || typeof worker.getHeapStatistics !== "function") return;
      pendingSample = true;
      try {
        const value = await worker.getHeapStatistics();
        heap.observations++;
        heap.observedUsedBytes = Math.max(heap.observedUsedBytes, value.used_heap_size);
        heap.observedTotalBytes = Math.max(heap.observedTotalBytes, value.total_heap_size);
        heap.heapSizeLimitBytes = value.heap_size_limit;
      } catch {
        /* A completed worker may close before a sample is delivered. */
      } finally {
        pendingSample = false;
      }
    };
    const interval = setInterval(() => {
      void sampleHeap();
    }, 50);
    worker.once("online", () => {
      void sampleHeap();
    });
    const finish = async (status, result, errorCode) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(interval);
      const elapsedMs = performance.now() - start;
      worker.removeAllListeners();
      worker.on("error", () => undefined);
      await worker.terminate();
      const measurement = {
        status: status === "accepted" && elapsedMs > deadlineMs ? "deadline_exceeded" : status,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        heap,
        ...(errorCode ? { errorCode } : {}),
      };
      if (status === "accepted") {
        const projectionBytes = Buffer.byteLength(JSON.stringify(result.projection));
        const correct =
          result.projection.blocks.length === expectedBlocks &&
          (expectedText === undefined || result.projection.text === expectedText);
        measurement.status =
          correct && projectionBytes <= contentLimit && result.snapshot.byteLength <= contentLimit
            ? measurement.status
            : "incorrect_result";
        accept({
          measurement: { ...measurement, snapshotBytes: result.snapshot.byteLength, projectionBytes },
          snapshot: result.snapshot,
        });
      } else accept({ measurement, snapshot: undefined });
    };
    const timer = setTimeout(() => {
      void finish("timeout");
    }, deadlineMs);
    worker.once("message", (message) => {
      if (
        message?.ok === true &&
        message.snapshot instanceof Uint8Array &&
        Array.isArray(message.projection?.blocks)
      )
        void finish("accepted", message);
      else void finish("rejected");
    });
    worker.once("error", (error) => {
      void finish(
        error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "heap_limit" : "worker_error",
        undefined,
        error.code ?? "worker_error",
      );
    });
    worker.once("exit", (code) => {
      void finish("early_exit", undefined, String(code));
    });
  });
}

function summarize(name, results) {
  const times = results.map((result) => result.elapsedMs).sort((first, second) => first - second);
  return {
    name,
    samples: results.length,
    accepted: results.filter((result) => result.status === "accepted").length,
    medianMs: times[Math.floor(times.length / 2)] ?? null,
    p95Ms: times[Math.ceil(times.length * 0.95) - 1] ?? null,
    maxMs: times.at(-1) ?? null,
    observedHeapUsedBytes: Math.max(0, ...results.map((result) => result.heap.observedUsedBytes)),
    results,
  };
}

const fixture = makeFixture();
const baseResults = [];
for (let index = 0; index < samples; index++) {
  const result = await runWorker(fixture.base, fixture.delta, blockCount, fixture.expected.text);
  baseResults.push(result.measurement);
}
const concurrent = await Promise.all(
  [1, 2].map(() => runWorker(fixture.base, fixture.delta, blockCount, fixture.expected.text)),
);
const batchResults = [];
let acceptedBase = new Uint8Array();
for (const batch of fixture.batches) {
  const expectedPrefix = fixture.expected.text.slice(0, batch.blocks * (characters + 1) - 1);
  const result = await runWorker(acceptedBase, batch.delta, batch.blocks, expectedPrefix);
  batchResults.push({
    ...result.measurement,
    requestedBlocks: batch.blocks,
    deltaBytes: batch.delta.byteLength,
  });
  if (result.measurement.status !== "accepted" || !result.snapshot) break;
  acceptedBase = result.snapshot;
}
const digestAfter = await artifactDigest();
const scenarios = [
  summarize("5000-block base + causal tiny delta", baseResults),
  summarize(
    "two simultaneous 5000-block workers",
    concurrent.map((result) => result.measurement),
  ),
  summarize("causally ordered <=256KiB ingestion batches", batchResults),
];
const passed =
  digestBefore === digestAfter &&
  scenarios.every((scenario) => scenario.accepted === scenario.samples) &&
  batchResults.length === fixture.batches.length;
console.log(
  JSON.stringify(
    {
      passed,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        ramBytes: totalmem(),
      },
      artifact: {
        path: ".editor-runtime/validation-worker.mjs",
        sha256: digestBefore,
        modifiedUtc: artifactMetadata.mtime.toISOString(),
        unchangedDuringRun: digestBefore === digestAfter,
      },
      budgets: {
        deadlineMs,
        resourceLimits,
        maxSnapshotBytes: contentLimit,
        maxProjectionBytes: contentLimit,
        maxDeltaBytes: updateLimit,
      },
      fixture: {
        blocks: blockCount,
        charactersPerBlock: characters,
        baseBytes: fixture.base.byteLength,
        deltaBytes: fixture.delta.byteLength,
        finalSnapshotBytes: fixture.finalSnapshotBytes,
        finalProjectionBytes: fixture.finalProjectionBytes,
        batches: fixture.batches.length,
        maxBatchBytes: Math.max(...fixture.batches.map((batch) => batch.delta.byteLength)),
      },
      heapObservation:
        "Opportunistic public Worker.getHeapStatistics samples, not exact peak; worker old/young/stack limits are enforced. ArrayBuffers have separate byte caps.",
      timing:
        "Includes fresh worker startup, IPC and heap sampling. Concurrent E2E/app work may contend for CPU; no database or browser performance is measured.",
      scenarios,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;
