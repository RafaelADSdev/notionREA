import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const options = {
  entryPoints: ["src/features/editor/server/validation-worker.ts"],
  outfile: ".editor-runtime/validation-worker.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  legalComments: "eof",
  sourcemap: false,
  metafile: true,
  logLevel: "silent",
};

export async function buildEditorRuntime() {
  const result = await build(options);
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  for (const output of Object.values(result.metafile.outputs))
    for (const dependency of output.imports)
      if (dependency.external && !builtins.has(dependency.path))
        throw new Error("Editor worker has an unbundled dependency");
}

export async function watchEditorRuntime() {
  await buildEditorRuntime();
  const runtime = await context(options);
  await runtime.watch();
  return runtime;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--watch")) {
    await watchEditorRuntime();
  } else await buildEditorRuntime();
}
