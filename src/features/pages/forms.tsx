"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { useTranslations } from "@/lib/i18n/client";
import { favoritePage, movePage, restorePage, savePageMetadata, trashPage } from "./actions";
import type { PageActionState, PageSummary } from "./model/validation";
import { findPages, type SearchResult } from "./search";

function Feedback({ state }: { state: PageActionState }) {
  const t = useTranslations();
  const element = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error || state.message) element.current?.focus();
  }, [state]);
  return state.error || state.message ? (
    <p
      ref={element}
      tabIndex={-1}
      role={state.error ? "alert" : "status"}
      className={`form-feedback${state.error ? " error" : ""}`}
    >
      {state.error ?? state.message}
      {state.affectedPages !== undefined && t("pages.affectedCount", { count: state.affectedPages })}
    </p>
  ) : null;
}
function Identity({
  page,
  workspaceId,
}: {
  page: Pick<PageSummary, "id" | "revision">;
  workspaceId: string;
}) {
  return (
    <>
      <input type="hidden" name="pageId" value={page.id} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="revision" value={page.revision} />
    </>
  );
}
export function PageMetadataForm({
  page,
  workspaceId,
  focusTitle,
}: {
  page: PageSummary;
  workspaceId: string;
  focusTitle: boolean;
}) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(savePageMetadata, {});
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusTitle) title.current?.focus();
  }, [focusTitle]);
  return (
    <form action={action} className="page-metadata">
      <Identity page={page} workspaceId={workspaceId} />
      <div className="page-title-row">
        <label className="page-icon-field">
          <span className="sr-only">{t("pages.icon")}</span>
          <input
            name="icon"
            aria-label={t("pages.icon")}
            defaultValue={page.icon}
            maxLength={16}
            placeholder="📝"
            autoComplete="off"
          />
        </label>
        <label className="page-title-field">
          <span className="sr-only">{t("pages.name")}</span>
          <input
            ref={title}
            name="title"
            defaultValue={page.title}
            placeholder={t("pages.untitled")}
            maxLength={500}
          />
        </label>
      </div>
      <div className="page-save-row">
        <span className="notice">{t("pages.titleAndIcon")}</span>
        <button type="submit" className="button secondary" disabled={pending}>
          {pending ? t("common.saving") : t("pages.save")}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
export function FavoriteButton({
  pageId,
  workspaceId,
  initial,
}: {
  pageId: string;
  workspaceId: string;
  initial: boolean;
}) {
  const t = useTranslations();

  const [favorite, setFavorite] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        className="icon-button favorite-button"
        aria-label={favorite ? t("pages.removeFavorite") : t("pages.addFavorite")}
        aria-pressed={favorite}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              setFavorite(await favoritePage(pageId, workspaceId));
              setError("");
            } catch {
              setError(t("pages.favoriteFailed"));
            }
          })
        }
      >
        <Icon name="star" />
      </button>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </>
  );
}

function DestinationPicker({
  workspaceId,
  pageId,
  disabled = false,
}: {
  workspaceId: string;
  pageId: string;
  disabled?: boolean;
}) {
  const t = useTranslations();

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      findPages(workspaceId, query, controller.signal, undefined, t.locale)
        .then((result) => {
          setItems(result.items.filter((item) => item.id !== pageId));
          setError("");
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(t("pages.destinationsFailed"));
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workspaceId, pageId, query, disabled, t]);
  return (
    <div className="destination-fields">
      <label className="field">
        {t("pages.searchDestination")}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={200}
          disabled={disabled}
          placeholder={t("pages.destinationPlaceholder")}
        />
      </label>
      <label className="field">
        {t("common.moveTo")}
        <select
          name="parentId"
          aria-label={t("common.moveTo")}
          value={selected?.id ?? ""}
          onChange={(event) => setSelected(items.find((item) => item.id === event.target.value) ?? null)}
          disabled={disabled}
        >
          <option value="">{t("pages.workspaceRoot")}</option>
          {selected && !items.some((item) => item.id === selected.id) && (
            <option value={selected.id}>{selected.title || t("pages.untitled")}</option>
          )}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || t("pages.untitled")}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </div>
  );
}
function AccessConfirmation({ state }: { state: PageActionState }) {
  const t = useTranslations();

  return state.requiresConfirmation ? (
    <>
      <input type="hidden" name="previewHash" value={state.previewHash ?? ""} />
      <label className="checkbox-field">
        <input type="checkbox" name="confirmAccess" required />
        {t("pages.confirmAccess")}
      </label>
    </>
  ) : null;
}
export function MovePageForm({ page, workspaceId }: { page: PageSummary; workspaceId: string }) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(movePage, {});
  return (
    <form
      action={action}
      className="form-stack"
      onReset={(event) => event.preventDefault()}
      onChange={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
          const checkbox = event.currentTarget.elements.namedItem("confirmAccess");
          if (event.target.name !== "confirmAccess" && checkbox instanceof HTMLInputElement)
            checkbox.checked = false;
        }
      }}
    >
      <Identity page={page} workspaceId={workspaceId} />
      <DestinationPicker workspaceId={workspaceId} pageId={page.id} />
      <p className="notice">{t("pages.moveEndNotice")}</p>
      <Feedback state={state} />
      <AccessConfirmation state={state} />
      <button type="submit" className="button secondary" disabled={pending}>
        {pending ? "Movendo…" : t("pages.movePage")}
      </button>
    </form>
  );
}
export function TrashPageForm({ page, workspaceId }: { page: PageSummary; workspaceId: string }) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(trashPage, {});
  return (
    <form action={action} className="form-stack">
      <Identity page={page} workspaceId={workspaceId} />
      <p className="notice">{t("pages.trashNotice")}</p>
      <label className="checkbox-field">
        <input type="checkbox" name="confirmTrash" required />
        {t("pages.trashChildren")}
      </label>
      <Feedback state={state} />
      <button type="submit" className="button danger" disabled={pending}>
        {pending ? "Movendo…" : t("pages.moveToTrash")}
      </button>
    </form>
  );
}
export function RestorePageForm({
  page,
  workspaceId,
}: {
  page: Pick<PageSummary, "id" | "revision">;
  workspaceId: string;
}) {
  const t = useTranslations();

  const [state, action, pending] = useActionState(restorePage, {});
  const [original, setOriginal] = useState(true);
  return (
    <form action={action} className="form-stack" onReset={(event) => event.preventDefault()}>
      <Identity page={page} workspaceId={workspaceId} />
      <label className="checkbox-field">
        <input
          type="checkbox"
          name="originalParent"
          checked={original}
          onChange={(event) => setOriginal(event.target.checked)}
        />
        {t("pages.originalLocation")}
      </label>
      {!original && <DestinationPicker workspaceId={workspaceId} pageId={page.id} />}
      <Feedback state={state} />
      <AccessConfirmation state={state} />
      <button type="submit" className="button secondary" disabled={pending}>
        {pending ? "Restaurando…" : t("pages.restore")}
      </button>
    </form>
  );
}
