// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readBoundedJson, PayloadLimitError } from "../../src/lib/http";

describe("streamed request limits", () => {
  it("accepts bounded UTF-8 JSON and rejects oversized declared bodies", async () => {
    expect(
      await readBoundedJson(
        new Request("https://bloco.example", { method: "POST", body: '{"q":"ideias"}' }),
        100,
      ),
    ).toEqual({ q: "ideias" });
    const request = new Request("https://bloco.example", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "{}",
    });
    await expect(readBoundedJson(request, 10)).rejects.toBeInstanceOf(PayloadLimitError);
  });
  it("counts actual chunks even when content-length is absent or misleading", async () => {
    const request = new Request("https://bloco.example", { method: "POST", body: "x".repeat(20) });
    await expect(readBoundedJson(request, 10)).rejects.toBeInstanceOf(PayloadLimitError);
    const misleading = new Request("https://bloco.example", {
      method: "POST",
      headers: { "content-length": "1" },
      body: "x".repeat(20),
    });
    await expect(readBoundedJson(misleading, 10)).rejects.toBeInstanceOf(PayloadLimitError);
  });
});
