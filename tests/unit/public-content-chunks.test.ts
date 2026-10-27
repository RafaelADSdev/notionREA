// @vitest-environment node
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Collaborators } from "../../src/features/collaboration/collaborators";
import { leaseSchema } from "../../src/features/collaboration/protocol";
import { PUBLIC_CONTENT_CHUNK_BYTES, publicPageSchema } from "../../src/features/sharing/model";
import { loadPublicContent } from "../../src/features/sharing/public-content";
import { PublicPageDocument } from "../../src/features/sharing/public-page";
import { LocaleProvider } from "../../src/lib/i18n/client";

const token = "a".repeat(64);
function transfer(text: string) {
  const content = {
    schemaVersion: 1,
    blocks: [
      {
        id: "a",
        type: "paragraph",
        parentId: null,
        position: "U",
        attributes: {},
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(content));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    hash,
    byteLength: bytes.length,
    chunks: Math.ceil(bytes.length / PUBLIC_CONTENT_CHUNK_BYTES),
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const index = Number(new URL(String(_url), "http://example.test").searchParams.get("index"));
    expect(options?.cache).toBe("no-store");
    return Response.json({
      hash,
      index,
      byteLength: bytes.length,
      data: bytes
        .subarray(index * PUBLIC_CONTENT_CHUNK_BYTES, (index + 1) * PUBLIC_CONTENT_CHUNK_BYTES)
        .toString("base64"),
    });
  });
  return { content, manifest, fetcher };
}
describe("bounded public content transfer", () => {
  it("localizes absent participant labels without translating an authored Membro name", () => {
    const participants = ["Membro", ""].map((label, index) => ({
      participantId: `f2000000-0000-4000-8000-00000000000${index + 1}`,
      label,
      expiresAt: Date.now() + 30000,
      color: "indigo" as const,
      cursor: null,
    }));
    expect(
      leaseSchema.safeParse({
        epoch: 1,
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        participants: participants.map((participant) => ({
          participantId: participant.participantId,
          label: participant.label,
          expiresAt: new Date(participant.expiresAt).toISOString(),
        })),
      }).success,
    ).toBe(true);
    const html = renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { locale: "en" },
        createElement(Collaborators, {
          collaboration: { connection: "ready", presenceAvailable: true, participants },
        }),
      ),
    );
    expect(html).toContain("<span>Membro</span>");
    expect(html).toContain("<span>Member</span>");
  });
  it("reassembles multibyte text across byte boundaries and verifies the full hash", async () => {
    const fixture = transfer("á🙂".repeat(100000));
    expect(
      await loadPublicContent(token, fixture.manifest, new AbortController().signal, fixture.fetcher),
    ).toEqual(fixture.content);
    expect(fixture.fetcher).toHaveBeenCalledTimes(fixture.manifest.chunks);
  });
  it("rejects revocation and never fetches later chunks after a denial", async () => {
    const fixture = transfer("a".repeat(600000));
    fixture.fetcher.mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 404 }));
    await expect(
      loadPublicContent(token, fixture.manifest, new AbortController().signal, fixture.fetcher),
    ).rejects.toMatchObject({ status: 404 });
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a complete payload whose manifest hash does not match", async () => {
    const fixture = transfer("Original text");
    fixture.fetcher.mockImplementationOnce(async () =>
      Response.json({
        hash: fixture.manifest.hash,
        index: 0,
        byteLength: fixture.manifest.byteLength,
        data: Buffer.from("x".repeat(fixture.manifest.byteLength)).toString("base64"),
      }),
    );
    await expect(
      loadPublicContent(token, fixture.manifest, new AbortController().signal, fixture.fetcher),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("translates only the unavailable marker while preserving identical authored words", () => {
    const data = publicPageSchema.parse({
      page: {
        id: "f1000000-0000-4000-8000-000000000001",
        title: "Texto autoral",
        icon: "",
        coverFileId: null,
      },
      content: {
        schemaVersion: 1,
        blocks: [
          {
            id: "a",
            type: "paragraph",
            parentId: null,
            position: "U",
            attributes: {},
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Conteúdo indisponível" }, { type: "unavailable" }],
                },
              ],
            },
          },
        ],
      },
      database: null,
      files: [],
    });
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "en" }, createElement(PublicPageDocument, { data, token })),
    );
    expect(html).toContain("Conteúdo indisponível");
    expect(html).toContain("Content unavailable");
    expect(html).toContain("Texto autoral");
  });
});
