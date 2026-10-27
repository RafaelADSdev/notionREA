"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
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
  const t = useTranslations();

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
      if (!response.ok) throw new Error(t("database.searchBasesFailed"));
      setItems((previous) => (after ? [...previous, ...result.items] : result.items));
      setCursor(result.nextCursor);
      setError("");
    },
    [workspaceId, t],
  );
  useEffect(() => {
    if (!choosing) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () =>
        void load(query, undefined, abort.signal).catch(() => {
          if (!abort.signal.aborted) setError(t("database.searchBasesFailed"));
        }),
      200,
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [choosing, query, load, t]);
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
        <p>{t("database.chooseInline")}</p>
      )}
      {editable && (
        <button type="button" onClick={() => setChoosing(true)}>
          {databaseId ? t("database.replaceReference") : t("database.chooseOrCreate")}
        </button>
      )}
      {choosing && (
        <DatabaseDialog title={t("editor.inlineDatabase")} onClose={() => setChoosing(false)}>
          <p>{t("database.referenceNotice")}</p>
          <CreateDatabaseControl
            workspaceId={workspaceId}
            parentId={pageId}
            onCreated={(id) => {
              onSelect(id);
              setChoosing(false);
            }}
          />
          <label>
            {t("database.searchExisting")}
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
                  {item.label || t("database.untitledDatabase")}
                </button>
              </li>
            ))}
          </ul>
          {!items.length && !error && <p>{t("database.noDatabases")}</p>}
          {cursor && (
            <button
              type="button"
              onClick={() => void load(query, cursor).catch(() => setError(t("database.moreBasesFailed")))}
            >
              {t("database.moreBases")}
            </button>
          )}
        </DatabaseDialog>
      )}
    </div>
  );
}
