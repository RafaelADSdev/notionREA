import { describe, expect, it } from "vitest";
import { csvCell, initialCsvState, parseCsvChunk } from "../../src/features/interchange/model/csv";
import {
  ArchivePaths,
  archivePath,
  resolveArchiveLink,
  safeExportName,
} from "../../src/features/interchange/model/paths";

describe("archive paths and spreadsheet interchange", () => {
  it.each([
    "../escape.md",
    "/absolute",
    "C:/drive",
    "\\\\server\\share",
    "a/../x",
    "CON.txt",
    "a/NUL",
    "a./b",
    "a/%2e%2e/x",
    "a/%2fetc",
  ])("rejects unsafe ZIP path %s", (path) => {
    expect(() => archivePath(path)).toThrow();
  });
  it("rejects case/Unicode aliases and file-directory collisions without losing safe names", () => {
    const paths = new ArchivePaths();
    expect(paths.add("Café/notas.md", false)).toBe("Café/notas.md");
    expect(() => paths.add("Cafe\u0301/NOTAS.md", false)).toThrow();
    expect(() => paths.add("Café", false)).toThrow();
    expect(safeExportName("CON", "id-one", "md")).not.toBe(safeExportName("CON", "id-two", "md"));
    expect(resolveArchiveLink("p/a.md", "../b%20c.md#anchor")).toBe("b c.md");
    expect(resolveArchiveLink("a.md", "../../escape.md")).toBeNull();
    expect(resolveArchiveLink("a.md", "https://example.test/a.md")).toBeNull();
  });
  it("escapes delimiters/quotes/newlines and neutralizes formulas without mutating canonical values", () => {
    expect(csvCell('hello,"world"\n')).toEqual({ value: '"hello,""world""\n"', neutralized: false });
    for (const input of ["=SUM(A1)", " +cmd", "\t@formula", "-1"])
      expect(csvCell(input).neutralized).toBe(true);
    expect(csvCell("0").value).toBe('"0"');
    expect(csvCell("false").value).toBe('"false"');
  });
  it("resumes CSV across UTF-8 chunks, escaped quotes, quoted newlines and CRLF without duplicate rows", () => {
    const bytes = new TextEncoder().encode('Título,Texto\r\n"Café","a""b\nlinha"\r\nFim,0');
    let state = initialCsvState();
    const rows: string[][] = [];
    for (let offset = 0; offset < bytes.length; offset++) {
      const result = parseCsvChunk(bytes.slice(offset, offset + 1), state, 100, offset === bytes.length - 1);
      rows.push(...result.rows);
      state = result.state;
    }
    expect(rows).toEqual([
      ["Título", "Texto"],
      ["Café", 'a"b\nlinha'],
      ["Fim", "0"],
    ]);
    expect(() =>
      parseCsvChunk(new TextEncoder().encode('"unterminated'), initialCsvState(), 100, true),
    ).toThrow();
    expect(() =>
      parseCsvChunk(new TextEncoder().encode("x".repeat(32769)), initialCsvState(), 100, true),
    ).toThrow();
  });
});
