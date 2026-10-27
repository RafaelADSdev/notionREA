"use client";
import { useState } from "react";
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
import { PROPERTY_LABELS } from "./value-utils";

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
      else setError("Não foi possível alterar a propriedade. Atualize os dados e tente novamente.");
    } catch {
      setError("Não foi possível alterar a propriedade. Tente novamente.");
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
      setError("Confira o nome, as opções e a configuração da propriedade.");
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
    <DatabaseDialog title={property ? "Editar propriedade" : "Nova propriedade"} onClose={onClose}>
      {preview ? (
        <div className="db-property-preview">
          <h3>Confirmar alteração</h3>
          <p>
            {preview.result.valueCount ?? 0} valores serão considerados;{" "}
            {preview.result.incompatibleCount ?? 0} valores incompatíveis poderão ser limpos.
          </p>
          {!!preview.result.dependentViews?.length && (
            <p>Visualizações dependentes: {preview.result.dependentViews.join(", ")}.</p>
          )}
          <p>
            A alteração afeta o schema compartilhado e os valores padrão de templates. Confira a prévia antes
            de confirmar.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Entendo o alcance da alteração e autorizo tratar os valores incompatíveis.
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
              Confirmar alteração
            </button>
            <button type="button" disabled={pending} onClick={() => setPreview(null)}>
              Voltar
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
            Nome da propriedade
            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Tipo
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
              <legend>Opções</legend>
              {options.map((option, index) => (
                <div key={option.id} className="db-option" data-color={option.color}>
                  <input
                    aria-label={`Nome da opção ${index + 1}`}
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
                    aria-label={`Cor da opção ${index + 1}`}
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
                            default: "Padrão",
                            indigo: "Índigo",
                            copper: "Cobre",
                            green: "Verde",
                            red: "Vermelho",
                            yellow: "Amarelo",
                          }[color]
                        }
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => reorder(index, -1)}
                    aria-label={`Subir opção ${index + 1}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === options.length - 1}
                    onClick={() => reorder(index, 1)}
                    aria-label={`Descer opção ${index + 1}`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptions(options.filter((item) => item.id !== option.id))}
                  >
                    Remover opção
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={options.length >= 500}
                onClick={() =>
                  setOptions([...options, { id: crypto.randomUUID(), label: "Nova opção", color: "default" }])
                }
              >
                Adicionar opção
              </button>
            </fieldset>
          )}
          {type === "date" && (
            <label>
              Semântica da data
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value === "instant" ? "instant" : "civil")}
              >
                <option value="civil">Dia civil (sem hora)</option>
                <option value="instant">Data e hora com fuso</option>
              </select>
            </label>
          )}
          {type === "relation" && (
            <label>
              Base de destino
              <select required value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">Escolha uma base autorizada</option>
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
              {pending ? "Verificando…" : "Salvar propriedade"}
            </button>
            <button type="button" disabled={pending} onClick={onClose}>
              Cancelar
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
                Remover propriedade
              </button>
            )}
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </DatabaseDialog>
  );
}
