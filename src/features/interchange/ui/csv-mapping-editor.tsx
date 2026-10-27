"use client";
import { useId, useState } from "react";
import { z } from "zod";
import { optionSchema, propertyDefinitionSchema } from "@/features/databases/model";
import { type ColumnMapping, type CsvMapping, csvMappingSchema } from "../model/contracts";
import type { InterchangePreviewItem } from "./job-client";
import { columnTypes, useInterchangeText } from "./text";

function initialMapping(item: InterchangePreviewItem): CsvMapping {
  return (
    item.mapping ?? {
      path: item.path ?? item.key,
      columns: (item.header ?? []).map((name, index) => ({
        index,
        name: name.trim().slice(0, 120) || `Coluna ${index + 1}`,
        type: index === 0 ? "title" : "text",
        config: {},
      })),
    }
  );
}
function defaultConfig(type: ColumnMapping["type"]): Record<string, unknown> {
  return type === "date"
    ? { mode: "civil" }
    : type === "select" || type === "multiSelect"
      ? { options: [] }
      : type === "relation"
        ? { targetDatabaseId: "" }
        : {};
}
function sampleRows(rows: readonly string[][]) {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const signature = JSON.stringify(row),
      occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    const cells = new Map<string, number>();
    return {
      id: `${signature}:${occurrence}`,
      cells: row.map((value) => {
        const occurrence = cells.get(value) ?? 0;
        cells.set(value, occurrence + 1);
        return { id: `${value}:${occurrence}`, value };
      }),
    };
  });
}
export function validateUiMapping(input: unknown): CsvMapping {
  const mapping = csvMappingSchema.parse(input);
  if (
    mapping.columns.filter((column) => column.type === "title").length !== 1 ||
    new Set(mapping.columns.map((column) => column.index)).size !== mapping.columns.length
  )
    throw new Error("A mapping requires one title and unique columns");
  for (const column of mapping.columns)
    propertyDefinitionSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      name: column.name,
      type: column.type,
      config: column.config,
    });
  return mapping;
}
export function CsvMappingEditor({
  item,
  busy,
  onSave,
  onDirty,
}: {
  item: InterchangePreviewItem;
  busy: boolean;
  onSave: (mapping: CsvMapping) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
}) {
  const text = useInterchangeText(),
    id = useId();
  const [mapping, setMapping] = useState(() => initialMapping(item)),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const [optionDrafts, setOptionDrafts] = useState<Record<number, string>>({});
  const update = (index: number, patch: Partial<ColumnMapping>) => {
    setMapping((value) => ({
      ...value,
      columns: value.columns.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    }));
    setDirty(true);
    onDirty(true);
  };
  return (
    <form
      className="interchange-mapping"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        try {
          const parsed = validateUiMapping(mapping);
          void onSave(parsed).then((saved) => {
            if (saved) {
              setDirty(false);
              onDirty(false);
            }
          });
        } catch {
          setError(
            text(
              "Confira os nomes, configurações e a única coluna de título.",
              "Check names, settings and the single title column.",
            ),
          );
        }
      }}
    >
      <h4>{item.path ?? item.key}</h4>
      <p>
        {text(
          "O padrão é título e texto. Escolha os tipos antes de confirmar a importação.",
          "The default is title and text. Choose types before confirming the import.",
        )}
      </p>
      {item.sample?.length ? (
        <div className="interchange-table-scroll">
          <table>
            <caption>
              {text(
                "Amostra limitada do CSV; valores completos permanecem no arquivo",
                "Limited CSV sample; complete values remain in the archive",
              )}
            </caption>
            <tbody>
              {sampleRows(item.sample).map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell) => (
                    <td key={cell.id}>{cell.value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="interchange-columns">
        {mapping.columns.map((column, index) => {
          const options = z.array(optionSchema).safeParse(column.config.options);
          return (
            <fieldset key={column.index} disabled={busy}>
              <legend>
                {text("Coluna", "Column")} {column.index + 1}
              </legend>
              <label htmlFor={`${id}-name-${index}`}>{text("Nome", "Name")}</label>
              <input
                id={`${id}-name-${index}`}
                maxLength={120}
                value={column.name}
                onChange={(event) => update(index, { name: event.target.value })}
              />
              <label htmlFor={`${id}-type-${index}`}>{text("Tipo", "Type")}</label>
              <select
                id={`${id}-type-${index}`}
                value={column.type}
                onChange={(event) => {
                  const type = csvMappingSchema.shape.columns.element.shape.type.parse(event.target.value);
                  setOptionDrafts((value) => ({ ...value, [column.index]: "" }));
                  update(index, { type, config: defaultConfig(type) });
                }}
              >
                {Object.entries(columnTypes).map(([type, labels]) => (
                  <option key={type} value={type}>
                    {text(...labels)}
                  </option>
                ))}
              </select>
              {column.type === "date" && (
                <label>
                  {text("Semântica de data", "Date semantics")}
                  <select
                    value={column.config.mode === "instant" ? "instant" : "civil"}
                    onChange={(event) => update(index, { config: { mode: event.target.value } })}
                  >
                    <option value="civil">{text("Dia civil", "Civil day")}</option>
                    <option value="instant">{text("Instante com fuso", "Instant with time zone")}</option>
                  </select>
                </label>
              )}
              {(column.type === "select" || column.type === "multiSelect") && (
                <label>
                  {text("Opções permitidas, uma por linha", "Allowed options, one per line")}
                  <textarea
                    value={
                      optionDrafts[column.index] ??
                      (options.success ? options.data.map((option) => option.label).join("\n") : "")
                    }
                    onChange={(event) => {
                      setOptionDrafts((value) => ({ ...value, [column.index]: event.target.value }));
                      const previous = options.success ? options.data : [];
                      const labels = [
                        ...new Set(
                          event.target.value
                            .split("\n")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        ),
                      ];
                      update(index, {
                        config: {
                          options: labels.map(
                            (label) =>
                              previous.find((option) => option.label === label) ?? {
                                id: crypto.randomUUID(),
                                label,
                                color: "default",
                              },
                          ),
                        },
                      });
                    }}
                  />
                </label>
              )}
              {column.type === "relation" && (
                <label>
                  {text("ID da base de destino autorizada", "Authorized target database ID")}
                  <input
                    value={
                      typeof column.config.targetDatabaseId === "string" ? column.config.targetDatabaseId : ""
                    }
                    placeholder="UUID"
                    onChange={(event) => update(index, { config: { targetDatabaseId: event.target.value } })}
                  />
                </label>
              )}
              {(column.type === "person" || column.type === "relation") && (
                <p>
                  {text(
                    "Os valores devem ser listas JSON de IDs existentes e autorizados. Nomes e e-mails não são inferidos.",
                    "Values must be JSON lists of existing, authorized IDs. Names and emails are never inferred.",
                  )}
                </p>
              )}
              {(column.type === "createdTime" || column.type === "editedTime") && (
                <p>
                  {text(
                    "Será preservado como texto informativo, sem alterar autoria ou datas do servidor.",
                    "Preserved as informational text, without changing authorship or server timestamps.",
                  )}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
      <div className="interchange-actions">
        <button type="submit" disabled={busy || !dirty}>
          {text("Salvar mapeamento e validar", "Save mapping and validate")}
        </button>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => {
            setMapping(initialMapping(item));
            setOptionDrafts({});
            setDirty(false);
            onDirty(false);
            setError("");
          }}
        >
          {text("Descartar alterações do mapeamento", "Discard mapping changes")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
