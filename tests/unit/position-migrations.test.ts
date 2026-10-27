import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  POSITION_MIGRATION_PREFIX,
  validatePositionMigrations,
  validateRootContainers,
} from "../../src/features/editor/model/position-migrations";

const documents: Y.Doc[] = [];
const blockIds = new Set(["first", "second"]);

function document() {
  const result = new Y.Doc();
  documents.push(result);
  return result;
}

function migration() {
  return {
    version: 1,
    client: 42,
    clock: 7,
    seen: [
      [42, 7],
      [10, 20],
    ],
    transfers: [
      {
        source: { client: 10, clock: 5, length: 2 },
        target: { client: 42, clock: 3, type: { client: 42, clock: 1 } },
      },
      { source: { client: 10, clock: 1, length: 1, boundary: "start" }, target: null },
      {
        source: { client: 10, clock: 1, length: 1, boundary: "end" },
        target: { client: 42, clock: 1, type: null, boundary: "end", assoc: -1 },
      },
      {
        source: { client: 10, clock: 9, length: 1 },
        target: { client: 42, clock: 2, type: null, tname: "block-content:first", assoc: 0 },
      },
    ],
  };
}

function store(value: unknown = migration(), key = "42:7") {
  const doc = document();
  doc.getMap(`${POSITION_MIGRATION_PREFIX}first`).set(key, value);
  return doc;
}

afterEach(() => {
  for (const doc of documents.splice(0)) doc.destroy();
});

