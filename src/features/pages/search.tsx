"use client";
import { useRouter } from "next/navigation";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { Icon } from "@/components/icon";
import { readBoundedJson } from "@/lib/http";
import { useTranslations } from "@/lib/i18n/client";
import { createTranslator, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/core";

export const searchResultSchema = z.object({
  id: z.uuid(),
  title: z.string().max(500),
  rank: z.number(),
  updated_at: z.string(),
});
const responseSchema = z.object({ items: z.array(searchResultSchema).max(50), more: z.boolean() });
export type SearchResult = z.infer<typeof searchResultSchema>;

export async function findPages(
  workspaceId: string,
  query: string,
  signal?: AbortSignal,
  cursor?: { id: string; rank: number; updatedAt: string },
  locale: Locale = DEFAULT_LOCALE,
) {
  const t = createTranslator(locale);
  const response = await fetch("/api/pages/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, query, cursor }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(t("pages.searchConnectionFailed"));
  return responseSchema.parse(await readBoundedJson(response, 128 * 1024));
}

const subscribeBody = () => () => {};
export function PageSearch({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: (path: string) => void;
}) {
  const t = useTranslations();

  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const portalTarget = useSyncExternalStore(
    subscribeBody,
    () => document.body,
    () => null,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [more, setMore] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listId = useId();
  useEffect(() => {
    if (open && items[active])
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId, items]);
  function close() {
    dialog.current?.close();
    setOpen(false);
    if (returnFocus.current?.isConnected && returnFocus.current.getClientRects().length)
      returnFocus.current.focus();
    else trigger.current?.focus();
  }
  function show() {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setItems([]);
    setActive(0);
    setError("");
    setOpen(true);
    dialog.current?.showModal();
    input.current?.focus();
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        const selection = window.getSelection();
        const selectedElement = selection?.anchorNode?.parentElement;
        if (selection?.toString() && selectedElement?.closest('[contenteditable="true"]')) return;
        event.preventDefault();
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setQuery("");
        setItems([]);
        setActive(0);
        setOpen(true);
        dialog.current?.showModal();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      findPages(workspaceId, query, controller.signal, undefined, t.locale)
        .then((result) => {
          setItems(result.items);
          setMore(result.more);
          setError("");
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : t("pages.searchShortFailed"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workspaceId, query, open, t]);
  function choose(item: SearchResult) {
    close();
    const path = `/w/${workspaceId}/p/${item.id}`;
    onNavigate?.(path);
    router.push(path);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="nav-link search-trigger"
        onClick={show}
        aria-label={t("pages.search")}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Icon name="search" />
        {t("pages.search")}
        <kbd>Ctrl K</kbd>
      </button>
      {portalTarget &&
        createPortal(
          <dialog
            ref={dialog}
            className="command-dialog"
            aria-label={t("pages.search")}
            onCancel={(event) => {
              event.stopPropagation();
              event.preventDefault();
              close();
            }}
          >
            <div className="command-input">
              <Icon name="search" />
              <label className="sr-only" htmlFor={`${listId}-input`}>
                {t("pages.searchWorkspace")}
              </label>
              <input
                ref={input}
                id={`${listId}-input`}
                placeholder={t("pages.searchPlaceholder")}
                value={query}
                maxLength={200}
                autoComplete="off"
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && items.length) {
                    event.preventDefault();
                    setActive((value) => Math.min(value + 1, items.length - 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((value) => Math.max(value - 1, 0));
                  }
                  if (event.key === "Enter" && items[active]) {
                    event.preventDefault();
                    choose(items[active]);
                  }
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={t("pages.closeSearch")}
                onClick={close}
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="command-hint">
              {query.trim() ? t("pages.workspaceResults") : t("pages.recent")}
              {busy ? t("pages.searchingSuffix") : ""}
            </p>
            <div
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={t("pages.found")}
              className="command-results"
            >
              {items.map((item, index) => (
                <button
                  key={item.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={active === index}
                  tabIndex={-1}
                  type="button"
                  className="command-result"
                  onClick={() => choose(item)}
                  onFocus={() => setActive(index)}
                >
                  <Icon name="document" />
                  {item.title || t("pages.untitled")}
                  <Icon name="arrow" />
                </button>
              ))}
            </div>
            {!busy && !items.length && (
              <p className="command-empty">{query ? t("pages.searchEmpty") : t("pages.recentEmpty")}</p>
            )}
            {error && (
              <p role="alert" className="form-feedback error">
                {error}
              </p>
            )}
            {more && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  const last = items.at(-1);
                  if (!last) return;
                  setBusy(true);
                  try {
                    const result = await findPages(
                      workspaceId,
                      query,
                      undefined,
                      {
                        id: last.id,
                        rank: last.rank,
                        updatedAt: last.updated_at,
                      },
                      t.locale,
                    );
                    setItems([...items, ...result.items]);
                    setMore(result.more);
                  } catch {
                    setError(t("pages.moreResultsFailed"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("pages.moreResults")}
              </button>
            )}
            <p className="command-hint">{t("pages.searchKeys")}</p>
          </dialog>,
          portalTarget,
        )}
    </>
  );
}
