// @vitest-environment node

import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: mocks.user,
  createClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/env", () => ({ getEnvironment: () => ({ APP_URL: "http://127.0.0.1:3001" }) }));

import { GET, POST } from "../../src/app/api/pages/[pageId]/sharing/route";
import { publicPageSchema } from "../../src/features/sharing/model";
import { PublicPageDocument } from "../../src/features/sharing/public-page";

const pageId = "d1000000-0000-4000-8000-000000000001",
  context = { params: Promise.resolve({ pageId }) },
  token = "a".repeat(64);
beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: "d2000000-0000-4000-8000-000000000001" });
  mocks.rpc.mockReset();
});
describe("public and private sharing boundaries", () => {
  it("escapes rich text and never renders an unsafe link or extra private projection fields", () => {
    const value = {
      page: { id: pageId, title: "Pesquisa", icon: "", coverFileId: null },
      content: {
        schemaVersion: 1,
        blocks: [
          {
            id: "block",
            type: "paragraph",
            parentId: null,
            position: "a",
            attributes: {},
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "<script>injected()</script>",
                      marks: [{ type: "link", attrs: { href: "javascript:injected()" } }],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      database: null,
      files: [],
    };
    const data = publicPageSchema.parse(value);
    const html = renderToStaticMarkup(createElement(PublicPageDocument, { data, token }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(publicPageSchema.safeParse({ ...value, snapshot: "private-binary" }).success).toBe(false);
  });
  it("rejects a foreign origin and anonymous access before invoking a sharing RPC", async () => {
    const response = await POST(
      new NextRequest(`http://127.0.0.1:3001/api/pages/${pageId}/sharing`, {
        method: "POST",
        headers: { Origin: "https://unrelated.example" },
        body: "{}",
      }),
      context,
    );
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue(null);
    expect(
      (await GET(new NextRequest(`http://127.0.0.1:3001/api/pages/${pageId}/sharing`), context)).status,
    ).toBe(401);
  });
  it("does not return database error internals from an unauthorized sharing read", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "private diagnostic", details: "private data" },
    });
    const response = await GET(new NextRequest(`http://127.0.0.1:3001/api/pages/${pageId}/sharing`), context);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private");
  });
});
