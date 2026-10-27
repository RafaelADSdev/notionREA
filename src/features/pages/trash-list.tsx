"use client";

import { useState, useTransition } from "react";
import { z } from "zod";
import { useTranslations } from "@/lib/i18n/client";
import { RestorePageForm } from "./forms";

export const trashItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  parent_id: z.uuid().nullable(),
  deleted_at: z.string(),
  revision: z.number(),
});
type TrashItem = z.infer<typeof trashItemSchema>;
export function TrashList({
  workspaceId,
  initialItems,
  initialMore,
}: {
  workspaceId: string;
  initialItems: TrashItem[];
  initialMore: boolean;
}) {
  const t = useTranslations();

  const [items, setItems] = useState(initialItems);
  const [more, setMore] = useState(initialMore);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function load(next: boolean) {
    startTransition(async () => {
      try {
        const term = next ? appliedQuery : query;
        const response = await fetch("/api/pages/trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            query: term,
            ...(next && items.at(-1) ? { afterId: items.at(-1)?.id } : {}),
          }),
        });
        if (!response.ok) throw new Error("Unavailable");
        const result = z
          .object({ items: z.array(trashItemSchema).max(50), more: z.boolean() })
          .parse(await response.json());
        setItems(next ? [...items, ...result.items] : result.items);
        setMore(result.more);
        setAppliedQuery(term);
        setError("");
      } catch {
        setError(t("pages.trashSearchFailed"));
      }
    });
  }
  return (
    <>
      <form
        className="trash-search"
        onSubmit={(event) => {
          event.preventDefault();
          load(false);
        }}
      >
        <label className="field">
          {t("pages.searchTrash")}
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} />
        </label>
        <button type="submit" className="button secondary" disabled={pending}>
          {t("common.search")}
        </button>
      </form>
      {error && (
        <p role="alert" className="form-feedback error">
          {error}
        </p>
      )}
      {!items.length && (
        <p className="notice">{appliedQuery ? t("pages.trashSearchEmpty") : t("pages.trashEmpty")}</p>
      )}
      <div className="trash-list">
        {items.map((page) => (
          <article className="trash-item" key={page.id} aria-label={page.title || t("pages.untitled")}>
            <h2>{page.title || t("pages.untitled")}</h2>
            <p className="notice">
              {t("pages.removedOn")}{" "}
              <time dateTime={page.deleted_at}>
                {new Intl.DateTimeFormat(t.locale, { dateStyle: "medium", timeZone: "UTC" }).format(
                  new Date(page.deleted_at),
                )}
              </time>
            </p>
            <RestorePageForm page={page} workspaceId={workspaceId} />
          </article>
        ))}
      </div>
      {more && (
        <button type="button" className="button secondary" disabled={pending} onClick={() => load(true)}>
          {t("pages.moreTrash")}
        </button>
      )}
    </>
  );
}
