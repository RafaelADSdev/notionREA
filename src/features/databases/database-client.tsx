"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DatabaseCommand,
  DatabaseCommandResult,
  DatabaseData,
  DatabaseQuery,
  DatabaseReference,
} from "./types";
import { DatabaseWorkspace } from "./ui/database-workspace";

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok)
    throw new Error(typeof value?.error === "string" ? value.error : "Não foi possível carregar a base.");
  return value as T;
}

export function DatabaseClient({
  databaseId,
  workspaceId,
  viewId,
}: {
  databaseId: string;
  workspaceId: string;
  viewId?: string;
}) {
  return (
    <DatabaseLoader
      key={databaseId}
      databaseId={databaseId}
      workspaceId={workspaceId}
      {...(viewId ? { viewId } : {})}
    />
  );
}
function DatabaseLoader({
  databaseId,
  workspaceId,
  viewId,
}: {
  databaseId: string;
  workspaceId: string;
  viewId?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<DatabaseData | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const initialView = useRef(viewId);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const operations = useRef(new Map<string, string>());
  const [recovery, setRecovery] = useState<DatabaseCommandResult | null>(null);
  const load = useCallback(
    async (query: DatabaseQuery = {}) => {
      const ticket = ++generation.current;
      const response = await fetch(`/api/databases/${databaseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "query", ...query }),
      });
      const next = await responseJson<DatabaseData>(response);
      if (ticket !== generation.current) return;
      setData((previous) => {
        if (!query.cursor || !previous || previous.viewId !== next.viewId) return next;
        const known = new Set(previous.rows.map((row) => row.id));
        return { ...next, rows: [...previous.rows, ...next.rows.filter((row) => !known.has(row.id))] };
      });
      setError("");
    },
    [databaseId],
  );
  useEffect(() => {
    void load(initialView.current ? { viewId: initialView.current } : {}).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Base indisponível.");
    });
    return invalidate;
  }, [load, invalidate]);
  const command = async (input: DatabaseCommand): Promise<DatabaseCommandResult> => {
    const key = JSON.stringify(input);
    let operationId = operations.current.get(key);
    if (!operationId) {
      operationId = crypto.randomUUID();
      operations.current.set(key, operationId);
    }
    try {
      const result = await responseJson<DatabaseCommandResult>(
        await fetch(`/api/databases/${databaseId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Operation-Id": operationId },
          body: JSON.stringify(input),
        }),
      );
      if (result.ok) operations.current.delete(key);
      if (!result.ok && result.pageId) setRecovery(result);
      return result;
    } catch (reason) {
      return { ok: false, error: reason instanceof Error ? reason.message : "Não foi possível salvar." };
    }
  };
  if (!data)
    return (
      <div className="db-loading" aria-live="polite">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              onClick={() =>
                void load().catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : "Base indisponível."),
                )
              }
            >
              Tentar novamente
            </button>
          </>
        ) : (
          "Carregando base de dados…"
        )}
      </div>
    );
  return (
    <>
      {recovery?.pageId && (
        <p className="db-feedback" role="alert">
          {recovery.error}{" "}
          <button type="button" onClick={() => router.push(`/w/${workspaceId}/p/${recovery.pageId}`)}>
            Abrir página criada
          </button>
        </p>
      )}
      <DatabaseWorkspace
        data={data}
        onQuery={load}
        onCommand={command}
        onOpenRow={(id) => router.push(`/w/${workspaceId}/p/${id}`)}
        onFindPeople={async (cursor) =>
          responseJson<{ items: DatabaseReference[]; nextCursor: string | null }>(
            await fetch(
              `/api/databases/${databaseId}/people${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
              { cache: "no-store" },
            ),
          )
        }
        onFindReferences={async (target, query, cursor) => {
          const parameters = new URLSearchParams({ query, ...(cursor ? { cursor } : {}) });
          return responseJson<{ items: DatabaseReference[]; nextCursor: string | null }>(
            await fetch(`/api/databases/${target}/references?${parameters}`, { cache: "no-store" }),
          );
        }}
      />
    </>
  );
}
