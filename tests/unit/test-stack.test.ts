import { describe, expect, it } from "vitest";
import {
  assertTestConfiguration,
  assertTestStatus,
  createTestConfiguration,
  runTestSupabase,
} from "../../scripts/test-stack.mjs";

const configuration = `project_id = "bloco"
[api]
port = 54321
[db]
port = 54322
shadow_port = 54320
[studio]
enabled = true
port = 54323
[local_smtp]
port = 54324
[auth]
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback"]
[edge_runtime]
enabled = true
inspector_port = 8083
`;

describe("isolated test stack boundary", () => {
  it("rejects CLI arguments that could change the database target or stop every project", () => {
    for (const command of [
      ["stop", "--all"],
      ["db", "reset", "--linked"],
      ["db", "reset", "--db-url", "postgresql://example.test/postgres"],
    ]) {
      expect(() => runTestSupabase(command)).toThrow(/cannot change targeting/);
    }
  });
  it("derives a distinct project, every port and authentication origin", () => {
    const isolated = createTestConfiguration(configuration);
    expect(isolated).toContain('project_id = "bloco-test"');
    expect(isolated).toContain("port = 55322");
    expect(isolated).toContain("shadow_port = 55320");
    expect(isolated).toContain("port = 55324");
    expect(isolated).toContain("inspector_port = 8183");
    expect(isolated).toContain("http://127.0.0.1:3001/auth/callback");
    expect(isolated).not.toMatch(/5432\d|:3000/);
    expect(() => assertTestConfiguration(isolated)).not.toThrow();
  });

  it("refuses a canonical project even if its database port was changed", () => {
    expect(() => assertTestConfiguration(configuration.replace("54322", "55322"))).toThrow();
  });

  it("refuses a test configuration that points at the real app origin", () => {
    const isolated = createTestConfiguration(configuration);
    expect(() => assertTestConfiguration(isolated.replaceAll(":3001", ":3000"))).toThrow();
  });

  it("rejects changed canonical ports rather than guessing a safe transformation", () => {
    expect(() => createTestConfiguration(configuration.replace("54322", "54342"))).toThrow();
  });

  it("does not mistake a port in another section for the required database port", () => {
    const isolated = createTestConfiguration(configuration).replace(
      "[db]\nport = 55322",
      "[db]\nport = 55342",
    );
    expect(() => assertTestConfiguration(`${isolated}\n[unrelated]\nport = 55322\n`)).toThrow();
  });

  it("accepts only the test HTTP and database endpoints together", () => {
    const status = {
      API_URL: "http://127.0.0.1:55321",
      DB_URL: "postgresql://postgres:synthetic@127.0.0.1:55322/postgres",
    };
    expect(() => assertTestStatus(status)).not.toThrow();
    expect(() => assertTestStatus({ ...status, API_URL: "http://127.0.0.1:54321" })).toThrow();
    expect(() => assertTestStatus({ ...status, DB_URL: status.DB_URL.replace("55322", "54322") })).toThrow();
    expect(() =>
      assertTestStatus({ ...status, DB_URL: status.DB_URL.replace("127.0.0.1", "db.example.test") }),
    ).toThrow();
    expect(() => assertTestStatus(null)).toThrow();
  });
});
