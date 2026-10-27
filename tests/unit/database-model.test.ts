import { describe, expect, it } from "vitest";
import {
  compareRecords,
  compareText,
  defaultPropertyValue,
  databaseSchemaSchema,
  evaluateFilter,
  parseCursor,
  parseFilter,
  parsePropertyValue,
  parsePropertyWrite,
  parseView,
  propertyDefinitionSchema,
  serializeDatabaseQuery,
  type PropertyDefinition,
} from "../../src/features/databases/model";

const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function property(type: string, config: unknown = {}, number = 1): PropertyDefinition {
  return propertyDefinitionSchema.parse({ id: id(number), name: type, type, config });
}
const title = () => property("title");
const option = { id: "abcdef00-0000-4000-8000-000000000090", label: "Em andamento", color: "indigo" };

describe("typed database contracts", () => {
  it.each([
    ["title", {}, "", ""],
    ["text", {}, "linha\nseguinte", "linha\nseguinte"],
    ["number", {}, "00012.3400", "12.34"],
    ["select", { options: [option] }, option.id.toUpperCase(), option.id],
    ["multiSelect", { options: [option] }, [option.id], [option.id]],
    [
      "date",
      { mode: "civil" },
      { kind: "civil", start: "2024-02-29", end: null },
      { kind: "civil", start: "2024-02-29", end: null },
    ],
    ["checkbox", {}, false, false],
    ["url", {}, "HTTPS://EXAMPLE.COM", "https://example.com/"],
    ["person", {}, [id(3), id(2)], [id(2), id(3)]],
    ["relation", { targetDatabaseId: id(99) }, [], []],
    ["createdTime", {}, "2026-10-26T12:00:00-03:00", "2026-10-26T15:00:00.000Z"],
    ["editedTime", {}, "2026-10-26T15:00:00Z", "2026-10-26T15:00:00.000Z"],
  ])("validates %s without conflating absent, empty, zero or false", (type, config, input, expected) => {
    const definition = property(String(type), config);
    expect(parsePropertyValue(definition, input)).toEqual(expected);
    expect(parsePropertyValue(definition, null)).toBeNull();
  });

  it("keeps decimal precision and rejects nonfinite, localized, unsafe-number and malformed values", () => {
    const definition = property("number");
    expect(parsePropertyValue(definition, "9007199254740993.00001")).toBe("9007199254740993.00001");
    expect(parsePropertyValue(definition, 1e-7)).toBe("0.0000001");
    expect(parsePropertyValue(definition, -0)).toBe("0");
    for (const value of [NaN, Infinity, 9007199254740992, "1,2", "", "1e9999", {}, true])
      expect(() => parsePropertyValue(definition, value)).toThrow();
  });

  it("validates leap days, zoned instant ranges and mode without converting civil days to UTC", () => {
    const civil = property("date", { mode: "civil" });
    const instant = property("date", { mode: "instant" });
    expect(
      parsePropertyValue(instant, {
        kind: "instant",
        start: "2024-03-10T01:30:00-05:00",
        end: "2024-03-10T03:30:00-04:00",
        timeZone: "America/New_York",
      }),
    ).toEqual({
      kind: "instant",
      start: "2024-03-10T06:30:00.000Z",
      end: "2024-03-10T07:30:00.000Z",
      timeZone: "America/New_York",
    });
    for (const value of [
      { kind: "civil", start: "2023-02-29", end: null },
      { kind: "civil", start: "2024-01-02", end: "2024-01-01" },
      { kind: "instant", start: "2024-01-01T00:00:00Z", end: null, timeZone: "Invalid/Zone" },
    ])
      expect(() => parsePropertyValue(value.kind === "civil" ? civil : instant, value)).toThrow();
    expect(() =>
      parsePropertyValue(civil, {
        kind: "instant",
        start: "2024-01-01T00:00:00Z",
        end: null,
        timeZone: "UTC",
      }),
    ).toThrow();
  });

  it("requires one title, stable unique option identities and known strict configuration", () => {
    expect(databaseSchemaSchema.parse([title(), property("text", {}, 2)])).toHaveLength(2);
    for (const input of [[], [property("text")], [title(), title()]])
      expect(() => databaseSchemaSchema.parse(input)).toThrow();
    expect(() =>
      property("select", { options: [option, { ...option, id: option.id.toUpperCase() }] }),
    ).toThrow();
    expect(() => parsePropertyValue(property("select", { options: [option] }), id(91))).toThrow();
    expect(() => parsePropertyValue(property("person"), [id(2), id(2).toUpperCase()])).toThrow();
    expect(() => property("relation", { targetDatabaseId: id(99), sql: "DROP TABLE" })).toThrow();
    expect(() => parsePropertyValue(property("text"), "x".repeat(17000))).toThrow();
    expect(() => parsePropertyValue(property("text"), "\uD800")).toThrow();
    expect(() => parsePropertyValue(property("url"), "javascript:alert(1)")).toThrow();
    expect(defaultPropertyValue(property("checkbox"))).toBe(false);
    expect(defaultPropertyValue(property("person"))).toEqual([]);
    expect(() => parsePropertyWrite(property("createdTime"), "2026-10-26T12:00:00Z")).toThrow();
  });
});

