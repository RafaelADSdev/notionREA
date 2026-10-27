import { verifyImageBytes } from "./validation";

export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_PIXELS = 30000000;
const invalid = () => new Error("A imagem tem dimensões inválidas ou excede 30 megapixels.");
// Header fields, not pixel decoding: PNG IHDR https://www.w3.org/TR/png/;
// GIF logical screen https://www.w3.org/Graphics/GIF/spec-gif89a.txt;
// JPEG SOF (ITU-T T.81 B.2.2); WebP https://www.rfc-editor.org/rfc/rfc9649.html.
export function verifyImageDimensions(bytes: Uint8Array, type: string): { width: number; height: number } {
  verifyImageBytes(bytes, type, bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  const size = (width: number, height: number) => {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS
    )
      throw invalid();
    return { width, height };
  };
  if (type === "image/png") {
    if (bytes.length < 33 || view.getUint32(8) !== 13 || ascii(12, 4) !== "IHDR") throw invalid();
    return size(view.getUint32(16), view.getUint32(20));
  }
  if (type === "image/gif") {
    if (bytes.length < 13) throw invalid();
    const canvas = size(view.getUint16(6, true), view.getUint16(8, true));
    let offset = 13;
    const colors = (packed: number) => (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0);
    offset += colors(bytes[10] ?? 0);
    const skipBlocks = () => {
      while (offset < bytes.length) {
        const length = bytes[offset++];
        if (length === 0) return;
        if (length === undefined || offset + length > bytes.length) throw invalid();
        offset += length;
      }
      throw invalid();
    };
    while (offset < bytes.length) {
      const marker = bytes[offset++];
      if (marker === 59) return canvas;
      if (marker === 33) {
        offset++;
        skipBlocks();
        continue;
      }
      if (marker !== 44 || offset + 9 > bytes.length) throw invalid();
      const x = view.getUint16(offset, true),
        y = view.getUint16(offset + 2, true),
        frame = size(view.getUint16(offset + 4, true), view.getUint16(offset + 6, true));
      if (x + frame.width > canvas.width || y + frame.height > canvas.height) throw invalid();
      offset += 9 + colors(bytes[offset + 8] ?? 0);
      if (offset >= bytes.length) throw invalid();
      offset++;
      skipBlocks();
    }
    throw invalid();
  }
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 217 || marker === 218) throw invalid();
      if (marker === 1 || (marker >= 208 && marker <= 216)) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw invalid();
        return size(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
    throw invalid();
  }
  if (type === "image/webp") {
    if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) throw invalid();
    const uint24 = (offset: number) =>
      view.getUint8(offset) + (view.getUint8(offset + 1) << 8) + (view.getUint8(offset + 2) << 16);
    const bitmap = (kind: string, start: number, length: number) => {
      if (kind === "VP8L") {
        if (length < 5 || bytes[start] !== 47) throw invalid();
        const packed = view.getUint32(start + 1, true);
        if (packed >>> 29) throw invalid();
        return size((packed & 16383) + 1, ((packed >>> 14) & 16383) + 1);
      }
      if (kind === "VP8 ") {
        if (length < 10 || (bytes[start] ?? 1) & 1 || ascii(start + 3, 3) !== String.fromCharCode(157, 1, 42))
          throw invalid();
        return size(view.getUint16(start + 6, true) & 16383, view.getUint16(start + 8, true) & 16383);
      }
      return null;
    };
    let canvas: { width: number; height: number } | null = null,
      image: { width: number; height: number } | null = null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = ascii(offset, 4),
        length = view.getUint32(offset + 4, true),
        start = offset + 8;
      if (start + length + (length % 2) > bytes.length) throw invalid();
      if (kind === "VP8X") {
        if (length !== 10 || canvas) throw invalid();
        canvas = size(uint24(start + 4) + 1, uint24(start + 7) + 1);
      } else if (kind === "ANMF") {
        if (!canvas || length < 16) throw invalid();
        const frame = size(uint24(start + 6) + 1, uint24(start + 9) + 1);
        if (
          uint24(start) * 2 + frame.width > canvas.width ||
          uint24(start + 3) * 2 + frame.height > canvas.height
        )
          throw invalid();
        let nested = start + 16;
        while (nested + 8 <= start + length) {
          const childLength = view.getUint32(nested + 4, true),
            childStart = nested + 8;
          if (childStart + childLength + (childLength % 2) > start + length) throw invalid();
          const child = bitmap(ascii(nested, 4), childStart, childLength);
          if (child && (child.width > frame.width || child.height > frame.height)) throw invalid();
          nested = childStart + childLength + (childLength % 2);
        }
      } else {
        const dimensions = bitmap(kind, start, length);
        if (dimensions) {
          if (canvas && (dimensions.width > canvas.width || dimensions.height > canvas.height))
            throw invalid();
          image = dimensions;
        }
      }
      offset = start + length + (length % 2);
    }
    if (canvas) return canvas;
    if (image) return image;
  }
  throw invalid();
}
