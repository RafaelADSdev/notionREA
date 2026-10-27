import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isSetupMode } from "../../src/lib/setup-mode";
import { proxy } from "../../src/proxy";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({ createServerClient: auth }));
describe("hosted setup without a backend", () => {
  it("requires an explicit flag locally and fails closed on incomplete hosted configuration", () => {
    expect(isSetupMode({})).toBe(false);
    expect(isSetupMode({ VERCEL: "1" })).toBe(true);
    expect(isSetupMode({ BLOCO_SETUP_MODE: "true" })).toBe(true);
    expect(
      isSetupMode({
        VERCEL: "1",
        APP_URL: "https://bloco.example.test",
        NEXT_PUBLIC_SUPABASE_URL: "https://backend.example.test",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
        SUPABASE_SECRET_KEY: "server",
      }),
    ).toBe(false);
  });
  it("renders setup for deep links, rejects API writes, and never initializes Auth", async () => {
    vi.stubEnv("BLOCO_SETUP_MODE", "true");
    try {
      const page = await proxy(new NextRequest("https://bloco.example.test/w/private/p/private"));
      expect(page.headers.get("x-middleware-rewrite")).toBe("https://bloco.example.test/setup");
      expect(page.headers.get("Content-Security-Policy")).toContain("object-src 'none'");
      const api = await proxy(new NextRequest("https://bloco.example.test/api/pages", { method: "POST" }));
      expect(api.status).toBe(503);
      expect(await api.json()).toEqual({ error: "setup-required" });
      const health = await proxy(new NextRequest("https://bloco.example.test/api/health"));
      expect(health.headers.get("x-middleware-rewrite")).toBeNull();
      expect(auth).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
