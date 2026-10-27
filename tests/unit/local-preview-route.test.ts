import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/app/auth/local/route";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  rpc: vi.fn(),
}));
afterEach(() => vi.unstubAllEnvs());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser, verifyOtp: mocks.verifyOtp },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: mocks.createUser,
        generateLink: mocks.generateLink,
      },
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LOCAL_PREVIEW_ENABLED", "true");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_fixture");
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.createUser.mockResolvedValue({ error: null });
  mocks.generateLink.mockResolvedValue({
    error: null,
    data: {
      user: { app_metadata: { local_preview: true } },
      properties: { hashed_token: "synthetic" },
    },
  });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: "workspace-synthetic", error: null });
});

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://127.0.0.1:3000/auth/local", {
    headers: { host: "127.0.0.1:3000", ...headers },
  });
}

describe("automatic local preview session", () => {
  it("opens a dedicated workspace with an ordinary authenticated session", async () => {
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/w/workspace-synthetic");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("preserves an existing personal session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "existing" } } });
    expect((await GET(request())).headers.get("location")).toBe("http://127.0.0.1:3000/");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it("refuses an account without the server preview marker", async () => {
    mocks.generateLink.mockResolvedValue({ error: null, data: { user: { app_metadata: {} } } });
    await expect(GET(request())).rejects.toThrow("autenticar");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
  it.each([{ host: "remote.example.test" }, { "sec-fetch-site": "cross-site" }])(
    "rejects untrusted requests before authentication: %o",
    async (headers) => {
      expect((await GET(request(headers))).status).toBe(404);
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );
});
