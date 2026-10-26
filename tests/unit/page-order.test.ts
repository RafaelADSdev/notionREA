import { describe, expect, it } from "vitest";
import { reorderIntent } from "../../src/features/pages/model/order";
import { pageMetadataSchema } from "../../src/features/pages/model/validation";

describe("page movement intent", () => {
  it("expresses moves by the next sibling identity without floating point positions", () => {
    expect(reorderIntent(["a", "b", "c"], "a", "b")).toEqual({ beforeId: "c" });
    expect(reorderIntent(["a", "b", "c"], "c", "a")).toEqual({ beforeId: "a" });
    expect(reorderIntent(["a", "b", "c"], "a", "c")).toEqual({ beforeId: null });
  });
  it("does not silently invent a destination for cancelled, stale or duplicate identities", () => {
    expect(reorderIntent(["a", "b"], "a", "a")).toBeNull();
    expect(reorderIntent(["a", "b"], "missing", "b")).toBeNull();
    expect(reorderIntent(["a", "a"], "a", "a")).toBeNull();
  });
});

describe("page metadata boundary", () => {
  it("accepts empty titles and one system emoji, including a family sequence", () => {
    expect(pageMetadataSchema.parse({ title: "", icon: "" })).toEqual({ title: "", icon: "" });
    expect(pageMetadataSchema.parse({ title: "Plano", icon: "👩‍👩‍👧‍👦" }).icon).toBe("👩‍👩‍👧‍👦");
  });
  it("rejects excessive titles and labels masquerading as icons", () => {
    expect(pageMetadataSchema.safeParse({ title: "x".repeat(501), icon: "" }).success).toBe(false);
    expect(pageMetadataSchema.safeParse({ title: "", icon: "<script>" }).success).toBe(false);
    expect(pageMetadataSchema.safeParse({ title: "", icon: "📝📝" }).success).toBe(false);
  });
});
