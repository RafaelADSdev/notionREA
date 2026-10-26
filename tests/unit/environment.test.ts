import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvironment } from "../../src/lib/env";

afterEach(() => vi.unstubAllEnvs());

function local() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_fixture");
}

describe("environment trust boundaries", () => {
  it("permits loopback development and keeps privileged values out of its result", () => {
    local();
    vi.stubEnv("SUPABASE_SECRET_KEY", "server-only-synthetic");
    expect(getEnvironment()).not.toHaveProperty("SUPABASE_SECRET_KEY");
  });
  it("rejects a privileged key in the public field", () => {
    local();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_synthetic_fixture");
    expect(getEnvironment).toThrow("privileged");
  });
  it("rejects legacy service-role keys", () => {
    local();
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`);
    expect(getEnvironment).toThrow("anonymous");
  });
  it("rejects insecure remote application and backend origins", () => {
    local();
    vi.stubEnv("APP_URL", "http://bloco.example.test");
    expect(getEnvironment).toThrow("HTTPS");
    local();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db.example.test");
    expect(getEnvironment).toThrow("HTTPS");
  });
});
