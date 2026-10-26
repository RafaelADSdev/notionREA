import { describe, expect, it } from "vitest";
import {
  credentialsSchema,
  inviteEmailSchema,
  safeRedirect,
  workspaceNameSchema,
} from "../../src/features/auth/validation";

describe("authentication boundaries", () => {
  it("normalizes email without modifying the password", () => {
    expect(
      credentialsSchema.parse({ email: "  Person@Example.test ", password: "Correct-Horse-42 " }),
    ).toEqual({ email: "person@example.test", password: "Correct-Horse-42 " });
  });
  it.each(["short", "a".repeat(129)])("rejects unsafe password length", (password) => {
    expect(credentialsSchema.safeParse({ email: "person@example.test", password }).success).toBe(false);
  });
  it("rejects malformed email and blank or oversized workspace names", () => {
    expect(credentialsSchema.safeParse({ email: "invalid", password: "Correct-Horse-42" }).success).toBe(
      false,
    );
    expect(workspaceNameSchema.safeParse("  ").success).toBe(false);
    expect(workspaceNameSchema.safeParse("a".repeat(81)).success).toBe(false);
    expect(workspaceNameSchema.parse("  Studio  ")).toBe("Studio");
    expect(inviteEmailSchema.parse(" TEAM@EXAMPLE.TEST ")).toBe("team@example.test");
  });
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/auth/callback",
    "/reset-password?next=https://evil.test",
  ])("does not redirect to an uncontrolled destination %s", (destination) => {
    expect(safeRedirect(destination)).toBe("/");
  });
  it("allows only the explicit recovery and join destinations", () => {
    expect(safeRedirect("/reset-password")).toBe("/reset-password");
    expect(safeRedirect("/join")).toBe("/join");
    expect(safeRedirect(null)).toBe("/");
  });
});
