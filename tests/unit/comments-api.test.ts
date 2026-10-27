// @vitest-environment node
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: mocks.user,
  createClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/env", () => ({ getEnvironment: () => ({ APP_URL: "http://127.0.0.1:3001" }) }));

import { PATCH } from "../../src/app/api/comments/[commentId]/route";
import { GET as replies } from "../../src/app/api/comments/threads/[threadId]/route";
import { GET, POST } from "../../src/app/api/pages/[pageId]/comments/route";
import { POST as presence } from "../../src/app/api/pages/[pageId]/presence/route";
import { CommentText } from "../../src/features/comments/comment-thread";

const pageId = "c1000000-0000-4000-8000-000000000001";
const userId = "c2000000-0000-4000-8000-000000000001";
const threadId = "c3000000-0000-4000-8000-000000000001";
const requestId = "c4000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ pageId }) };
function request(body: unknown, method = "POST", origin = "http://127.0.0.1:3001") {
  return new NextRequest(`http://127.0.0.1:3001/api/pages/${pageId}/comments`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: userId });
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "get_page_role"
        ? "commenter"
        : name === "list_comment_threads"
          ? { threads: [], nextCursor: null }
          : name === "create_comment_thread"
            ? threadId
            : 1,
  }));
});
describe("comments and presence HTTP boundaries", () => {
  it("requires same-origin mutation and authenticated reads before RPC access", async () => {
    expect(
      (await POST(request({ body: "Texto", requestId }, "POST", "https://foreign.example"), context)).status,
    ).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue(null);
    const response = await GET(
      new NextRequest(`http://127.0.0.1:3001/api/pages/${pageId}/comments`),
      context,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds actual UTF-8 body bytes and rejects unknown fields", async () => {
    expect((await POST(request({ body: "á".repeat(4097), requestId }), context)).status).toBe(400);
    expect((await POST(request({ body: "Texto", requestId, authorId: userId }), context)).status).toBe(400);
    expect((await POST(request({ body: "x".repeat(65537), requestId }), context)).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("stores plain literal text with a stable request identity and no client author/date authority", async () => {
    const body = '<img src=x onerror="alert(1)">';
    const response = await POST(request({ body, requestId }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: threadId });
    expect(mocks.rpc).toHaveBeenCalledWith("create_comment_thread", {
      p_page_id: pageId,
      p_body: body,
      p_request_id: requestId,
    });
    const html = renderToStaticMarkup(createElement(CommentText, { value: body }));
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
  it("allows the full text budget when JSON escaping expands the wire representation", async () => {
    const body = '"'.repeat(8192);
    expect((await POST(request({ body, requestId }), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("create_comment_thread", {
      p_page_id: pageId,
      p_body: body,
      p_request_id: requestId,
    });
  });
  it("accepts canonical public Yjs relative positions only with a matching block context", async () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("block-content:subject");
    const relative = Buffer.from(
      Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(fragment, 0)),
    ).toString("base64url");
    const anchor = { type: "relative", start: relative, end: relative };
    expect((await POST(request({ body: "Trecho", requestId, anchor }), context)).status).toBe(400);
    expect(
      (await POST(request({ body: "Trecho", requestId, blockId: "other", anchor }), context)).status,
    ).toBe(400);
    expect(
      (await POST(request({ body: "Trecho", requestId, blockId: "subject", anchor }), context)).status,
    ).toBe(200);
    doc.destroy();
  });
  it("returns the actual page role and viewer identity without an e-mail field", async () => {
    const response = await GET(
      new NextRequest(`http://127.0.0.1:3001/api/pages/${pageId}/comments`),
      context,
    );
    expect(await response.json()).toEqual({
      threads: [],
      nextCursor: null,
      role: "commenter",
      actorId: userId,
    });
  });
  it("preserves sub-millisecond cursor precision and rejects cursors from a different scope", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      error: null,
      data:
        name === "get_page_role"
          ? "commenter"
          : { threads: [], nextCursor: { createdAt: "2026-10-26T12:00:00.123456+00:00", id: threadId } },
    }));
    const response = await GET(
      new NextRequest(`http://127.0.0.1:3001/api/pages/${pageId}/comments`),
      context,
    );
    const body = await response.json();
    expect(JSON.parse(Buffer.from(body.nextCursor, "base64url").toString("utf8")).createdAt).toBe(
      "2026-10-26T12:00:00.123456+00:00",
    );
    expect(
      (
        await replies(
          new NextRequest(`http://127.0.0.1:3001/api/comments/threads/${threadId}?cursor=${body.nextCursor}`),
          { params: Promise.resolve({ threadId }) },
        )
      ).status,
    ).toBe(400);
  });
  it("maps edit CAS conflicts to a fixed error without backend text", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "private SQL" } });
    const response = await PATCH(request({ body: "Mudança", expectedRevision: 0 }, "PATCH"), {
      params: Promise.resolve({ commentId: threadId }),
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("private SQL");
  });
  it("whitelists bounded presence data and propagates revoked authorization", async () => {
    mocks.rpc.mockResolvedValue({
      error: null,
      data: {
        epoch: 3,
        expiresAt: "2026-10-26T12:00:30+00:00",
        participants: [{ participantId: requestId, label: "Membro", expiresAt: "2026-10-26T12:00:30+00:00" }],
      },
    });
    const response = await presence(request({ participantId: requestId }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("renew_page_presence", {
      p_page_id: pageId,
      p_participant_id: requestId,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private page" } });
    expect((await presence(request({ participantId: requestId }), context)).status).toBe(403);
  });
});
