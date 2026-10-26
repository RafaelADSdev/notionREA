import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const destination = resolve(".env.local");
if (existsSync(destination)) {
  throw new Error(".env.local já existe; preserve seus valores e edite manualmente se necessário.");
}
if (!process.env.npm_execpath) throw new Error("Execute por pnpm local:env.");
const result = spawnSync(process.execPath, [process.env.npm_execpath, "supabase", "status", "-o", "json"], {
  encoding: "utf8",
  cwd: process.cwd(),
  windowsHide: true,
});
if (result.status !== 0) throw new Error("Inicie a stack Supabase local antes de gerar o ambiente.");
const status = JSON.parse(result.stdout);
if (status.API_URL !== "http://127.0.0.1:54321")
  throw new Error("Somente o projeto local na porta prevista pode ser usado.");
const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
if (typeof publicKey !== "string" || typeof secretKey !== "string")
  throw new Error("Chaves locais não encontradas.");
writeFileSync(
  destination,
  [
    `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publicKey}`,
    `SUPABASE_SECRET_KEY=${secretKey}`,
    "APP_URL=http://127.0.0.1:3000",
    "GOOGLE_AUTH_ENABLED=false",
    "ENABLE_COLLABORATION_SPIKE=false",
    "",
  ].join("\n"),
  { flag: "wx", mode: 0o600 },
);
console.info(".env.local criado com credenciais da stack local; nenhum valor foi exibido.");
