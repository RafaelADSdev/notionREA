import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { csvCell, restoreCsvCell } from "../../src/features/interchange/model/csv";
import { mappedCsvValue } from "../../src/features/interchange/model/mapping";
import { exportMarkdown, importMarkdown } from "../../src/features/interchange/model/markdown";
import { extractArchive, zipDirectory, zipEntry } from "../../src/features/interchange/server/zip";

function archive(entries: { name: string; text: string }[]) {
  let offset = 0;
  const parts = entries.map(({ name, text }) => {
    const part = zipEntry(name, Buffer.from(text), offset, false);
    offset += part.bytes.length;
    return part;
  });
  return Buffer.concat([
    ...parts.map((part) => part.bytes),
    zipDirectory(
      parts.map((part) => part.entry),
      offset,
    ),
  ]);
}
async function extract(bytes: Buffer) {
  const values = new Map<string, string>();
  await extractArchive(bytes, {
    completed: new Set(),
    async onEntry() {},
    async onChunk(info, _index, chunk) {
      values.set(info.path, (values.get(info.path) ?? "") + Buffer.from(chunk).toString());
    },
    async onComplete() {},
  });
  return values;
}
describe("bounded interchange pipeline", () => {
  it("extracts real ZIP bytes with CRC verification and rejects CRC, traversal, aliases and encrypted entries", async () => {
    const bytes = archive([{ name: "Café.md", text: "# Café" }]);
    expect((await extract(bytes)).get("Café.md")).toBe("# Café");
    const corrupt = Buffer.from(bytes);
    corrupt[30 + Buffer.byteLength("Café.md")] = 0;
    await expect(extract(corrupt)).rejects.toThrow();
    for (const entries of [
      [{ name: "../escape", text: "x" }],
      [
        { name: "a.md", text: "a" },
        { name: "A.md", text: "b" },
      ],
    ])
      await expect(extract(archive(entries))).rejects.toThrow();
    const encrypted = Buffer.from(bytes);
    const directory = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(0x801, directory + 8);
    await expect(extract(encrypted)).rejects.toThrow();
  });
  it("rejects symlinks, nested archives and elapsed extraction deadlines", async () => {
    const bytes = archive([{ name: "link", text: "target" }]);
    const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE((0xa000 << 16) >>> 0, directory + 38);
    await expect(extract(bytes)).rejects.toThrow();
    await expect(extract(archive([{ name: "inner.zip", text: "bytes" }]))).rejects.toThrow();
    await expect(
      extractArchive(
        archive([{ name: "ok.md", text: "x" }]),
        { completed: new Set(), async onEntry() {}, async onChunk() {}, async onComplete() {} },
        Date.now() - 1,
      ),
    ).rejects.toThrow(/timed out/);
  });
  it("imports HTML as literal text and restores representable rich text and callout/toggle conventions with fresh identities", () => {
    const imported = importMarkdown(
      "> [Bloco:callout] **Nota**\n>\n> Conteúdo\n\n<script>alert(1)</script>\n\n- [x] Feito",
      "Page.md",
    );
    expect(imported.projection.blocks[0]?.type).toBe("callout");
    expect(imported.projection.text).toContain("<script>alert(1)</script>");
    expect(imported.warnings.some((w) => w.code === "html-preserved-as-text")).toBe(true);
    const exported = exportMarkdown(imported.projection, { pages: new Map(), files: new Map() });
    const reloaded = importMarkdown(exported.text, "Page.md");
    expect(reloaded.projection.blocks[0]?.type).toBe("callout");
    expect(reloaded.projection.blocks[0]?.id).not.toBe(imported.projection.blocks[0]?.id);
    expect(reloaded.projection.blocks.some((b) => b.type === "task" && b.attributes.checked)).toBe(true);
  });
  it("preserves literal fragment characters in relative exported filenames", () => {
    const target = "a1000000-0000-4000-8000-000000000001";
    const source = importMarkdown("[Alvo](target.md)", "source.md", new Map([["target.md", target]]));
    const exported = exportMarkdown(source.projection, {
      pages: new Map([[target, { href: "Target#1.md", label: "Alvo" }]]),
      files: new Map(),
    });
    const restored = importMarkdown(exported.text, "source.md", new Map([["Target#1.md", target]]));
    expect(restored.projection.references).toEqual([target]);
  });
  it("maps exact decimals, false, null and system values conservatively and reverses only its own formula escaping", () => {
    const id = "a1000000-0000-4000-8000-000000000001";
    const column = { index: 0, name: "Value", config: {}, type: "number" as const };
    expect(mappedCsvValue(column, "0", id)).toBe("0");
    expect(mappedCsvValue(column, "", id)).toBeNull();
    expect(mappedCsvValue({ ...column, type: "checkbox" }, "false", id)).toBe(false);
    expect(mappedCsvValue({ ...column, type: "createdTime" }, "2024-01-01", id)).toBe("2024-01-01");
    expect(() => mappedCsvValue({ ...column, type: "person" }, "someone@example.test", id)).toThrow();
    for (const text of ["=SUM(A1)", "'literal", "ordinary", " -1"]) {
      const escaped = csvCell(text);
      const value = escaped.value.slice(1, -1).replaceAll('""', '"');
      expect(restoreCsvCell(value, true)).toBe(text);
      expect(restoreCsvCell(value, false)).toBe(value);
    }
  });
});
