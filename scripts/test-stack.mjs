import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const testWorkdir = resolve(root, ".supabase/testing");
const testEnvironmentPath = resolve(root, ".env.test.local");
const testConfigPath = resolve(testWorkdir, "supabase/config.toml");

function section(configuration, name) {
  const heading = `[${name}]`;
  const start = configuration.indexOf(heading);
  if (start < 0) return "";
  const body = configuration.slice(start + heading.length);
  return body.split(/^\[/m)[0];
}

export function assertTestConfiguration(configuration) {
  if (
    !/^project_id = "bloco-test"$/m.test(configuration) ||
    !/^port = 55321$/m.test(section(configuration, "api")) ||
    !/^port = 55322$/m.test(section(configuration, "db")) ||
    !/^port = 55324$/m.test(section(configuration, "local_smtp")) ||
    !/^site_url = "http:\/\/127\.0\.0\.1:3001"$/m.test(section(configuration, "auth")) ||
    /5432\d|:3000\b/.test(configuration)
  )
    throw new Error("Test stack configuration must exclusively target bloco-test and isolated ports.");
}

export function createTestConfiguration(configuration) {
  if (
    !/^project_id = "bloco"$/m.test(configuration) ||
    !/^port = 54322$/m.test(section(configuration, "db"))
  ) {
    throw new Error("Unexpected canonical configuration; refusing to guess test database targeting.");
  }
  const isolated = configuration
    .replace(/^project_id = "bloco"$/m, 'project_id = "bloco-test"')
    .replaceAll(/\b5432(\d)\b/g, "5532$1")
    .replaceAll(":3000", ":3001")
    .replaceAll("inspector_port = 8083", "inspector_port = 8183")
    .replace(/(\[studio\]\s[\s\S]*?enabled = )true/, "$1false")
    .replace(/(\[edge_runtime\]\s[\s\S]*?enabled = )true/, "$1false");
  if (/\[auth\.external\./.test(isolated))
    throw new Error("External OAuth configuration is forbidden in the synthetic test stack.");
  assertTestConfiguration(isolated);
  return isolated;
}

export function assertTestStatus(status) {
  if (
    !status ||
    typeof status !== "object" ||
    status.API_URL !== "http://127.0.0.1:55321" ||
    typeof status.DB_URL !== "string"
  ) {
    throw new Error("Supabase status does not identify the isolated test stack.");
  }
  let database;
  try {
    database = new URL(status.DB_URL);
  } catch {
    throw new Error("Invalid test database endpoint.");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    database.hostname !== "127.0.0.1" ||
    database.port !== "55322" ||
    database.pathname !== "/postgres"
  ) {
    throw new Error("Test operations only permit 127.0.0.1:55322/postgres.");
  }
}

function assertOwnedDirectory(directory) {
  const absolute = resolve(directory);
  if (
    absolute !== testWorkdir &&
    !absolute.startsWith(`${testWorkdir}/`) &&
    !absolute.startsWith(`${testWorkdir}\\`)
  ) {
    throw new Error("Test filesystem operation escaped its dedicated work directory.");
  }
  for (const candidate of [
    resolve(root, ".supabase"),
    testWorkdir,
    resolve(testWorkdir, "supabase"),
    absolute,
  ]) {
    if (
      existsSync(candidate) &&
      (lstatSync(candidate).isSymbolicLink() || realpathSync(candidate) !== candidate)
    ) {
      throw new Error("Test work directory must not contain redirected filesystem paths.");
    }
  }
}

function writeTestTypeConfiguration() {
  const destination = resolve(testWorkdir, "tsconfig.json");
  assertOwnedDirectory(destination);
  writeFileSync(
    destination,
    `${JSON.stringify(
      {
        extends: "../../tsconfig.json",
        compilerOptions: { tsBuildInfoFile: "./tsconfig.tsbuildinfo" },
        include: [
          "../../next-env.d.ts",
          "../../src/**/*.ts",
          "../../src/**/*.tsx",
          "../../tests/**/*.ts",
          "../../e2e/**/*.ts",
          "../../*.ts",
          "../../scripts/**/*.d.mts",
          "../../.next-test/types/**/*.ts",
          "../../.next-test/dev/types/**/*.ts",
        ],
        exclude: ["../../node_modules", "../../.next", "../../.supabase"],
      },
      null,
      2,
    )}\n`,
  );
}

export function prepareTestStack() {
  assertOwnedDirectory(testWorkdir);
  mkdirSync(resolve(testWorkdir, "supabase"), { recursive: true });
  assertOwnedDirectory(testConfigPath);
  const configuration = createTestConfiguration(readFileSync(resolve(root, "supabase/config.toml"), "utf8"));
  writeFileSync(testConfigPath, configuration);
  writeTestTypeConfiguration();
  for (const folder of ["migrations", "tests"]) {
    const destination = resolve(testWorkdir, "supabase", folder);
    assertOwnedDirectory(destination);
    rmSync(destination, { recursive: true, force: true });
    cpSync(resolve(root, "supabase", folder), destination, { recursive: true, dereference: false });
  }
}

export function runTestSupabase(args) {
  const allowedCommands = [
    ["status", "--output", "json"],
    ["db", "reset", "--local"],
    ["test", "db"],
    ["gen", "types", "typescript", "--local"],
    ["stop"],
    ["start", "--exclude", "studio,postgres-meta,edge-runtime,imgproxy,logflare,vector,supavisor"],
  ];
  if (!allowedCommands.some((command) => JSON.stringify(command) === JSON.stringify(args))) {
    throw new Error(
      "Supabase test commands cannot change targeting, stop all projects or access linked resources.",
    );
  }
  assertOwnedDirectory(testWorkdir);
  assertTestConfiguration(readFileSync(testConfigPath, "utf8"));
  if (!process.env.npm_execpath) throw new Error("Run this operation using the documented pnpm scripts.");
  return spawnSync(
    process.execPath,
    [process.env.npm_execpath, "supabase", "--workdir", testWorkdir, ...args],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export function testStackStatus() {
  const result = runTestSupabase(["status", "--output", "json"]);
  if (result.status !== 0) throw new Error("Isolated test stack unavailable. Run pnpm test:env.");
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    throw new Error("Invalid isolated stack status.");
  }
  assertTestStatus(status);
  return status;
}

function writeTestEnvironment(status) {
  assertTestStatus(status);
  if (
    existsSync(testEnvironmentPath) &&
    (lstatSync(testEnvironmentPath).isSymbolicLink() ||
      realpathSync(testEnvironmentPath) !== testEnvironmentPath)
  ) {
    throw new Error("Refusing redirected test environment file.");
  }
  const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (
    [publicKey, secretKey, status.DB_URL].some((value) => typeof value !== "string" || /[\r\n]/.test(value))
  ) {
    throw new Error("Invalid synthetic test credentials.");
  }
  writeFileSync(
    testEnvironmentPath,
    [
      "BLOCO_TEST_STACK=bloco-test",
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321",
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publicKey}`,
      `SUPABASE_SECRET_KEY=${secretKey}`,
      `BLOCO_TEST_DATABASE_URL=${status.DB_URL}`,
      "APP_URL=http://127.0.0.1:3001",
      "GOOGLE_AUTH_ENABLED=false",
      "ENABLE_COLLABORATION_SPIKE=true",
      "NEXT_TEST_BUILD=true",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

export function loadTestEnvironment() {
  const environment = parseEnv(readFileSync(testEnvironmentPath, "utf8"));
  if (environment.BLOCO_TEST_STACK !== "bloco-test" || environment.APP_URL !== "http://127.0.0.1:3001") {
    throw new Error("Invalid isolated test application environment.");
  }
  assertTestStatus({
    API_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
    DB_URL: environment.BLOCO_TEST_DATABASE_URL,
  });
  if (!environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !environment.SUPABASE_SECRET_KEY)
    throw new Error("Missing synthetic credentials.");
  if (
    environment.NEXT_TEST_BUILD !== "true" ||
    environment.GOOGLE_AUTH_ENABLED !== "false" ||
    environment.ENABLE_COLLABORATION_SPIKE !== "true"
  ) {
    throw new Error("Invalid synthetic application flags.");
  }
  return environment;
}

function main() {
  const operation = process.argv[2];
  if (operation === "prepare" || operation === "start" || operation === "reset" || operation === "rls")
    prepareTestStack();
  if (operation === "prepare") return console.info("Isolated test configuration and migrations refreshed.");
  if (operation === "start") {
    const result = runTestSupabase([
      "start",
      "--exclude",
      "studio,postgres-meta,edge-runtime,imgproxy,logflare,vector,supavisor",
    ]);
    if (result.status !== 0)
      throw new Error("Could not start isolated test services; credentials and CLI output were withheld.");
    writeTestEnvironment(testStackStatus());
    return console.info(
      "Isolated test services ready (API 55321, DB 55322, Mailpit 55324); credentials saved without display.",
    );
  }
  if (operation === "reset" || operation === "rls") {
    testStackStatus();
    const result = runTestSupabase(operation === "reset" ? ["db", "reset", "--local"] : ["test", "db"]);
    if (operation === "rls")
      console.info(result.stdout.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[database URL withheld]"));
    if (result.status !== 0)
      throw new Error(`Isolated test ${operation} failed; private connection details withheld.`);
    if (operation === "reset") writeTestEnvironment(testStackStatus());
    return console.info(`Isolated test ${operation} completed.`);
  }
  if (operation === "stop") {
    const result = runTestSupabase(["stop"]);
    if (result.status !== 0) throw new Error("Could not stop isolated test stack.");
    return console.info("Only bloco-test services stopped.");
  }
  if (operation === "build" || operation === "server") {
    const environment = loadTestEnvironment();
    if (operation === "build") writeTestTypeConfiguration();
    const result = spawnSync(
      process.execPath,
      [
        process.env.npm_execpath,
        operation === "build" ? "build" : "start",
        ...(operation === "server" ? ["--hostname", "127.0.0.1", "--port", "3001"] : []),
      ],
      {
        cwd: root,
        env: { ...process.env, ...environment, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (operation === "build") {
      const restored = spawnSync(process.execPath, [process.env.npm_execpath, "exec", "next", "typegen"], {
        cwd: root,
        env: { ...process.env, NEXT_TEST_BUILD: "false", NEXT_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      if (restored.status !== 0)
        throw new Error("Could not restore default route type references after isolated build.");
    }
    if (result.status !== 0) throw new Error(`Isolated application ${operation} failed.`);
    return;
  }
  throw new Error("Unknown test stack operation.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
