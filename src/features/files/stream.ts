/** Keep downloads streamed on Vercel, including attachments above its buffered response limit. */
export function streamFile(blob: Blob): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= blob.size) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 256 * 1024, blob.size);
      const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
      offset = end;
      controller.enqueue(bytes);
    },
  });
}
