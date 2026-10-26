import { describe, expect, it } from "vitest";
import { coverUploadSchema, verifyImageBytes, fileDisposition } from "../../src/features/files/validation";

const pageId = "10000000-0000-4000-8000-000000000001";
describe("private cover upload boundaries", () => {
  it("accepts an allowlisted declaration and limits size without trusting file extensions", () => {
    expect(coverUploadSchema.parse({ pageId, name: " capa.png ", type: "image/png", size: 24 }).name).toBe(
      "capa.png",
    );
    for (const type of ["image/svg+xml", "text/html", "application/javascript"]) {
      expect(coverUploadSchema.safeParse({ pageId, name: "cover.png", type, size: 24 }).success).toBe(false);
    }
    for (const size of [0, -1, 25 * 1024 * 1024 + 1, 1.5]) {
      expect(
        coverUploadSchema.safeParse({ pageId, name: "cover.png", type: "image/png", size }).success,
      ).toBe(false);
    }
  });
  it("refuses header injection and path-bearing display names", () => {
    for (const name of ["../cover.png", "folder\\cover.png", "a\r\nX-Injected: true", "", "a".repeat(181)]) {
      expect(coverUploadSchema.safeParse({ pageId, name, type: "image/png", size: 24 }).success).toBe(false);
    }
  });
  it.each([
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255]],
    ["image/gif", Array.from(new TextEncoder().encode("GIF89a"))],
    ["image/webp", [82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80]],
  ] as const)("checks bytes and declaration together for %s", (type, prefix) => {
    const bytes = Uint8Array.from([...prefix, ...new Array<number>(24).fill(0)]);
    expect(verifyImageBytes(bytes, type, bytes.length)).toBe(type);
    expect(() => verifyImageBytes(bytes, "text/html", bytes.length)).toThrow();
    expect(() => verifyImageBytes(bytes, type, bytes.length + 1)).toThrow();
  });
  it("rejects executable bytes masquerading as images and empty objects", () => {
    const bytes = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    expect(() => verifyImageBytes(bytes, "image/png", bytes.length)).toThrow();
    expect(() => verifyImageBytes(new Uint8Array(), "image/png", 0)).toThrow();
  });
  it("encodes a Unicode display name without creating response headers", () => {
    expect(fileDisposition("capa verão.png")).toBe(
      "inline; filename=cover; filename*=UTF-8''capa%20ver%C3%A3o.png",
    );
    expect(fileDisposition('a";x.png')).not.toContain('"');
  });
});
