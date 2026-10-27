"use client";

import { useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { type DatabaseSort, type Filter, parseFilter, parseView } from "../model";
import type { DatabaseData, DatabaseQuery, SavedDatabaseView } from "../types";
import { FilterBuilder } from "./database-filter";
import type { RunCommand } from "./database-value";

export function QueryPanel({
  data,
  view,
  current,
  onApply,
  run,
}: {
  data: DatabaseData;
  view: SavedDatabaseView;
  current: DatabaseQuery;
  onApply: (query: DatabaseQuery) => Promise<void>;
  run: RunCommand;
}) {
  const t = useTranslations();

  const [filter, setFilter] = useState<Filter | null>(
    current.filter === undefined ? view.filter : current.filter,
  );
  const [sorts, setSorts] = useState<DatabaseSort[]>(current.sorts ?? view.sorts);
  const [groupBy, setGroupBy] = useState(current.groupBy === undefined ? view.groupBy : current.groupBy);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const groups = data.properties.filter((property) =>
    (view.type === "board"
      ? ["select", "checkbox"]
      : ["select", "multiSelect", "checkbox", "person"]
    ).includes(property.type),
  );
  const apply = async (persist: boolean) => {
    setError("");
    setPending(true);
    try {
      const parsedFilter = filter ? parseFilter(filter, data.properties) : null;
      const next = {
        ...view,
        filter: parsedFilter,
        sorts,
        groupBy: view.type === "calendar" ? null : groupBy,
      };
      parseView(
        {
          id: view.id,
          name: view.name,
          type: view.type,
          visibleProperties: view.visibleProperties,
          datePropertyId: view.datePropertyId,
          filter: next.filter,
          sorts: next.sorts,
          groupBy: next.groupBy,
        },
        data.properties,
      );
      if (persist) {
        const result = await run({
          action: "view",
          id: view.id,
          name: view.name,
          type: view.type,
          expectedRevision: view.revision,
          config: {
            visibleProperties: view.visibleProperties,
            datePropertyId: view.datePropertyId,
            filter: parsedFilter,
            sorts,
            groupBy: next.groupBy,
          },
        });
        if (!result.ok) throw new Error("Configuration not accepted");
      }
      await onApply({ filter: parsedFilter, sorts, groupBy: next.groupBy, cursor: null });
    } catch {
      setError(t("database.queryInvalid"));
    } finally {
      setPending(false);
    }
  };
  return (
    <details className="db-panel">
      <summary>{t("database.queryPanel")}</summary>
      <p>{t("database.temporaryFilters")}</p>
      <FilterBuilder data={data} value={filter} onChange={setFilter} />
      <fieldset className="db-sorts">
        <legend>{t("database.sortPriority")}</legend>
        {sorts.map((sort, index) => (
          <div key={sort.propertyId} className="db-sort-row">
            <select
              aria-label={t("database.sortPropertyNumber", { number: index + 1 })}
              value={sort.propertyId}
              onChange={(event) =>
                setSorts(
                  sorts.map((item, at) =>
                    at === index ? { ...item, propertyId: event.target.value } : item,
                  ),
                )
              }
            >
              {data.properties.map((property) => (
                <option
                  key={property.id}
                  disabled={sorts.some((item, at) => at !== index && item.propertyId === property.id)}
                  value={property.id}
                >
                  {property.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("database.sortDirectionNumber", { number: index + 1 })}
              value={sort.direction}
              onChange={(event) =>
                setSorts(
                  sorts.map((item, at) =>
                    at === index
                      ? { ...item, direction: event.target.value === "desc" ? "desc" : "asc" }
                      : item,
                  ),
                )
              }
            >
              <option value="asc">{t("database.ascending")}</option>
              <option value="desc">{t("database.descending")}</option>
            </select>
            <button
              type="button"
              disabled={index === 0}
              aria-label={t("database.prioritizeSortNumber", { number: index + 1 })}
              onClick={() => {
                const next = [...sorts];
                const previous = next[index - 1];
                if (previous) {
                  next[index - 1] = sort;
                  next[index] = previous;
                  setSorts(next);
                }
              }}
            >
              ↑
            </button>
            <button type="button" onClick={() => setSorts(sorts.filter((_, at) => at !== index))}>
              {t("database.removeSort")}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={sorts.length >= 10 || sorts.length >= data.properties.length}
          onClick={() => {
            const property = data.properties.find(
              (item) => !sorts.some((sort) => sort.propertyId === item.id),
            );
            if (property) setSorts([...sorts, { propertyId: property.id, direction: "asc" }]);
          }}
        >
          {t("database.addSort")}
        </button>
      </fieldset>
      {view.type !== "calendar" && (
        <label>
          {t("database.groupBy")}
          <select value={groupBy ?? ""} onChange={(event) => setGroupBy(event.target.value || null)}>
            <option value="">{t("database.noGrouping")}</option>
            {groups.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="db-actions">
        <button type="button" disabled={pending} onClick={() => void apply(false)}>
          {t("database.applySession")}
        </button>
        {data.editable && (
          <button type="button" disabled={pending} onClick={() => void apply(true)}>
            {t("database.saveViewQuery")}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setFilter(view.filter);
            setSorts(view.sorts);
            setGroupBy(view.groupBy);
            void onApply({
              filter: view.filter,
              sorts: view.sorts,
              groupBy: view.groupBy,
              cursor: null,
            }).catch(() => setError(t("database.restoreQueryFailed")));
          }}
        >
          {t("database.restoreSavedQuery")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