describe("public TipTap position migration metadata", () => {
  it("uses the exact stable-fragment migration namespace", () => {
    expect(POSITION_MIGRATION_PREFIX).toBe("__tiptap_position_migrations:root:block-content:");
  });

  it("accepts an absent store and an empty lazily created map without mutating the document", () => {
    const doc = document();
    validatePositionMigrations(doc, blockIds);
    doc.getMap(`${POSITION_MIGRATION_PREFIX}first`);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => validatePositionMigrations(doc, blockIds)).not.toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("accepts writer-compatible transfers, boundaries and state vectors after update roundtrip", () => {
    const doc = store();
    const restored = document();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    expect(() => validatePositionMigrations(restored, blockIds)).not.toThrow();
    expect(restored.getMap(`${POSITION_MIGRATION_PREFIX}first`).get("42:7")).toEqual(migration());
  });

  it("accepts the largest uint32 client and safe clock without range overflow", () => {
    const value = {
      version: 1,
      client: 4294967295,
      clock: Number.MAX_SAFE_INTEGER,
      seen: [[4294967295, Number.MAX_SAFE_INTEGER]],
      transfers: [{ source: { client: 0, clock: Number.MAX_SAFE_INTEGER - 1, length: 1 }, target: null }],
    };
    expect(() =>
      validatePositionMigrations(store(value, `4294967295:${Number.MAX_SAFE_INTEGER}`), blockIds),
    ).not.toThrow();
  });

  it.each([
    "__tiptap_position_migrations:root:unknown",
    "__tiptap_position_migrations:item:42:7",
    `${POSITION_MIGRATION_PREFIX}missing`,
    `${POSITION_MIGRATION_PREFIX}first:extra`,
    `${POSITION_MIGRATION_PREFIX}first<script>`,
  ])("rejects an unrecognized or noncanonical store root %s", (name) => {
    const doc = document();
    doc.getMap(name);
    expect(() => validatePositionMigrations(doc, blockIds)).toThrow();
  });

  it("rejects a known store root containing a different shared type", () => {
    const doc = document();
    doc.getArray(`${POSITION_MIGRATION_PREFIX}first`).push([migration()]);
    expect(() => validatePositionMigrations(doc, blockIds)).toThrow();
  });

  it("rejects list payloads in a store root received through a Yjs update", () => {
    const doc = document();
    doc.getArray(`${POSITION_MIGRATION_PREFIX}first`).push(["hidden arbitrary payload"]);
    const restored = document();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    expect(() => validatePositionMigrations(restored, blockIds)).toThrow();
  });

  it.each(["42", "42:7:1", "042:7", "42:07", "-1:7", "42:1.5", "<script>:7", "43:7"])(
    "rejects malformed or mismatched migration identity %s",
    (key) => expect(() => validatePositionMigrations(store(migration(), key), blockIds)).toThrow(),
  );

  it.each([
    null,
    "<script>alert(1)</script>",
    { ...migration(), version: 2 },
    { ...migration(), html: "<img onerror=alert(1)>" },
    { ...migration(), client: 4294967296 },
    { ...migration(), clock: Number.MAX_SAFE_INTEGER + 1 },
    { ...migration(), seen: [[42, -1]] },
    { ...migration(), seen: [[42, 7, 8]] },
    { ...migration(), seen: [[1.5, 7]] },
    { ...migration(), transfers: [{ source: { client: 1, clock: 1, length: 0 }, target: null }] },
    { ...migration(), transfers: [{ source: { client: 1, clock: 1, length: -1 }, target: null }] },
    {
      ...migration(),
      transfers: [{ source: { client: 1, clock: 1, length: 1, text: "hidden" }, target: null }],
    },
    {
      ...migration(),
      transfers: [{ source: { client: 1, clock: 1, length: 1, boundary: "middle" }, target: null }],
    },
    {
      ...migration(),
      transfers: [{ source: { client: 1, clock: Number.MAX_SAFE_INTEGER, length: 2 }, target: null }],
    },
    {
      ...migration(),
      transfers: [
        { source: { client: 1, clock: 1, length: 1 }, target: { client: 1, clock: 1, type: null, assoc: 1 } },
      ],
    },
    {
      ...migration(),
      transfers: [
        {
          source: { client: 1, clock: 1, length: 1 },
          target: { client: 1, clock: 1, type: { client: 1, clock: 1, html: "hidden" } },
        },
      ],
    },
    {
      ...migration(),
      transfers: [
        {
          source: { client: 1, clock: 1, length: 1 },
          target: { client: 1, clock: 1, type: null, tname: "block-content:second" },
        },
      ],
    },
    {
      ...migration(),
      transfers: [
        {
          source: { client: 1, clock: 1, length: 1 },
          target: { client: 1, clock: 1, type: null, tname: "<script>" },
        },
      ],
    },
    {
      ...migration(),
      transfers: [
        {
          source: { client: 1, clock: 1, length: 1 },
          target: { client: 1, clock: 1, type: null, style: "color:red" },
        },
      ],
    },
  ])("rejects unsupported or unsafe migration fields %#", (value) => {
    const doc = store(value);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => validatePositionMigrations(doc, blockIds)).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("rejects an oversized seen array", () => {
    expect(() =>
      validatePositionMigrations(
        store({ ...migration(), seen: Array.from({ length: 10001 }, () => [1, 1]) }),
        blockIds,
      ),
    ).toThrow();
  });

  it("rejects an oversized transfers array", () => {
    expect(() =>
      validatePositionMigrations(
        store({
          ...migration(),
          transfers: Array.from({ length: 10001 }, () => ({
            source: { client: 1, clock: 1, length: 1 },
            target: null,
          })),
        }),
        blockIds,
      ),
    ).toThrow();
  });

  it("bounds metadata work across multiple individually bounded roots", () => {
    const doc = document();
    for (const id of blockIds) {
      doc.getMap(`${POSITION_MIGRATION_PREFIX}${id}`).set("42:7", {
        version: 1,
        client: 42,
        clock: 7,
        seen: Array.from({ length: 6000 }, () => [1, 1]),
        transfers: [],
      });
    }
    expect(() => validatePositionMigrations(doc, blockIds)).toThrow();
  });

  it("bounds the work required to expand transfer ranges", () => {
    const value = {
      ...migration(),
      transfers: [{ source: { client: 1, clock: 1, length: 8 * 1024 * 1024 + 1 }, target: null }],
    };
    expect(() => validatePositionMigrations(store(value), blockIds)).toThrow();
  });

  it("accepts a source range as large as the canonical document budget without expanding it", () => {
    const value = {
      ...migration(),
      transfers: [{ source: { client: 1, clock: 1, length: 8 * 1024 * 1024 }, target: null }],
    };
    expect(() => validatePositionMigrations(store(value), blockIds)).not.toThrow();
  });

  it("bounds aggregate transfer ranges independently of array sizes", () => {
    const value = {
      ...migration(),
      transfers: Array.from({ length: 5 }, () => ({
        source: { client: 1, clock: 1, length: 8 * 1024 * 1024 },
        target: null,
      })),
    };
    expect(() => validatePositionMigrations(store(value), blockIds)).toThrow();
  });

  it("bounds active metadata bytes even when the record count remains within its budget", () => {
    const id = "a".repeat(80);
    const doc = document();
    doc.getMap(`${POSITION_MIGRATION_PREFIX}${id}`).set("42:7", {
      version: 1,
      client: 42,
      clock: 7,
      seen: [],
      transfers: Array.from({ length: 5000 }, () => ({
        source: { client: 1, clock: 1, length: 1, boundary: "start" },
        target: {
          client: 42,
          clock: 2,
          type: null,
          tname: `block-content:${id}`,
          boundary: "end",
          assoc: -1,
        },
      })),
    });
    expect(() => validatePositionMigrations(doc, new Set([id]))).toThrow();
  });

  it("bounds the number of migrations in a single store", () => {
    const doc = document();
    const map = doc.getMap(`${POSITION_MIGRATION_PREFIX}first`);
    doc.transact(() => {
      for (let clock = 0; clock < 10001; clock++) {
        map.set(`42:${clock}`, { version: 1, client: 42, clock, seen: [], transfers: [] });
      }
    });
    expect(() => validatePositionMigrations(doc, blockIds)).toThrow();
  });
});

describe("canonical root container validation", () => {
  it.each(["meta", "blocks", "placements", "removed", "attrs"])(
    "rejects a list payload hidden in the %s map through a Yjs update",
    (name) => {
      const doc = document();
      doc.getArray(name).push(["hidden arbitrary payload"]);
      const restored = document();
      Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
      expect(() => validateRootContainers(restored)).toThrow();
    },
  );

  it("rejects a map payload hidden in a text fragment through a Yjs update", () => {
    const doc = document();
    doc.getMap("block-content:first").set("html", "<script>hidden</script>");
    const restored = document();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    expect(() => validateRootContainers(restored)).toThrow();
  });

  it("accepts canonical map roots and text fragments before and after serialization", () => {
    const doc = document();
    for (const name of ["meta", "blocks", "placements", "removed", "attrs"])
      doc.getMap(name).set("key", "value");
    doc.getXmlFragment("block-content:first").insert(0, [new Y.XmlElement("paragraph")]);
    expect(() => validateRootContainers(doc)).not.toThrow();
    const restored = document();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateAsUpdate(restored);
    expect(() => validateRootContainers(restored)).not.toThrow();
    expect(Y.encodeStateAsUpdate(restored)).toEqual(before);
  });
});
