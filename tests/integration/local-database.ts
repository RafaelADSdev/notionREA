import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { testWorkdir } from "../../scripts/test-stack.mjs";

export function localDatabaseUrl(): string {
  let connectionString = process.env.BLOCO_TEST_DATABASE_URL;
  if (!connectionString) {
    const packageManagerEntry = process.env.npm_execpath;
    if (!packageManagerEntry || !/\.[cm]?js$/i.test(packageManagerEntry)) {
      throw new Error("Run pnpm test:integration so the suite can inspect the local Supabase project.");
    }
    let status: unknown;
    try {
      const captured = execFileSync(
        process.execPath,
        [packageManagerEntry, "supabase", "--workdir", testWorkdir, "status", "--output", "json"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20_000,
        },
      );
      status = JSON.parse(captured);
    } catch {
      throw new Error(
        "Could not inspect the local Supabase database. Start the local stack before integration tests.",
      );
    }
    if (
      typeof status !== "object" ||
      status === null ||
      !("DB_URL" in status) ||
      typeof status.DB_URL !== "string"
    ) {
      throw new Error("Local Supabase status did not contain a database URL.");
    }
    connectionString = status.DB_URL;
  }
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error("Invalid local integration database configuration.");
  }
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    target.port !== "55322" ||
    target.pathname !== "/postgres"
  ) {
    throw new Error("Database integration tests only permit 127.0.0.1:55322/postgres.");
  }
  return connectionString;
}

export async function connectLocalDatabase(connectionString: string): Promise<Client> {
  const client = new Client({
    connectionString,
    application_name: "bloco-document-durability-test",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  try {
    await client.connect();
  } catch {
    throw new Error("Could not connect to the guarded local integration database.");
  }
  return client;
}