describe("bounded filters, views and cursors", () => {
  const amount = property("number", {}, 2);
  const checked = property("checkbox", {}, 3);
  const tags = property("multiSelect", { options: [option] }, 4);
  const properties = [title(), amount, checked, tags];
  const condition = (propertyId: string, operator: string, value?: unknown) => ({
    kind: "condition",
    propertyId,
    operator,
    ...(value === undefined ? {} : { value }),
  });

  it("defines negation over null and set membership explicitly, preserving zero and false", () => {
    const filter = parseFilter(
      {
        kind: "and",
        children: [
          condition(amount.id, "eq", "0"),
          condition(checked.id, "eq", false),
          condition(tags.id, "containsNone", [option.id]),
        ],
      },
      properties,
    );
    expect(evaluateFilter(filter, { [amount.id]: "0", [checked.id]: false, [tags.id]: [] }, properties)).toBe(
      true,
    );
    expect(evaluateFilter(parseFilter(condition(amount.id, "neq", "1"), properties), {}, properties)).toBe(
      false,
    );
    expect(
      evaluateFilter(
        parseFilter(condition(tags.id, "containsNone", [option.id]), properties),
        {},
        properties,
      ),
    ).toBe(true);
    expect(
      evaluateFilter(
        parseFilter(condition(checked.id, "isEmpty"), properties),
        { [checked.id]: false },
        properties,
      ),
    ).toBe(false);
  });

  it("rejects removed properties, invalid operators, excess depth and more than fifty conditions", () => {
    expect(() => parseFilter(condition(id(88), "eq", "1"), properties)).toThrow();
    expect(() => parseFilter(condition(amount.id, "contains", "1"), properties)).toThrow();
    let nested: unknown = condition(amount.id, "eq", "1");
    for (let depth = 0; depth < 4; depth++) nested = { kind: "and", children: [nested] };
    expect(parseFilter(nested, properties).kind).toBe("and");
    nested = { kind: "and", children: [nested] };
    expect(() => parseFilter(nested, properties)).toThrow();
    expect(() =>
      parseFilter(
        { kind: "or", children: Array.from({ length: 51 }, () => condition(amount.id, "eq", "1")) },
        properties,
      ),
    ).toThrow();
  });

  it("validates the five views and compatible grouping without silently dropping removed fields", () => {
    const base = {
      id: id(10),
      name: "View",
      visibleProperties: [id(1)],
      sorts: [],
      filter: null,
      groupBy: null,
      datePropertyId: null,
    };
    for (const type of ["table", "list", "gallery"])
      expect(parseView({ ...base, type }, properties).type).toBe(type);
    expect(parseView({ ...base, type: "board", groupBy: checked.id }, properties).type).toBe("board");
    const date = property("date", { mode: "civil" }, 5);
    expect(
      parseView({ ...base, type: "calendar", datePropertyId: date.id }, [...properties, date]).type,
    ).toBe("calendar");
    expect(() => parseView({ ...base, type: "board", groupBy: tags.id }, properties)).toThrow();
    expect(() => parseView({ ...base, type: "calendar", datePropertyId: amount.id }, properties)).toThrow();
    expect(() => parseView({ ...base, type: "table", visibleProperties: [id(88)] }, properties)).toThrow();
  });

  it("compares exact decimals, keeps null last in both directions and breaks ties by stable ID", () => {
    const record = (number: number, value: string | null) => ({
      id: id(number),
      position: "a0",
      values: { [amount.id]: value },
    });
    const asc = [{ propertyId: amount.id, direction: "asc" as const }];
    const desc = [{ propertyId: amount.id, direction: "desc" as const }];
    expect(
      compareRecords(record(6, "9007199254740993"), record(5, "9007199254740992"), properties, asc),
    ).toBeGreaterThan(0);
    for (const sorts of [asc, desc])
      expect(compareRecords(record(1, null), record(2, "0"), properties, sorts)).toBeGreaterThan(0);
    expect(compareRecords(record(1, "0"), record(2, "0"), properties, desc)).toBeLessThan(0);
    const queryKey = "a".repeat(64);
    const cursor = {
      version: 1,
      viewId: id(10),
      revision: 2,
      queryKey,
      recordId: id(1),
      position: "a0",
      keys: ["0"],
    };
    const context = { viewId: id(10), revision: 2, queryKey, sorts: asc, properties };
    expect(parseCursor(cursor, context).keys).toEqual(["0"]);
    expect(() => parseCursor(cursor, { ...context, viewId: id(11) })).toThrow();
    expect(() => parseCursor({ ...cursor, revision: 1 }, context)).toThrow();
    expect(() => parseCursor({ ...cursor, queryKey: "b".repeat(64) }, context)).toThrow();
    expect(() => parseCursor({ ...cursor, keys: ["invalid"] }, context)).toThrow();
    expect(compareText("\uE000", "😀")).toBeLessThan(0);
    const view = { filter: null, sorts: asc, groupBy: null };
    expect(serializeDatabaseQuery(view, properties)).toBe(
      serializeDatabaseQuery(view, [...properties].reverse()),
    );
  });
});
