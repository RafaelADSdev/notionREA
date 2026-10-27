"use client";

import { useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { type DatabaseView, parseView, type ViewType, viewTypes } from "../model";
import type { DatabaseData, SavedDatabaseView, ViewConfiguration } from "../types";
import { DatabaseDialog } from "./database-dialog";
import type { RunCommand } from "./database-value";
import { viewLabels } from "./value-utils";

export function ViewDialog({
  data,
  source,
  duplicate = false,
  run,
  onClose,
}: {
  data: DatabaseData;
  source: SavedDatabaseView | null;
  duplicate?: boolean;
  run: RunCommand;
  onClose: () => void;
}) {
  const t = useTranslations();
  const VIEW_LABELS = viewLabels(t);

  const [name, setName] = useState(
    source ? `${source.name}${duplicate ? t("database.copySuffix") : ""}` : t("database.newView"),
  );
  const [type, setType] = useState<ViewType>(source?.type ?? "table");
  const [visible, setVisible] = useState(
    source?.visibleProperties ?? data.properties.map((property) => property.id),
  );
  const [group, setGroup] = useState(source?.groupBy ?? "");
  const [date, setDate] = useState(source?.datePropertyId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const groups = data.properties.filter((property) =>
    (type === "board" ? ["select", "checkbox"] : ["select", "multiSelect", "checkbox", "person"]).includes(
      property.type,
    ),
  );
  const move = (index: number, direction: number) => {
    const next = [...visible];
    const current = next[index];
    const other = next[index + direction];
    if (current && other) {
      next[index] = other;
      next[index + direction] = current;
      setVisible(next);
    }
  };
  return (
    <DatabaseDialog
      title={
        source ? (duplicate ? t("database.duplicateView") : t("database.editView")) : t("database.newView")
      }
      onClose={onClose}
    >
      <form
        className="db-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const submit = async () => {
            setPending(true);
            try {
              const config: ViewConfiguration = {
                visibleProperties: visible,
                sorts: source?.sorts ?? [],
                filter: source?.filter ?? null,
                groupBy: type === "calendar" ? null : group || null,
                datePropertyId: type === "calendar" ? date || null : null,
              };
              const parsed: DatabaseView = parseView(
                { id: source?.id ?? crypto.randomUUID(), name, type, ...config },
                data.properties,
              );
              const result = await run({
                action: "view",
                id: source && !duplicate ? source.id : null,
                name: parsed.name,
                type,
                config,
                expectedRevision: source && !duplicate ? source.revision : 0,
              });
              if (result.ok) onClose();
              else setError(t("database.saveViewFailed"));
            } catch {
              setError(t("database.checkView"));
            } finally {
              setPending(false);
            }
          };
          void submit();
        }}
      >
        <label>
          {t("database.viewName")}
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {t("common.type")}
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as ViewType);
              setGroup("");
            }}
          >
            {viewTypes.map((item) => (
              <option key={item} value={item}>
                {VIEW_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        {type !== "calendar" && (
          <label>
            {t("database.groupBy")}
            <select
              value={group}
              required={type === "board"}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="">
                {type === "board" ? t("database.chooseBoardGrouping") : t("database.noGrouping")}
              </option>
              {groups.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === "board" && !groups.length && <p>{t("database.createBoardProperty")}</p>}
        {type === "calendar" && (
          <label>
            {t("database.dateProperty")}
            <select required value={date} onChange={(event) => setDate(event.target.value)}>
              <option value="">{t("database.chooseDate")}</option>
              {data.properties
                .filter((property) => property.type === "date")
                .map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <fieldset>
          <legend>{t("database.visibleProperties")}</legend>
          {data.properties.map((property) => (
            <label key={property.id}>
              <input
                type="checkbox"
                checked={visible.includes(property.id)}
                onChange={(event) =>
                  setVisible(
                    event.target.checked
                      ? [...visible, property.id]
                      : visible.filter((id) => id !== property.id),
                  )
                }
              />
              {property.name}
            </label>
          ))}
        </fieldset>
        <ol className="db-property-order">
          {visible.map((id, index) => (
            <li key={id}>
              {data.properties.find((property) => property.id === id)?.name ?? t("database.removedProperty")}
              <button
                type="button"
                disabled={index === 0}
                aria-label={t("database.movePropertyUp", { number: index + 1 })}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === visible.length - 1}
                aria-label={t("database.movePropertyDown", { number: index + 1 })}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        {error && <p role="alert">{error}</p>}
        <div className="db-actions">
          <button disabled={pending} type="submit">
            {t("database.saveView")}
          </button>
          <button type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </DatabaseDialog>
  );
}
