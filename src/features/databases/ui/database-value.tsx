"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import {
  DATABASE_MODEL_LIMITS,
  type DateValue,
  isSystemProperty,
  type PropertyDefinition,
  type PropertyValue,
  parsePropertyWrite,
} from "../model";
import type {
  DatabaseCommand,
  DatabaseCommandResult,
  DatabaseData,
  DatabaseProperty,
  DatabaseReference,
  DatabaseRow,
} from "../types";
import { PeoplePicker } from "./database-people-picker";
import { RelationPicker } from "./database-reference-picker";
import { displayValue, rowValue } from "./value-utils";

export type RunCommand = (command: DatabaseCommand) => Promise<DatabaseCommandResult>;
type ValueProps = {
  property: PropertyDefinition;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  people: DatabaseReference[];
  references: DatabaseReference[];
  disabled?: boolean;
};
export function ValueInput({ property, value, onChange, people, references, disabled }: ValueProps) {
  const t = useTranslations();

  if (isSystemProperty(property)) return <output>{t("database.systemValue")}</output>;
  if (property.type === "checkbox")
    return (
      <label>
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />{" "}
        {t("database.checked")}
      </label>
    );
  if (property.type === "select")
    return (
      <select
        aria-label={property.name}
        disabled={disabled}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{t("database.noValue")}</option>
        {property.config.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  if (property.type === "relation")
    return (
      <RelationPicker
        name={property.name}
        targetDatabaseId={property.config.targetDatabaseId}
        initial={references}
        selected={Array.isArray(value) ? value : []}
        disabled={disabled ?? false}
        onChange={onChange}
      />
    );
  if (property.type === "person")
    return (
      <PeoplePicker
        name={property.name}
        initial={people}
        selected={Array.isArray(value) ? value : []}
        disabled={disabled ?? false}
        onChange={onChange}
      />
    );
  if (property.type === "multiSelect") {
    const choices = property.config.options;
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="db-set-picker" disabled={disabled}>
        <legend>{property.name}</legend>
        {choices.map((choice) => (
          <label key={choice.id}>
            <input
              type="checkbox"
              checked={selected.includes(choice.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...selected, choice.id] : selected.filter((id) => id !== choice.id),
                )
              }
            />
            {choice.label}
          </label>
        ))}
        {selected
          .filter((id) => !choices.some((choice) => choice.id === id))
          .map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked
                onChange={() => onChange(selected.filter((item) => item !== id))}
              />
              {t("editor.referenceUnavailable")}
            </label>
          ))}
        {!choices.length && <p>{t("database.noOptions")}</p>}
      </fieldset>
    );
  }
  if (property.type === "date") {
    const date = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    const kind = property.config.mode;
    const update = (patch: Partial<DateValue>) =>
      onChange({
        kind,
        start: date?.start ?? "",
        end: date?.end ?? null,
        ...(kind === "instant"
          ? {
              timeZone:
                date?.kind === "instant" ? date.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : {}),
        ...patch,
      } as DateValue);
    return (
      <fieldset className="db-date-input" disabled={disabled}>
        <legend>{property.name}</legend>
        <label>
          {kind === "civil" ? t("database.startDay") : t("database.startInstant")}
          <input
            type={kind === "civil" ? "date" : "text"}
            value={date?.start ?? ""}
            placeholder={kind === "instant" ? "2026-10-26T09:00:00-03:00" : undefined}
            onChange={(event) =>
              event.target.value ? update({ start: event.target.value }) : onChange(null)
            }
          />
        </label>
        <label>
          {kind === "civil" ? t("database.endDay") : t("database.endInstant")}
          <input
            type={kind === "civil" ? "date" : "text"}
            value={date?.end ?? ""}
            onChange={(event) => update({ end: event.target.value || null })}
          />
        </label>
        {kind === "instant" && (
          <label>
            {t("database.timeZone")}
            <input
              value={
                date?.kind === "instant" ? date.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone
              }
              onChange={(event) => update({ timeZone: event.target.value } as Partial<DateValue>)}
            />
          </label>
        )}
      </fieldset>
    );
  }
  if (property.type === "text")
    return (
      <>
        <textarea
          aria-label={property.name}
          disabled={disabled}
          maxLength={DATABASE_MODEL_LIMITS.textLength}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
        <small>
          {t("database.upTo")} {DATABASE_MODEL_LIMITS.textLength.toLocaleString(t.locale)}{" "}
          {t("database.characters")}
        </small>
      </>
    );
  return (
    <input
      aria-label={property.name}
      disabled={disabled ?? false}
      type={property.type === "url" ? "url" : "text"}
      inputMode={property.type === "number" ? "decimal" : undefined}
      maxLength={property.type === "title" ? 500 : property.type === "url" ? 2048 : 160}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function DatabaseCell({
  row,
  property,
  data,
  run,
  onRefresh,
  onOpen,
}: {
  row: DatabaseRow;
  property: DatabaseProperty;
  data: DatabaseData;
  run: RunCommand;
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PropertyValue>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const latest = useRef(row);
  useEffect(() => {
    latest.current = row;
  }, [row]);
  const form = useRef<HTMLFormElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const value = rowValue(row, property);
  const editable = data.editable && !isSystemProperty(property);
  useEffect(() => {
    if (editing) form.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
  }, [editing]);
  const close = () => {
    setEditing(false);
    setError("");
    trigger.current?.focus();
  };
  const save = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const input =
        property.type === "number" && typeof draft === "string" ? draft.trim().replace(",", ".") : draft;
      const parsed = parsePropertyWrite(property, input);
      const result = await run({
        action: "cell",
        recordId: row.id,
        propertyId: property.id,
        value: parsed,
        expectedRevision: revision.current,
      });
      if (!result.ok) {
        setError(t("database.saveCellFailed"));
        return;
      }
      close();
    } catch {
      setError(t("database.invalidValue"));
    } finally {
      setPending(false);
    }
  };
  if (editing)
    return (
      <form
        ref={form}
        className="db-cell-editor"
        aria-label={`${t("common.edit")} ${property.name}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.altKey) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (
            event.key === "Enter" &&
            !(event.target instanceof HTMLTextAreaElement) &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <ValueInput
          property={property}
          value={draft}
          onChange={setDraft}
          people={data.people}
          references={data.references}
          disabled={pending}
        />
        {error && (
          <p role="alert">
            {error}
            <button
              type="button"
              onClick={() => {
                void onRefresh()
                  .then(() => {
                    revision.current =
                      latest.current.cellRevisions[property.id] ??
                      (property.type === "title" ? latest.current.revision : 0);
                  })
                  .catch(() => setError(t("database.refreshDraftFailed")));
              }}
            >
              {t("common.refreshData")}
            </button>
          </p>
        )}
        <div className="db-actions">
          <button disabled={pending} type="submit">
            {pending ? t("common.saving") : t("common.save")}
          </button>
          <button disabled={pending} type="button" onClick={close}>
            {t("common.cancel")}
          </button>
          {property.type !== "title" && property.type !== "checkbox" && (
            <button
              type="button"
              onClick={() =>
                setDraft(["multiSelect", "person", "relation"].includes(property.type) ? [] : null)
              }
            >
              {t("database.clearValue")}
            </button>
          )}
        </div>
      </form>
    );
  return (
    <div className="db-cell">
      {property.type === "title" && (
        <button type="button" className="db-row-title" onClick={() => onOpen(row.id)}>
          {row.title || t("common.untitled")}
        </button>
      )}
      {property.type !== "title" && !editable && <span>{displayValue(property, value, data, t)}</span>}
      {editable && (
        <button
          ref={trigger}
          type="button"
          className="db-cell-trigger"
          aria-label={t("database.editPropertyValue", {
            name: property.name,
            value: displayValue(property, value, data, t),
          })}
          onClick={() => {
            revision.current =
              row.cellRevisions[property.id] ?? (property.type === "title" ? row.revision : 0);
            setDraft(value);
            setError("");
            setEditing(true);
          }}
        >
          {property.type === "title" ? t("database.editTitle") : displayValue(property, value, data, t)}
        </button>
      )}
    </div>
  );
}
