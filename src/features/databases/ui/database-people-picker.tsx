"use client";
import { useContext, useState } from "react";
import type { DatabaseReference } from "../types";
import { PeopleSearchContext } from "./database-context";

export function PeoplePicker({
  name,
  initial,
  selected,
  disabled,
  onChange,
}: {
  name: string;
  initial: DatabaseReference[];
  selected: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const find = useContext(PeopleSearchContext);
  const [items, setItems] = useState<DatabaseReference[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const choices = [...new Map([...initial, ...items].map((item) => [item.id, item])).values()];
  return (
    <fieldset className="db-set-picker" disabled={disabled || pending}>
      <legend>{name}</legend>
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
            Pessoa indisponível
          </label>
        ))}
      {find && cursor !== null && (
        <button
          type="button"
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              const result = await find(cursor);
              setItems((previous) => [...previous, ...result.items]);
              setCursor(result.nextCursor);
            } catch {
              setError("Não foi possível carregar os membros.");
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Carregando…" : "Carregar mais membros"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
