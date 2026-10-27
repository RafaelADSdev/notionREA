import { describe, expect, it } from "vitest";
import { calendarDay, moveDateToDay } from "../../src/features/databases/ui/value-utils";

describe("database calendar presentation", () => {
  it("moves civil ranges by calendar days without converting them to local instants", () => {
    expect(moveDateToDay({ kind: "civil", start: "2024-02-28", end: "2024-03-01" }, "2024-02-29")).toEqual({
      kind: "civil",
      start: "2024-02-29",
      end: "2024-03-02",
    });
  });
  it("moves an instant across daylight saving while preserving its clock time and zone", () => {
    const value = {
      kind: "instant" as const,
      start: "2024-03-09T14:30:00.000Z",
      end: null,
      timeZone: "America/New_York",
    };
    expect(moveDateToDay(value, "2024-03-10")).toEqual({ ...value, start: "2024-03-10T13:30:00.000Z" });
    expect(calendarDay({ ...value, start: "2024-03-10T01:00:00.000Z" })).toBe("2024-03-09");
  });
  it("rejects nonexistent daylight-saving wall times instead of silently changing the hour", () => {
    expect(() =>
      moveDateToDay(
        { kind: "instant", start: "2024-03-09T07:30:00Z", end: null, timeZone: "America/New_York" },
        "2024-03-10",
      ),
    ).toThrow();
  });
});
