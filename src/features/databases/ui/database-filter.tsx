"use client";

import { useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import {
  allowedFilterOperators,
  type Filter,
  type FilterCondition,
  type FilterOperator,
  type PropertyDefinition,
  type PropertyValue,
} from "../model";
import type { DatabaseData } from "../types";
import { ValueInput } from "./database-value";

function count(filter: Filter | null): number {
  return filter === null
    ? 0
    : filter.kind === "condition"
      ? 1
      : filter.children.reduce((total, child) => total + count(child), 0);
}
function condition(property: PropertyDefinition): FilterCondition {
  return { kind: "condition", propertyId: property.id, operator: "isNotEmpty" };
}
function operand(property: PropertyDefinition): PropertyValue {
  if (property.type === "checkbox") return false;
  if (property.type === "number") return "0";
  if (property.type === "select") return property.config.options[0]?.id ?? null;
  if (["multiSelect", "person", "relation"].includes(property.type)) return [];
  if (property.type === "date")
    return property.config.mode === "civil"
      ? { kind: "civil", start: new Date().toISOString().slice(0, 10), end: null }
      : { kind: "instant", start: new Date().toISOString(), end: null, timeZone: "UTC" };
  if (property.type === "createdTime" || property.type === "editedTime") return new Date().toISOString();
  return "";
}
export function FilterBuilder({
  data,
  value,
  onChange,
}: {
  data: DatabaseData;
  value: Filter | null;
  onChange: (value: Filter | null) => void;
}) {
  const t = useTranslations();

  const OPERATORS: Record<FilterOperator, string> = {
    eq: t("database.filterEqual"),
    neq: t("database.filterDifferent"),
    contains: t("database.filterContains"),
    startsWith: t("database.filterStarts"),
    lt: t("database.filterLess"),
    lte: t("database.filterLessEqual"),
    gt: t("database.filterGreater"),
    gte: t("database.filterGreaterEqual"),
    before: t("database.filterBefore"),
    after: t("database.filterAfter"),
    between: t("database.filterBetween"),
    containsAny: t("database.filterAny"),
    containsAll: t("database.filterAll"),
    containsNone: t("database.filterNone"),
    isEmpty: t("database.filterEmpty"),
    isNotEmpty: t("database.filterNotEmpty"),
  };

  const [identities] = useState(() => new WeakMap<Filter, string>());
  const identity = (item: Filter) => {
    let id = identities.get(item);
    if (!id) {
      id = crypto.randomUUID();
      identities.set(item, id);
    }
    return id;
  };
  const first = data.properties[0];
  const total = count(value);
  const node = (filter: Filter, depth: number, update: (next: Filter | null) => void): React.ReactNode => {
    if (filter.kind !== "condition")
      return (
        <fieldset className="db-filter-group">
          <legend>{t("database.filterGroup")}</legend>
          <select
            aria-label={t("database.combineConditions")}
            value={filter.kind}
            onChange={(event) => update({ ...filter, kind: event.target.value === "or" ? "or" : "and" })}
          >
            <option value="and">{t("database.allConditions")}</option>
            <option value="or">{t("database.anyConditions")}</option>
          </select>
          {filter.children.map((child, index) => (
            <div key={identity(child)}>
              {node(child, depth + 1, (next) => {
                if (next) identities.set(next, identity(child));
                const children = next
                  ? filter.children.map((item, at) => (at === index ? next : item))
                  : filter.children.filter((_, at) => at !== index);
                update(children.length ? { ...filter, children } : null);
              })}
            </div>
          ))}
          <div className="db-actions">
            <button
              type="button"
              disabled={!first || total >= 50 || depth >= 5}
              onClick={() => {
                if (first) update({ ...filter, children: [...filter.children, condition(first)] });
              }}
            >
              {t("database.addCondition")}
            </button>
            <button
              type="button"
              disabled={!first || total >= 50 || depth >= 4}
              onClick={() => {
                if (first)
                  update({
                    ...filter,
                    children: [...filter.children, { kind: "or", children: [condition(first)] }],
                  });
              }}
            >
              {t("database.addGroup")}
            </button>
            <button type="button" onClick={() => update(null)}>
              {t("database.removeGroup")}
            </button>
          </div>
        </fieldset>
      );
    const property = data.properties.find((item) => item.id === filter.propertyId);
    const empty = filter.operator === "isEmpty" || filter.operator === "isNotEmpty";
    const inputProperty: PropertyDefinition | undefined =
      property && (property.type === "createdTime" || property.type === "editedTime")
        ? { id: property.id, name: property.name, type: "date", config: { mode: "instant" } }
        : property;
    const inputValue =
      property &&
      (property.type === "createdTime" || property.type === "editedTime") &&
      typeof filter.value === "string"
        ? { kind: "instant" as const, start: filter.value, end: null, timeZone: "UTC" }
        : (filter.value ?? null);
    return (
      <fieldset className="db-filter-condition">
        <legend>{t("database.condition")}</legend>
        <select
          aria-label={t("database.filterProperty")}
          value={filter.propertyId}
          onChange={(event) => {
            const selected = data.properties.find((item) => item.id === event.target.value);
            if (selected) update(condition(selected));
          }}
        >
          {!property && <option value={filter.propertyId}>{t("database.removedFilter")}</option>}
          {data.properties.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {property ? (
          <>
            <select
              aria-label={t("database.filterOperator")}
              value={filter.operator}
              onChange={(event) => {
                const operator = event.target.value as FilterOperator;
                update(
                  operator === "isEmpty" || operator === "isNotEmpty"
                    ? { kind: "condition", propertyId: property.id, operator }
                    : { ...filter, operator, value: operand(property) },
                );
              }}
            >
              {allowedFilterOperators(property).map((operator) => (
                <option key={operator} value={operator}>
                  {OPERATORS[operator]}
                </option>
              ))}
            </select>
            {!empty && inputProperty && (
              <ValueInput
                property={inputProperty}
                value={inputValue}
                people={data.people}
                references={data.references}
                onChange={(next) =>
                  update({
                    ...filter,
                    value:
                      (property.type === "createdTime" || property.type === "editedTime") &&
                      filter.operator !== "between" &&
                      next &&
                      typeof next === "object" &&
                      !Array.isArray(next)
                        ? next.start
                        : next,
                  })
                }
              />
            )}
          </>
        ) : (
          <p role="alert">{t("database.chooseValidFilter")}</p>
        )}
        <button type="button" onClick={() => update(null)}>
          {t("database.removeCondition")}
        </button>
      </fieldset>
    );
  };
  return (
    <div className="db-filter-builder">
      <p>{t("database.filterLimits")}</p>
      {value ? (
        node(value, 1, onChange)
      ) : (
        <button
          type="button"
          disabled={!first}
          onClick={() => {
            if (first) onChange({ kind: "and", children: [condition(first)] });
          }}
        >
          {t("database.addFilter")}
        </button>
      )}
    </div>
  );
}
