"use client";
import { useState } from "react";
import { type DatabaseView, parseView, type ViewType, viewTypes } from "../model";
import type { DatabaseData, SavedDatabaseView, ViewConfiguration } from "../types";
import { DatabaseDialog } from "./database-dialog";
import type { RunCommand } from "./database-value";
import { VIEW_LABELS } from "./value-utils";

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
  const [name, setName] = useState(
    source ? `${source.name}${duplicate ? " (cópia)" : ""}` : "Nova visualização",
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
      title={source ? (duplicate ? "Duplicar visualização" : "Editar visualização") : "Nova visualização"}
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
              else setError("Não foi possível salvar a visualização. Atualize os dados e tente novamente.");
            } catch {
              setError("Confira o nome, o agrupamento e a propriedade de data desta visualização.");
            } finally {
              setPending(false);
            }
          };
          void submit();
        }}
      >
        <label>
          Nome da visualização
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Tipo
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
            Agrupar por
            <select
              value={group}
              required={type === "board"}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="">{type === "board" ? "Escolha Seleção ou Checkbox" : "Sem agrupamento"}</option>
              {groups.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === "board" && !groups.length && (
          <p>Crie uma propriedade de Seleção ou Checkbox nas propriedades da base para montar o board.</p>
        )}
        {type === "calendar" && (
          <label>
            Propriedade de data
            <select required value={date} onChange={(event) => setDate(event.target.value)}>
              <option value="">Escolha uma data</option>
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
          <legend>Propriedades visíveis</legend>
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
              {data.properties.find((property) => property.id === id)?.name ?? "Propriedade removida"}
              <button
                type="button"
                disabled={index === 0}
                aria-label={`Subir coluna ${index + 1}`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === visible.length - 1}
                aria-label={`Descer coluna ${index + 1}`}
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
            Salvar visualização
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </DatabaseDialog>
  );
}
