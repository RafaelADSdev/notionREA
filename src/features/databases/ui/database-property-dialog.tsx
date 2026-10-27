"use client";

import { useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import {
  type DatabaseOption,
  optionColors,
  type PropertyDefinition,
  propertyDefinitionSchema,
  propertyTypes,
} from "../model";
import type { DatabaseCommand, DatabaseCommandResult, DatabaseData, DatabaseProperty } from "../types";
import { DatabaseDialog } from "./database-dialog";
import type { RunCommand } from "./database-value";
import { propertyLabels } from "./value-utils";

export function PropertyDialog({
  data,
  property,
  run,
  onClose,
}: {
  data: DatabaseData;
  property: DatabaseProperty | null;
  run: RunCommand;
  onClose: () => void;
}) {
  const t = useTranslations();
  const PROPERTY_LABELS = propertyLabels(t);

  const [name, setName] = useState(property?.name ?? "");
  const [type, setType] = useState<PropertyDefinition["type"]>(property?.type ?? "text");
  const [options, setOptions] = useState<DatabaseOption[]>(
    property?.type === "select" || property?.type === "multiSelect" ? property.config.options : [],
  );
  const [mode, setMode] = useState<"civil" | "instant">(
    property?.type === "date" ? property.config.mode : "civil",
  );
  const [target, setTarget] = useState(
    property?.type === "relation" ? property.config.targetDatabaseId : (data.databases[0]?.id ?? ""),
  );
  const [preview, setPreview] = useState<{ command: DatabaseCommand; result: DatabaseCommandResult } | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const send = async (command: DatabaseCommand) => {
    setPending(true);
    setError("");
    try {
      const result = await run(command);
      if (result.requiresConfirmation && result.previewToken) {
        setPreview({ command, result });
        setConfirmed(false);
      } else if (result.ok) onClose();
      else setError(t("database.changePropertyFailed"));
    } catch {
      setError(t("database.changePropertyRetry"));
    } finally {
      setPending(false);
    }
  };
  const save = () => {
    try {
      const config =
        type === "select" || type === "multiSelect"
          ? { options }
          : type === "date"
            ? { mode }
            : type === "relation"
              ? { targetDatabaseId: target }
              : {};
      const parsed = propertyDefinitionSchema.parse({
        id: property?.id ?? crypto.randomUUID(),
        name,
        type,
        config,
      });
      void send({
        action: "property",
        id: property?.id ?? null,
        name: parsed.name,
        type: parsed.type,
        config: parsed.config,
        expectedRevision: property?.revision ?? 0,
      });
    } catch {
      setError(t("database.checkProperty"));
    }
  };
  const reorder = (index: number, direction: number) => {
    const next = [...options];
    const option = next[index];
    const other = next[index + direction];
    if (option && other) {
      next[index] = other;
      next[index + direction] = option;
      setOptions(next);
    }
  };
  return (
    <DatabaseDialog
      title={property ? t("database.editProperty") : t("database.newProperty")}
      onClose={onClose}
    >
      {preview ? (
        <div className="db-property-preview">
          <h3>{t("database.confirmChange")}</h3>
          <p>
            {preview.result.valueCount ?? 0} {t("database.valuesConsidered")}{" "}
            {preview.result.incompatibleCount ?? 0} {t("database.valuesCleared")}
          </p>
          {!!preview.result.dependentViews?.length && (
            <p>
              {t("database.dependentViews")} {preview.result.dependentViews.join(", ")}.
            </p>
          )}
          <p>{t("database.changeSchemaNotice")}</p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("database.confirmScope")}
          </label>
          <div className="db-actions">
            <button
              type="button"
              disabled={!confirmed || pending}
              onClick={() =>
                void send({
                  ...preview.command,
                  confirm: true,
                  previewToken: preview.result.previewToken,
                } as DatabaseCommand)
              }
            >
              {t("database.confirmChange")}
            </button>
            <button type="button" disabled={pending} onClick={() => setPreview(null)}>
              {t("common.back")}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="db-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label>
            {t("database.propertyName")}
            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            {t("common.type")}
            <select
              value={type}
              disabled={property?.type === "title"}
              onChange={(event) => setType(event.target.value as PropertyDefinition["type"])}
            >
              {propertyTypes
                .filter((item) => item !== "title" || property?.type === "title")
                .map((item) => (
                  <option key={item} value={item}>
                    {PROPERTY_LABELS[item]}
                  </option>
                ))}
            </select>
          </label>
          {(type === "select" || type === "multiSelect") && (
            <fieldset className="db-property-options">
              <legend>{t("database.options")}</legend>
              {options.map((option, index) => (
                <div key={option.id} className="db-option" data-color={option.color}>
                  <input
                    aria-label={t("database.optionNameNumber", { number: index + 1 })}
                    required
                    maxLength={120}
                    value={option.label}
                    onChange={(event) =>
                      setOptions(
                        options.map((item) =>
                          item.id === option.id ? { ...item, label: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={t("database.optionColorNumber", { number: index + 1 })}
                    value={option.color}
                    onChange={(event) =>
                      setOptions(
                        options.map((item) =>
                          item.id === option.id
                            ? { ...item, color: event.target.value as DatabaseOption["color"] }
                            : item,
                        ),
                      )
                    }
                  >
                    {optionColors.map((color) => (
                      <option key={color} value={color}>
                        {
                          {
                            default: t("colors.default"),
                            indigo: t("colors.indigo"),
                            copper: t("colors.copper"),
                            green: t("colors.green"),
                            red: t("colors.red"),
                            yellow: t("colors.yellow"),
                          }[color]
                        }
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => reorder(index, -1)}
                    aria-label={t("database.moveOptionUp", { number: index + 1 })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === options.length - 1}
                    onClick={() => reorder(index, 1)}
                    aria-label={t("database.moveOptionDown", { number: index + 1 })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptions(options.filter((item) => item.id !== option.id))}
                  >
                    {t("database.removeOption")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={options.length >= 500}
                onClick={() =>
                  setOptions([
                    ...options,
                    { id: crypto.randomUUID(), label: t("database.newOption"), color: "default" },
                  ])
                }
              >
                {t("database.addOption")}
              </button>
            </fieldset>
          )}
          {type === "date" && (
            <label>
              {t("database.dateSemantics")}
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value === "instant" ? "instant" : "civil")}
              >
                <option value="civil">{t("database.civilDate")}</option>
                <option value="instant">{t("database.dateTimeZone")}</option>
              </select>
            </label>
          )}
          {type === "relation" && (
            <label>
              {t("database.targetDatabase")}
              <select required value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">{t("database.chooseDatabase")}</option>
                {data.databases.map((database) => (
                  <option key={database.id} value={database.id}>
                    {database.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="db-actions">
            <button disabled={pending} type="submit">
              {pending ? "Verificando…" : t("database.saveProperty")}
            </button>
            <button type="button" disabled={pending} onClick={onClose}>
              {t("common.cancel")}
            </button>
            {property && property.type !== "title" && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void send({
                    action: "deleteProperty",
                    id: property.id,
                    expectedRevision: property.revision,
                  })
                }
              >
                {t("database.removeProperty")}
              </button>
            )}
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </DatabaseDialog>
  );
}
