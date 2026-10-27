"use client";

import { useId, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import type {
  DatabaseCommand,
  DatabaseCommandResult,
  DatabaseData,
  DatabaseProperty,
  DatabaseQuery,
  SavedDatabaseView,
} from "../types";
import {
  type FindDatabasePeople,
  type FindDatabaseReferences,
  PeopleSearchContext,
  ReferenceSearchContext,
} from "./database-context";
import { DatabaseDialog } from "./database-dialog";
import { PropertyDialog } from "./database-property-dialog";
import { QueryPanel } from "./database-query-panel";
import { TemplatePanel } from "./database-templates";
import { ViewDialog } from "./database-view-dialog";
import { DatabaseViews } from "./database-views";
import { propertyLabels, viewLabels } from "./value-utils";

export type DatabaseWorkspaceProps = {
  data: DatabaseData;
  onQuery: (query: DatabaseQuery) => Promise<void>;
  onCommand: (command: DatabaseCommand) => Promise<DatabaseCommandResult>;
  onOpenRow: (id: string) => void;
  onFindReferences?: FindDatabaseReferences;
  onFindPeople?: FindDatabasePeople;
};
export function DatabaseWorkspace(props: DatabaseWorkspaceProps) {
  const t = useTranslations();

  const view = props.data.views.find((item) => item.id === props.data.viewId) ?? props.data.views[0];
  if (!view) return <p role="alert">{t("database.noViews")}</p>;
  return (
    <ReferenceSearchContext value={props.onFindReferences}>
      <PeopleSearchContext value={props.onFindPeople}>
        <Workspace key={`${props.data.id}:${view.id}`} {...props} view={view} />
      </PeopleSearchContext>
    </ReferenceSearchContext>
  );
}
function Workspace({
  data,
  view,
  onQuery,
  onCommand,
  onOpenRow,
}: DatabaseWorkspaceProps & { view: SavedDatabaseView }) {
  const t = useTranslations();
  const PROPERTY_LABELS = propertyLabels(t);
  const VIEW_LABELS = viewLabels(t);

  const today = new Date();
  const [month, setMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
  );
  const [query, setQuery] = useState<DatabaseQuery>({
    viewId: view.id,
    cursor: null,
    filter: view.filter,
    sorts: view.sorts,
    groupBy: view.groupBy,
    ...(view.type === "calendar" ? { month } : {}),
  });
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [property, setProperty] = useState<{ value: DatabaseProperty | null } | null>(null);
  const [viewEditor, setViewEditor] = useState<{
    value: SavedDatabaseView | null;
    duplicate: boolean;
  } | null>(null);
  const [deleteView, setDeleteView] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const panelId = useId();
  const apply = async (patch: DatabaseQuery) => {
    const next = { ...query, ...patch };
    setPending((count) => count + 1);
    setError("");
    try {
      await onQuery(next);
      setQuery(next);
    } catch {
      setError(t("database.queryFailed"));
      throw new Error("Database query failed");
    } finally {
      setPending((count) => count - 1);
    }
  };
  const refresh = () => apply({ cursor: null });
  const run = async (command: DatabaseCommand): Promise<DatabaseCommandResult> => {
    if (!data.editable) return { ok: false };
    setPending((count) => count + 1);
    setError("");
    setNotice("");
    try {
      const result = await onCommand(command);
      if (result.ok && !result.requiresConfirmation) {
        const target =
          command.action === "deleteView" && command.id === view.id
            ? data.views.find((item) => item.id !== view.id)?.id
            : command.action === "view" && command.id === null
              ? result.id
              : undefined;
        try {
          await onQuery(target ? { viewId: target, cursor: null } : { ...query, cursor: null });
          setNotice(t("database.saved"));
        } catch {
          setError(t("database.savedRefreshFailed"));
        }
      }
      return result;
    } catch {
      setError(t("database.changeFailed"));
      return { ok: false };
    } finally {
      setPending((count) => count - 1);
    }
  };
  const changeView = (id: string) => {
    setPending((count) => count + 1);
    setError("");
    const target = data.views.find((item) => item.id === id);
    void onQuery({ viewId: id, cursor: null, ...(target?.type === "calendar" ? { month } : {}) })
      .catch(() => setError(t("database.openViewFailed")))
      .finally(() => setPending((count) => count - 1));
  };
  return (
    <section
      className="db-workspace"
      aria-label={data.title || t("database.database")}
      aria-busy={pending > 0}
    >
      <header className="db-header">
        <div>
          <p className="db-eyebrow">{t("database.database")}</p>
          <h2>{data.title || t("database.untitledDatabase")}</h2>
        </div>
        {data.editable ? (
          <button type="button" onClick={() => setCreating(true)}>
            {t("database.newRecord")}
          </button>
        ) : (
          <span className="db-readonly">{t("common.readonly")}</span>
        )}
      </header>
      <div
        className="db-view-tabs"
        role="tablist"
        aria-label={t("database.views")}
        onKeyDown={(event) => {
          if (
            event.altKey ||
            event.nativeEvent.isComposing ||
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          event.preventDefault();
          tabs[next]?.focus();
          tabs[next]?.click();
        }}
      >
        {data.views.map((item) => (
          <button
            key={item.id}
            id={`${panelId}-${item.id}`}
            role="tab"
            type="button"
            aria-controls={panelId}
            aria-selected={item.id === view.id}
            tabIndex={item.id === view.id ? 0 : -1}
            disabled={pending > 0}
            onClick={() => changeView(item.id)}
          >
            {item.name}
            <span className="db-view-type"> · {VIEW_LABELS[item.type]}</span>
          </button>
        ))}
      </div>
      <div className="db-toolbar">
        {data.editable && (
          <>
            <button type="button" onClick={() => setViewEditor({ value: null, duplicate: false })}>
              {t("database.newView")}
            </button>
            <button type="button" onClick={() => setViewEditor({ value: view, duplicate: false })}>
              {t("database.configureView")}
            </button>
            <button type="button" onClick={() => setViewEditor({ value: view, duplicate: true })}>
              {t("database.duplicateView")}
            </button>
            <button type="button" disabled={data.views.length <= 1} onClick={() => setDeleteView(true)}>
              {t("database.deleteView")}
            </button>
          </>
        )}
        <button type="button" disabled={pending > 0} onClick={() => void refresh().catch(() => undefined)}>
          {t("common.refreshData")}
        </button>
        {view.type === "calendar" && (
          <label>
            {t("database.month")}
            <input
              type="month"
              required
              value={month}
              onChange={(event) => {
                const next = event.target.value;
                if (/^\d{4}-\d{2}$/.test(next)) {
                  setMonth(next);
                  void apply({ month: next, cursor: null }).catch(() => undefined);
                }
              }}
            />
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="db-feedback db-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="db-feedback">
          {notice}
        </p>
      )}
      <QueryPanel data={data} view={view} current={query} onApply={apply} run={run} />
      <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${view.id}`}>
        <DatabaseViews
          data={data}
          view={view}
          sorts={query.sorts ?? view.sorts}
          groupBy={query.groupBy === undefined ? view.groupBy : query.groupBy}
          month={month}
          run={run}
          onRefresh={refresh}
          onOpen={onOpenRow}
        />
        {data.nextCursor && (
          <button
            type="button"
            disabled={pending > 0}
            onClick={() => void apply({ cursor: data.nextCursor }).catch(() => undefined)}
          >
            {t("database.loadRecords")}
          </button>
        )}
      </div>
      {data.editable && (
        <>
          <details className="db-panel">
            <summary>{t("database.properties")}</summary>
            <ul className="db-property-list">
              {data.properties.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.name} <small>{PROPERTY_LABELS[item.type]}</small>
                  </span>
                  <button type="button" onClick={() => setProperty({ value: item })}>
                    {t("common.edit")} {item.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setProperty({ value: null })}>
              {t("database.newProperty")}
            </button>
          </details>
          <TemplatePanel data={data} run={run} onOpen={onOpenRow} />
        </>
      )}
      {property && (
        <PropertyDialog data={data} property={property.value} run={run} onClose={() => setProperty(null)} />
      )}
      {viewEditor && (
        <ViewDialog
          data={data}
          source={viewEditor.value}
          duplicate={viewEditor.duplicate}
          run={run}
          onClose={() => setViewEditor(null)}
        />
      )}
      {deleteView && (
        <DatabaseDialog title={t("database.deleteViewQuestion")} onClose={() => setDeleteView(false)}>
          <p>{t("database.deleteViewNotice")}</p>
          <div className="db-actions">
            <button
              type="button"
              disabled={pending > 0 || data.views.length <= 1}
              onClick={() => {
                void run({ action: "deleteView", id: view.id, expectedRevision: view.revision }).then(
                  (result) => {
                    if (result.ok) setDeleteView(false);
                    else setError(t("database.deleteViewFailed"));
                  },
                );
              }}
            >
              {t("database.deleteView")}
            </button>
            <button type="button" onClick={() => setDeleteView(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </DatabaseDialog>
      )}
      {creating && (
        <DatabaseDialog title={t("database.newRecord")} onClose={() => setCreating(false)}>
          <form
            className="db-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run({ action: "createRecord", title, ...(templateId ? { templateId } : {}) }).then(
                (result) => {
                  if (result.ok) {
                    setCreating(false);
                    setTitle("");
                    if (result.pageId ?? result.id) onOpenRow(result.pageId ?? result.id ?? "");
                  } else setError(t("database.createRecordFailed"));
                },
              );
            }}
          >
            <label>
              {t("database.recordTitle")}
              <input maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              {t("database.template")}
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                <option value="">{t("database.blankPage")}</option>
                {data.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.title}
                  </option>
                ))}
              </select>
            </label>
            {templateId && <p>{t("database.createFromTemplateNotice")}</p>}
            <div className="db-actions">
              <button type="submit" disabled={pending > 0}>
                {t("database.createRecord")}
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        </DatabaseDialog>
      )}
    </section>
  );
}
