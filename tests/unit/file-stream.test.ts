// @vitest-environment node
import { describe, expect, it } from "vitest";
import { streamFile } from "../../src/features/files/stream";

describe("attachment response streaming", () => {
  it("preserves large opaque bytes in bounded pull chunks and allows cancellation", async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const blob = new Blob([bytes]);
    const reader = streamFile(blob).getReader();
    let offset = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      expect(chunk.value.length).toBeLessThanOrEqual(256 * 1024);
      expect(Buffer.from(chunk.value).equals(Buffer.from(bytes.subarray(offset, offset + chunk.value.length)))).toBe(true);
      offset += chunk.value.length;
    }
    expect(offset).toBe(bytes.length);
    const cancelled = streamFile(blob).getReader();
    await cancelled.read();
    await cancelled.cancel();
    expect((await cancelled.read()).done).toBe(true);
  });
});
