"use client";
import { useContext, useRef, useState } from "react";
import type { DatabaseReference } from "../types";
import { ReferenceSearchContext } from "./database-context";

export function RelationPicker({
  name,
  targetDatabaseId,
  initial,
  selected,
  disabled,
  onChange,
}: {
  name: string;
  targetDatabaseId: string;
  initial: DatabaseReference[];
  selected: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const find = useContext(ReferenceSearchContext);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(initial.filter((item) => item.databaseId === targetDatabaseId));
  const [known, setKnown] = useState(items);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const search = async (next?: string | null) => {
    if (!find) return;
    const sequence = ++request.current;
    setPending(true);
    setError("");
    try {
      const result = await find(targetDatabaseId, query, next);
      if (sequence !== request.current) return;
      const incoming = result.items.filter(
        (item) => item.databaseId === undefined || item.databaseId === targetDatabaseId,
      );
      setItems((current) => [
        ...new Map([...(next ? current : []), ...incoming].map((item) => [item.id, item])).values(),
      ]);
      setKnown((current) => [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()]);
      setCursor(result.nextCursor);
    } catch {
      if (sequence === request.current) setError("Não foi possível consultar os registros autorizados.");
    } finally {
      if (sequence === request.current) setPending(false);
    }
  };
  return (
    <fieldset className="db-reference-picker" disabled={disabled}>
      <legend>{name}</legend>
      <label>
        Buscar registros
        <input
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              void search();
            }
          }}
        />
      </label>
      {find && (
        <button disabled={pending} type="button" onClick={() => void search()}>
          Buscar
        </button>
      )}
      {items
        .filter(
          (item) => find || item.label.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")),
        )
        .map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id),
                )
              }
            />
            {item.label}
          </label>
        ))}
      {selected
        .filter((id) => !items.some((item) => item.id === id))
        .map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked
              onChange={() => onChange(selected.filter((item) => item !== id))}
            />
            {known.find((item) => item.id === id)?.label ?? "Referência indisponível"}
          </label>
        ))}
      {cursor && (
        <button type="button" disabled={pending} onClick={() => void search(cursor)}>
          Mais resultados
        </button>
      )}
      {pending && <p role="status">Buscando…</p>}
      {error && <p role="alert">{error}</p>}
      {!items.length && !pending && <p>Nenhum registro encontrado. Busque pelo título.</p>}
    </fieldset>
  );
}
