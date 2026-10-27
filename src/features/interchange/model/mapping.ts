import {
  type PropertyDefinition,
  type PropertyValue,
  parsePropertyValue,
  propertyDefinitionSchema,
} from "@/features/databases/model";
import { type ColumnMapping, type CsvMapping, csvMappingSchema } from "./contracts";

export function defaultCsvMapping(path: string, header: readonly string[]): CsvMapping {
  return {
    path,
    columns: header.map((name, index) => ({
      index,
      name: name.trim().slice(0, 120) || `Campo ${index + 1}`,
      type: index === 0 ? "title" : "text",
      config: {},
    })),
  };
}
export function validateCsvMapping(input: unknown, header: readonly string[]): CsvMapping {
  const mapping = csvMappingSchema.parse(input);
  if (
    mapping.columns.filter((column) => column.type === "title").length !== 1 ||
    new Set(mapping.columns.map((column) => column.index)).size !== mapping.columns.length ||
    mapping.columns.some((column) => column.index >= header.length)
  )
    throw Error("Invalid CSV column mapping");
  return mapping;
}
export function mappingProperty(column: ColumnMapping, id: string): PropertyDefinition {
  return propertyDefinitionSchema.parse({
    id,
    name: column.name,
    type: ["createdTime", "editedTime"].includes(column.type) ? "text" : column.type,
    config: ["createdTime", "editedTime"].includes(column.type) ? {} : column.config,
  });
}
export function mappedCsvValue(column: ColumnMapping, input: string, id: string): PropertyValue {
  const property = mappingProperty(column, id);
  if (property.type === "text" || property.type === "title") return parsePropertyValue(property, input);
  if (!input)
    return property.type === "checkbox"
      ? false
      : ["person", "relation", "multiSelect"].includes(property.type)
        ? []
        : null;
  if (property.type === "checkbox") {
    if (!/^(true|false)$/i.test(input)) throw Error("Ambiguous checkbox");
    return input.toLowerCase() === "true";
  }
  if (property.type === "date") {
    const value = input.startsWith("{")
      ? JSON.parse(input)
      : property.config.mode === "civil"
        ? { kind: "civil", start: input, end: null }
        : { kind: "instant", start: input, end: null, timeZone: "UTC" };
    return parsePropertyValue(property, value);
  }
  if (property.type === "select") {
    const matches = property.config.options.filter(
      (option) => option.id.toLowerCase() === input.toLowerCase() || option.label === input,
    );
    if (matches.length !== 1) throw Error("Ambiguous option");
    return matches[0]?.id ?? null;
  }
  if (["multiSelect", "person", "relation"].includes(property.type)) {
    let values: unknown = JSON.parse(input);
    if (property.type === "multiSelect" && Array.isArray(values))
      values = values.map((value) => {
        const matches = property.config.options.filter(
          (option) => option.id === value || option.label === value,
        );
        if (matches.length !== 1) throw Error("Ambiguous option");
        return matches[0]?.id;
      });
    return parsePropertyValue(property, values);
  }
  return parsePropertyValue(property, input);
}
