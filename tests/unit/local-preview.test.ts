import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalPreviewEnabled } from "../../src/features/auth/local-preview-policy";

afterEach(() => vi.unstubAllEnvs());
const local = { APP_URL: "http://127.0.0.1:3000", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };

describe("local preview boundary", () => {
  it("requires explicit opt-in", () => {
    vi.stubEnv("LOCAL_PREVIEW_ENABLED", "false");
    expect(isLocalPreviewEnabled(local)).toBe(false);
    vi.stubEnv("LOCAL_PREVIEW_ENABLED", "true");
    expect(isLocalPreviewEnabled(local)).toBe(true);
  });
  it.each([
    { ...local, APP_URL: "https://bloco.example.test" },
    { ...local, NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test" },
    { ...local, APP_URL: "http://127.0.0.1:3001" },
    { ...local, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" },
  ])("cannot enable remote origins or the isolated test stack: %o", (environment) => {
    vi.stubEnv("LOCAL_PREVIEW_ENABLED", "true");
    expect(isLocalPreviewEnabled(environment)).toBe(false);
  });
});
