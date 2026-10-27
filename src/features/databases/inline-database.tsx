"use client";
import { useCallback, useEffect, useState } from "react";
import { CreateDatabaseControl } from "./create-control";
import { DatabaseClient } from "./database-client";
import type { DatabaseReference } from "./types";
import { DatabaseDialog } from "./ui/database-dialog";

export function InlineDatabase({
  workspaceId,
  pageId,
  databaseId,
  viewId,
  editable,
  onSelect,
}: {
  workspaceId: string;
  pageId: string;
  databaseId?: string;
  viewId?: string;
  editable: boolean;
  onSelect: (id: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DatabaseReference[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    async (search: string, after?: string, signal?: AbortSignal) => {
      const parameters = new URLSearchParams({
        workspaceId,
        query: search,
        ...(after ? { cursor: after } : {}),
      });
      const response = await fetch(`/api/databases?${parameters}`, {
        ...(signal ? { signal } : {}),
        cache: "no-store",
      });
      const result: { items: DatabaseReference[]; nextCursor: string | null } = await response.json();
      if (!response.ok) throw new Error("Não foi possível buscar as bases.");
      setItems((previous) => (after ? [...previous, ...result.items] : result.items));
      setCursor(result.nextCursor);
      setError("");
    },
    [workspaceId],
  );
  useEffect(() => {
    if (!choosing) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () =>
        void load(query, undefined, abort.signal).catch(() => {
          if (!abort.signal.aborted) setError("Não foi possível buscar as bases.");
        }),
      200,
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [choosing, query, load]);
  return (
    <div className="db-inline">
      {databaseId ? (
        <DatabaseClient
          key={`${databaseId}:${viewId ?? ""}`}
          databaseId={databaseId}
          workspaceId={workspaceId}
          {...(viewId ? { viewId } : {})}
        />
      ) : (
        <p>Escolha uma base para mostrar neste bloco.</p>
      )}
      {editable && (
        <button type="button" onClick={() => setChoosing(true)}>
          {databaseId ? "Trocar referência de base" : "Escolher ou criar base de dados"}
        </button>
      )}
      {choosing && (
        <DatabaseDialog title="Base de dados inline" onClose={() => setChoosing(false)}>
          <p>Uma referência mostra os mesmos registros e respeita o acesso da base original.</p>
          <CreateDatabaseControl
            workspaceId={workspaceId}
            parentId={pageId}
            onCreated={(id) => {
              onSelect(id);
              setChoosing(false);
            }}
          />
          <label>
            Buscar base existente
            <input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {error && <p role="alert">{error}</p>}
          <ul className="db-property-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(item.id);
                    setChoosing(false);
                  }}
                >
                  {item.label || "Base sem título"}
                </button>
              </li>
            ))}
          </ul>
          {!items.length && !error && <p>Nenhuma base encontrada.</p>}
          {cursor && (
            <button
              type="button"
              onClick={() =>
                void load(query, cursor).catch(() => setError("Não foi possível carregar mais bases."))
              }
            >
              Carregar mais bases
            </button>
          )}
        </DatabaseDialog>
      )}
    </div>
  );
}
