import "server-only";
import { crc32, deflateRawSync } from "node:zlib";
import { type Entry, fromBuffer, type ZipFile } from "yauzl";
import { INTERCHANGE_LIMITS } from "../model/contracts";
import { ArchivePaths } from "../model/paths";

export type ZipEntryInfo = {
  index: number;
  path: string;
  directory: boolean;
  size: number;
  compressedSize: number;
  crc: number;
};
export type ZipPart = {
  name: string;
  crc: number;
  size: number;
  compressedSize: number;
  method: number;
  offset: number;
  flags?: number;
};
export function storedZipHeader(name: string, offset: number): { bytes: Buffer; entry: ZipPart } {
  const filename = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x808, 6);
  header.writeUInt16LE(33, 12);
  header.writeUInt16LE(filename.length, 26);
  return {
    bytes: Buffer.concat([header, filename]),
    entry: { name, offset, crc: 0, size: 0, compressedSize: 0, method: 0, flags: 0x808 },
  };
}
export function storedZipEnd(crc: number, size: number): Buffer {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(0x08074b50);
  bytes.writeUInt32LE(crc, 4);
  bytes.writeUInt32LE(size, 8);
  bytes.writeUInt32LE(size, 12);
  return bytes;
}
export function zipEntry(
  name: string,
  data: Uint8Array,
  offset: number,
  compress = true,
): { bytes: Buffer; entry: ZipPart } {
  const filename = Buffer.from(name, "utf8");
  const candidate = compress ? deflateRawSync(data, { level: 6 }) : Buffer.from(data);
  const useCompression =
    compress &&
    candidate.length < data.length &&
    data.length <= Math.max(candidate.length, 1) * INTERCHANGE_LIMITS.ratio;
  const packed = useCompression ? candidate : Buffer.from(data);
  const method = useCompression ? 8 : 0;
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(filename.length, 26);
  return {
    bytes: Buffer.concat([header, filename, packed]),
    entry: { name, crc, size: data.length, compressedSize: packed.length, method, offset },
  };
}
export function zipDirectory(entries: readonly ZipPart[], offset: number): Buffer {
  if (entries.length > 65535) throw new Error("ZIP entry limit exceeded");
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const filename = Buffer.from(entry.name, "utf8");
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.flags ?? 0x800, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(33, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(filename.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    chunks.push(header, filename);
  }
  const directory = Buffer.concat(chunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([directory, end]);
}
function openZip(source: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    fromBuffer(
      source,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: false },
      (error, zip) => (error || !zip ? reject(new Error("Invalid ZIP archive")) : resolve(zip)),
    ),
  );
}
function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const entry = (value: Entry) => {
      cleanup();
      resolve(value);
    };
    const end = () => {
      cleanup();
      resolve(null);
    };
    const error = () => {
      cleanup();
      reject(new Error("Invalid ZIP archive"));
    };
    const cleanup = () => {
      zip.off("entry", entry);
      zip.off("end", end);
      zip.off("error", error);
    };
    zip.once("entry", entry);
    zip.once("end", end);
    zip.once("error", error);
    zip.readEntry();
  });
}
/** Backpressure from onChunk keeps only one four-MiB staging chunk in memory. */
export async function extractArchive(
  source: Buffer,
  callbacks: {
    completed: ReadonlySet<number>;
    onEntry(info: ZipEntryInfo): Promise<void>;
    onChunk(info: ZipEntryInfo, chunk: number, bytes: Uint8Array): Promise<void>;
    onComplete(info: ZipEntryInfo, chunks: number): Promise<void>;
  },
  deadline = Date.now() + INTERCHANGE_LIMITS.extractionMs,
): Promise<void> {
  if (!source.length || source.length > INTERCHANGE_LIMITS.sourceBytes)
    throw new Error("ZIP source exceeds budget");
  const zip = await openZip(source);
  const paths = new ArchivePaths();
  let total = 0;
  let index = 0;
  const check = () => {
    if (Date.now() > deadline) throw new Error("ZIP validation timed out");
  };
  try {
    if (zip.entryCount > INTERCHANGE_LIMITS.entries) throw new Error("Too many archive entries");
    while (true) {
      check();
      const entry = await nextEntry(zip);
      if (!entry) break;
      const directory = entry.fileName.endsWith("/");
      const path = paths.add(entry.fileName, directory);
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        entry.generalPurposeBitFlag & 0x41 ||
        ![0, 8].includes(entry.compressionMethod) ||
        (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) ||
        /\.zip$/i.test(path)
      )
        throw new Error("Unsupported archive entry");
      total += entry.uncompressedSize;
      if (
        !Number.isSafeInteger(total) ||
        total > INTERCHANGE_LIMITS.expandedBytes ||
        total > source.length * INTERCHANGE_LIMITS.ratio
      )
        throw new Error("Archive expansion exceeds budget");
      const info = {
        index: index++,
        path,
        directory,
        size: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        crc: entry.crc32,
      };
      await callbacks.onEntry(info);
      if (directory || callbacks.completed.has(info.index)) continue;
      const stream = await new Promise<import("node:stream").Readable>((resolve, reject) =>
        zip.openReadStream(entry, (error, value) =>
          error || !value ? reject(new Error("Invalid ZIP data")) : resolve(value),
        ),
      );
      let actual = 0;
      let crc = 0;
      let chunk = 0;
      let used = 0;
      let buffer = Buffer.alloc(INTERCHANGE_LIMITS.chunkBytes);
      try {
        for await (const data of stream) {
          check();
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
          actual += bytes.length;
          crc = crc32(bytes, crc);
          if (
            actual > info.size ||
            actual > INTERCHANGE_LIMITS.expandedBytes ||
            actual > Math.max(info.compressedSize, 1) * INTERCHANGE_LIMITS.ratio
          )
            throw new Error("Invalid archive expansion");
          if (
            actual === bytes.length &&
            bytes.length >= 4 &&
            bytes.readUInt32LE(0) === 0x04034b50 &&
            !/\.(docx|xlsx|pptx|odt|ods)$/i.test(path)
          )
            throw new Error("Nested archives are unsupported");
          for (let offset = 0; offset < bytes.length; ) {
            const length = Math.min(bytes.length - offset, buffer.length - used);
            bytes.copy(buffer, used, offset, offset + length);
            used += length;
            offset += length;
            if (used === buffer.length) {
              await callbacks.onChunk(info, chunk++, buffer);
              buffer = Buffer.alloc(INTERCHANGE_LIMITS.chunkBytes);
              used = 0;
            }
          }
        }
        if (actual !== info.size || crc !== info.crc) throw new Error("Archive integrity check failed");
        if (used) await callbacks.onChunk(info, chunk++, buffer.subarray(0, used));
        await callbacks.onComplete(info, chunk);
      } finally {
        stream.destroy();
      }
    }
  } finally {
    zip.close();
  }
}
