import { spawnSync } from "node:child_process";
if (process.env.VERCEL === "1") throw new Error("Local browser test server cannot run on Vercel");
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3002"],
  {
    env: {
      ...process.env,
      NEXT_TEST_BUILD: "true",
      BLOCO_LOCAL_MODE: "true",
      BLOCO_SETUP_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SECRET_KEY: "",
      APP_URL: "http://127.0.0.1:3002",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);
process.exitCode = result.status ?? 1;
