import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { watchEditorRuntime } from "./editor-runtime.mjs";

const require = createRequire(import.meta.url);
const runtime = await watchEditorRuntime();
const next = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  next.kill();
  await runtime.dispose();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
next.once("error", async () => {
  await close();
  process.exitCode = 1;
});
next.once("exit", async (code) => {
  await close();
  process.exitCode = code ?? 1;
});
