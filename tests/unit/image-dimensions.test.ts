import { describe, expect, it } from "vitest";
import { verifyImageDimensions } from "../../src/features/files/image-dimensions";

const png = () =>
  Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8d8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
const gif = () =>
  Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
function jpeg(width = 320, height = 240) {
  return Uint8Array.from([
    255,
    216,
    255,
    224,
    0,
    4,
    0,
    0,
    255,
    192,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    217,
  ]);
}
function webp(kind: "VP8X" | "VP8L" | "VP8 ", width = 320, height = 240) {
  const bytes = new Uint8Array(kind === "VP8L" ? 26 : 30);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode(`WEBP${kind}`), 8);
  view.setUint32(16, kind === "VP8L" ? 5 : 10, true);
  if (kind === "VP8X") {
    for (let i = 0; i < 3; i++) {
      bytes[24 + i] = ((width - 1) >> (8 * i)) & 255;
      bytes[27 + i] = ((height - 1) >> (8 * i)) & 255;
    }
  } else if (kind === "VP8L") {
    bytes[20] = 47;
    view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  } else {
    bytes.set([0, 0, 0, 157, 1, 42], 20);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return bytes;
}
describe("bounded public image header dimensions", () => {
  const fixtures: [string, Uint8Array, number, number][] = [
    ["image/png", png(), 1, 1],
    ["image/gif", gif(), 1, 1],
    ["image/jpeg", jpeg(), 320, 240],
    ...(["VP8X", "VP8L", "VP8 "] as const).map((kind): [string, Uint8Array, number, number] => [
      "image/webp",
      webp(kind),
      320,
      240,
    ]),
  ];
  it.each(fixtures)("reads %s dimensions without decoding pixels", (type, bytes, width, height) => {
    expect(verifyImageDimensions(bytes, type)).toEqual({ width, height });
  });
  it("rejects decompression-sized canvases and zero/truncated/mismatched headers", () => {
    const huge = png();
    new DataView(huge.buffer).setUint32(16, 16385);
    const pixels = png();
    const view = new DataView(pixels.buffer);
    view.setUint32(16, 6000);
    view.setUint32(20, 6000);
    const zero = png();
    new DataView(zero.buffer).setUint32(16, 0);
    for (const bytes of [huge, pixels, zero, png().slice(0, 24)])
      expect(() => verifyImageDimensions(bytes, "image/png")).toThrow();
    expect(() => verifyImageDimensions(gif(), "image/png")).toThrow();
    expect(() => verifyImageDimensions(webp("VP8X", 8000, 8000), "image/webp")).toThrow();
    expect(() => verifyImageDimensions(jpeg(65535, 1), "image/jpeg")).toThrow();
  });
  it("walks JPEG segments safely and rejects RIFF length/header truncation", () => {
    const malformed = jpeg();
    malformed[4] = 255;
    malformed[5] = 255;
    expect(() => verifyImageDimensions(malformed, "image/jpeg")).toThrow();
    const malformedWebp = webp("VP8L");
    new DataView(malformedWebp.buffer).setUint32(16, 10000, true);
    expect(() => verifyImageDimensions(malformedWebp, "image/webp")).toThrow();
    expect(() => verifyImageDimensions(new Uint8Array([255, 216, 255, 192]), "image/jpeg")).toThrow();
  });
  it("rejects a GIF frame that hides larger dimensions behind a small logical canvas", () => {
    const bytes = gif();
    const descriptor = bytes.indexOf(44, 13);
    if (descriptor < 0) throw new Error("Expected GIF descriptor");
    new DataView(bytes.buffer).setUint16(descriptor + 5, 65535, true);
    expect(() => verifyImageDimensions(bytes, "image/gif")).toThrow();
  });
  it("rejects oversized WebP bitmap dimensions hidden behind a small VP8X canvas", () => {
    const bytes = new Uint8Array(44);
    bytes.set(webp("VP8X", 1, 1));
    bytes.set(webp("VP8L", 6000, 6000).subarray(12), 30);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    expect(() => verifyImageDimensions(bytes, "image/webp")).toThrow();
  });
});
