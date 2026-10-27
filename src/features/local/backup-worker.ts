import { decodeLocalBackup } from "./model";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  try {
    if (typeof event.data !== "string") throw new Error("Invalid input");
    const value = decodeLocalBackup(event.data);
    self.postMessage({ ok: true, value });
  } catch {
    self.postMessage({ ok: false });
  }
});
