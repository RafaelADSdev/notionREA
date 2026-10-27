// @vitest-environment node
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { initializeContentDocument } from "../../src/features/editor/model/content-schema";
import { StablePage } from "../../src/features/editor/model/stable-page";
import {
  DocumentValidationError,
  validateDocumentUpdate,
} from "../../src/features/editor/server/validate-update";

const documents: Y.Doc[] = [];
const pages: StablePage[] = [];

function document(update?: Uint8Array) {
  const value = new Y.Doc();
  documents.push(value);
  if (update) Y.applyUpdate(value, update);
  else initializeContentDocument(value);
  return value;
}

function content(value: Y.Doc) {
  const page = new StablePage(value, "local");
  pages.push(page);
  page.createBlock({ id: "subject", type: "paragraph", parentId: null, position: "m" });
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  page.fragment("subject").insert(0, [paragraph]);
  text.insert(0, "Original");
  return text;
}

beforeAll(async () => {
  await promisify(execFile)(process.execPath, ["scripts/editor-runtime.mjs"]);
});

afterEach(() => {
  for (const page of pages.splice(0)) page.destroy();
  for (const value of documents.splice(0)) value.destroy();
});

describe("bounded document validation worker", () => {
  it("merges concurrent text, keeps caller buffers and accepts an idempotent replay", async () => {
    const initial = document();
    content(initial);
    const base = Y.encodeStateAsUpdate(initial);
    const first = document(base);
    const second = document(base);
    const state = Y.encodeStateVector(initial);
    const firstText = (first.getXmlFragment("block-content:subject").get(0) as Y.XmlElement).get(
      0,
    ) as Y.XmlText;
    const secondText = (second.getXmlFragment("block-content:subject").get(0) as Y.XmlElement).get(
      0,
    ) as Y.XmlText;
    firstText.insert(firstText.length, " Alice");
    secondText.insert(secondText.length, " Bob");
    const delta = Y.encodeStateAsUpdate(first, state);
    const accepted = await validateDocumentUpdate(base, delta);
    const merged = await validateDocumentUpdate(accepted.snapshot, Y.encodeStateAsUpdate(second, state));
    expect(merged.projection.text).toContain("Alice");
    expect(merged.projection.text).toContain("Bob");
    expect(base.byteLength).toBeGreaterThan(0);
    expect(delta.byteLength).toBeGreaterThan(0);
    expect((await validateDocumentUpdate(merged.snapshot, delta)).projection).toEqual(merged.projection);
  });

  it("requires explicit supported metadata for an empty base", async () => {
    const valid = document();
    expect(
      (await validateDocumentUpdate(new Uint8Array(), Y.encodeStateAsUpdate(valid))).projection.schemaVersion,
    ).toBe(1);
    const unknown = document();
    unknown.getMap("meta").set("schemaVersion", 99);
    await expect(
      validateDocumentUpdate(new Uint8Array(), Y.encodeStateAsUpdate(unknown)),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(validateDocumentUpdate(new Uint8Array(), new Uint8Array([0, 0]))).rejects.toMatchObject({
      kind: "invalid",
    });
  });

  it("rejects unsafe rich text and unknown attributes without returning their content", async () => {
    const value = document();
    const text = content(value);
    text.format(0, text.length, { link: { href: "javascript:private-payload" } });
    await expect(
      validateDocumentUpdate(new Uint8Array(), Y.encodeStateAsUpdate(value)),
    ).rejects.toMatchObject({ kind: "invalid", message: "Invalid document update" });
    text.format(0, text.length, { link: null });
    value.getMap("attrs").set("subject", new Y.Map([["style", "private-payload"]]));
    await expect(
      validateDocumentUpdate(new Uint8Array(), Y.encodeStateAsUpdate(value)),
    ).rejects.toBeInstanceOf(DocumentValidationError);
  });

  it("rejects an update whose causal predecessor is missing", async () => {
    const value = document();
    const base = Y.encodeStateAsUpdate(value);
    content(value);
    const missing = Y.encodeStateVector(value);
    value.getMap("meta").set("schemaVersion", 1);
    const future = Y.encodeStateAsUpdate(value, missing);
    await expect(validateDocumentUpdate(base, future)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects a pending delete set rather than accepting a hidden future deletion", async () => {
    const value = document();
    const base = Y.encodeStateAsUpdate(value);
    const text = content(value);
    const state = Y.encodeStateVector(value);
    text.delete(0, 1);
    await expect(validateDocumentUpdate(base, Y.encodeStateAsUpdate(value, state))).rejects.toMatchObject({
      kind: "invalid",
    });
  });

  it("bounds malformed input bytes before starting a decoder", async () => {
    for (const [base, delta] of [
      [new Uint8Array(8 * 1024 * 1024 + 1), new Uint8Array([255])],
      [new Uint8Array(), new Uint8Array(256 * 1024 + 1)],
      [new Uint8Array(), new Uint8Array()],
      [new Uint8Array(), new Uint8Array([255])],
    ] as const)
      await expect(validateDocumentUpdate(base, delta)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("bounds the derived projection independently from its smaller canonical snapshot", async () => {
    const value = document();
    const text = content(value);
    text.insert(text.length, "x".repeat(4 * 1024 * 1024));
    const base = Y.encodeStateAsUpdate(value);
    expect(base.byteLength).toBeLessThan(8 * 1024 * 1024);
    await expect(validateDocumentUpdate(base, new Uint8Array([0, 0]))).rejects.toMatchObject({
      kind: "invalid",
    });
  });
});

describe("validation worker lifecycle and admission control", () => {
  afterEach(() => {
    vi.doUnmock("node:worker_threads");
    vi.useRealTimers();
    vi.resetModules();
  });

  async function controlledWorkers() {
    const workers: (EventEmitter & { terminate: ReturnType<typeof vi.fn> })[] = [];
    const options: unknown[] = [];
    vi.doMock("node:worker_threads", () => ({
      Worker: class extends EventEmitter {
        terminate = vi.fn(async () => 0);
        constructor(_path: string, configuration: unknown) {
          super();
          workers.push(this);
          options.push(configuration);
        }
      },
    }));
    vi.resetModules();
    const validator = await import("../../src/features/editor/server/validate-update");
    return { ...validator, workers, options };
  }

  it("allows two workers and eight waiting requests, rejects overflow and drains after deadlines", async () => {
    vi.useFakeTimers();
    const { validateDocumentUpdate: validate, workers, options } = await controlledWorkers();
    const results = Array.from({ length: 10 }, () =>
      validate(new Uint8Array(), new Uint8Array([0, 0])).catch((error: unknown) => error),
    );
    await expect(validate(new Uint8Array(), new Uint8Array([0, 0]))).rejects.toMatchObject({ kind: "busy" });
    expect(workers).toHaveLength(2);
    expect(options[0]).toMatchObject({
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 4 },
    });
    for (let batch = 0; batch < 5; batch += 1) {
      await vi.advanceTimersByTimeAsync(3000);
      expect(workers).toHaveLength(Math.min((batch + 2) * 2, 10));
    }
    for (const result of await Promise.all(results)) expect(result).toMatchObject({ kind: "timeout" });
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
    const available = validate(new Uint8Array(), new Uint8Array([0, 0])).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await available).toMatchObject({ kind: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["error", "exit", "invalid-message"])(
    "terminates on %s and clears its deadline",
    async (failure) => {
      vi.useFakeTimers();
      const { validateDocumentUpdate: validate, workers } = await controlledWorkers();
      const outcome = validate(new Uint8Array(), new Uint8Array([0, 0])).catch((error: unknown) => error);
      await Promise.resolve();
      const worker = workers[0];
      if (!worker) throw new Error("Expected a worker");
      if (failure === "error") worker.emit("error", new Error("private-content"));
      else if (failure === "exit") worker.emit("exit", 1);
      else worker.emit("message", { ok: true, snapshot: "invalid" });
      expect(await outcome).toMatchObject({ kind: "invalid", message: "Invalid document update" });
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(worker.eventNames()).toEqual([]);
    },
  );

  it("rejects oversized input without constructing a worker", async () => {
    const { validateDocumentUpdate: validate, workers } = await controlledWorkers();
    await expect(validate(new Uint8Array(8 * 1024 * 1024 + 1), new Uint8Array([0, 0]))).rejects.toMatchObject(
      { kind: "invalid" },
    );
    await expect(validate(new Uint8Array(), new Uint8Array(256 * 1024 + 1))).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(workers).toEqual([]);
  });

  it("releases admission slots when a worker cannot be created", async () => {
    vi.doMock("node:worker_threads", () => ({
      Worker: class {
        constructor() {
          throw new Error("private-runtime-path");
        }
      },
    }));
    vi.resetModules();
    const { validateDocumentUpdate: validate } = await import(
      "../../src/features/editor/server/validate-update"
    );
    for (let attempt = 0; attempt < 11; attempt += 1)
      await expect(validate(new Uint8Array(), new Uint8Array([0, 0]))).rejects.toMatchObject({
        kind: "invalid",
        message: "Invalid document update",
      });
  });
});
