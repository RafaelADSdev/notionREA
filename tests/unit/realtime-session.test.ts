// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), claims: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: mocks.user,
  createClient: async () => ({ auth: { getSession: mocks.session, getClaims: mocks.claims } }),
}));
vi.mock("@/lib/env", () => ({ getEnvironment: () => ({ APP_URL: "http://127.0.0.1:3001" }) }));

import { POST } from "../../src/app/api/realtime/session/route";

const actor = { id: "e0000000-0000-4000-8000-000000000001" };
beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue(actor);
  mocks.claims.mockReset().mockResolvedValue({ data: { claims: { sub: actor.id } }, error: null });
  mocks.session.mockReset().mockResolvedValue({
    data: {
      session: {
        user: actor,
        access_token: "synthetic-access-token",
        refresh_token: "never-return-this",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
    },
    error: null,
  });
});
it("returns only the verified user's transient socket credential with no cache or refresh token", async () => {
  const result = await POST(
    new Request("http://127.0.0.1:3001/api/realtime/session", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:3001" },
    }),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toContain("no-store");
  const body = await result.json();
  expect(Object.keys(body).sort()).toEqual(["accessToken", "expiresAt"]);
  expect(body.accessToken).toBe("synthetic-access-token");
  mocks.user.mockResolvedValue(null);
  expect(
    (
      await POST(
        new Request("http://127.0.0.1:3001/api/realtime/session", {
          method: "POST",
          headers: { Origin: "http://127.0.0.1:3001" },
        }),
      )
    ).status,
  ).toBe(401);
});
