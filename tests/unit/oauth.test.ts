import { afterEach, describe, expect, it, vi } from "vitest";
import { signInGoogle } from "../../src/features/auth/actions";

const mocks = vi.hoisted(() => ({
  oauth: vi.fn(),
  environment: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithOAuth: mocks.oauth } }),
}));
vi.mock("@/lib/env", () => ({ getEnvironment: mocks.environment }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

afterEach(() => vi.clearAllMocks());
function enabled(flag = "true") {
  mocks.environment.mockReturnValue({
    GOOGLE_AUTH_ENABLED: flag,
    APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  });
}

describe("Google initiation boundaries (no real provider assertion)", () => {
  it("does not initiate OAuth until the operator enables the configured provider", async () => {
    enabled("false");
    expect(await signInGoogle()).toHaveProperty("error");
    expect(mocks.oauth).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("hands off only to the configured Auth origin with the canonical callback", async () => {
    enabled();
    const url = "http://127.0.0.1:54321/auth/v1/authorize?provider=google";
    mocks.oauth.mockResolvedValue({ data: { url }, error: null });
    await expect(signInGoogle()).rejects.toThrow(`REDIRECT:${url}`);
    expect(mocks.oauth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://127.0.0.1:3000/auth/callback" },
    });
  });
  it("rejects an unexpected redirect origin or failed initiation", async () => {
    enabled();
    mocks.oauth.mockResolvedValue({ data: { url: "https://untrusted.example.test" }, error: null });
    expect(await signInGoogle()).toHaveProperty("error");
    expect(mocks.redirect).not.toHaveBeenCalled();
    mocks.oauth.mockResolvedValue({ data: { url: null }, error: new Error("synthetic") });
    expect(await signInGoogle()).toHaveProperty("error");
  });
});
