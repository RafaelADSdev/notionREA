import "server-only";

/** Bound idle clients locally as well as in the production function runtime. */
export function boundedInterchangeStream(
  load: () => Promise<Uint8Array | null>,
  release: () => void,
): ReadableStream<Uint8Array> {
  let closed = false;
  let loading = false;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const releaseSettled = () => {
    if (!closed || loading || released) return;
    released = true;
    release();
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    // Closing the response does not cancel its in-flight RPC/Storage promise.
    // Keep admission occupied until that work settles, including late errors.
    releaseSettled();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        if (closed) return;
        finish();
        controller.error(new Error("Export download unavailable"));
      }, 60000);
    },
    async pull(controller) {
      if (closed) return;
      loading = true;
      try {
        const bytes = await load();
        if (closed) return;
        if (bytes === null) {
          finish();
          controller.close();
        } else controller.enqueue(bytes);
      } catch {
        if (closed) return;
        finish();
        controller.error(new Error("Export download unavailable"));
      } finally {
        loading = false;
        releaseSettled();
      }
    },
    cancel() {
      finish();
    },
  });
}
