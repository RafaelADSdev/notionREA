import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { runTestSupabase, testStackStatus } from "./test-stack.mjs";

if (!process.env.npm_execpath) throw new Error("Execute por pnpm db:types ou pnpm db:types:check.");
const run = (args, input) =>
  spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    encoding: "utf8",
    windowsHide: true,
    input,
  });
testStackStatus();
const generated = runTestSupabase(["gen", "types", "typescript", "--local"]);
if (generated.status !== 0) throw new Error("Falha ao ler o schema isolado; execute pnpm test:env.");
const destination = "src/lib/supabase/database.types.ts";
const formatted = run(["exec", "biome", "format", "--stdin-file-path", destination], generated.stdout);
if (formatted.status !== 0) throw new Error("Falha ao formatar tipos gerados.");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const output = normalize(formatted.stdout);
if (process.argv.includes("--check")) {
  if (normalize(readFileSync(destination, "utf8")) !== output) {
    console.error("Os tipos diferem do banco isolado. Execute pnpm db:types e revise a migration.");
    process.exitCode = 1;
  } else console.info("Tipos gerados correspondem ao banco local.");
} else {
  writeFileSync(destination, output);
  console.info("Tipos do banco local atualizados.");
}
