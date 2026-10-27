"use client";
import { useId, useState } from "react";
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
import { PROPERTY_LABELS, VIEW_LABELS } from "./value-utils";

export type DatabaseWorkspaceProps = {
  data: DatabaseData;
  onQuery: (query: DatabaseQuery) => Promise<void>;
  onCommand: (command: DatabaseCommand) => Promise<DatabaseCommandResult>;
  onOpenRow: (id: string) => void;
  onFindReferences?: FindDatabaseReferences;
  onFindPeople?: FindDatabasePeople;
};
export function DatabaseWorkspace(props: DatabaseWorkspaceProps) {
  const view = props.data.views.find((item) => item.id === props.data.viewId) ?? props.data.views[0];
  if (!view) return <p role="alert">Nenhuma visualização disponível. Atualize a página.</p>;
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
      setError("Não foi possível atualizar a consulta. Os dados exibidos foram mantidos.");
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
          setNotice("Alterações salvas.");
        } catch {
          setError(
            "A alteração foi salva, mas não foi possível atualizar a consulta. Atualize os dados; não é necessário repetir a alteração.",
          );
        }
      }
      return result;
    } catch {
      setError(
        "Não foi possível concluir a alteração. Verifique a conexão e atualize os dados antes de tentar novamente.",
      );
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
      .catch(() => setError("Não foi possível abrir esta visualização."))
      .finally(() => setPending((count) => count - 1));
  };
  return (
    <section className="db-workspace" aria-label={data.title || "Base de dados"} aria-busy={pending > 0}>
      <header className="db-header">
        <div>
          <p className="db-eyebrow">Base de dados</p>
          <h2>{data.title || "Base sem título"}</h2>
        </div>
        {data.editable ? (
          <button type="button" onClick={() => setCreating(true)}>
            Novo registro
          </button>
        ) : (
          <span className="db-readonly">Somente leitura</span>
        )}
      </header>
      <div
        className="db-view-tabs"
        role="tablist"
        aria-label="Visualizações da base"
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
              Nova visualização
            </button>
            <button type="button" onClick={() => setViewEditor({ value: view, duplicate: false })}>
              Configurar visualização
            </button>
            <button type="button" onClick={() => setViewEditor({ value: view, duplicate: true })}>
              Duplicar visualização
            </button>
            <button type="button" disabled={data.views.length <= 1} onClick={() => setDeleteView(true)}>
              Excluir visualização
            </button>
          </>
        )}
        <button type="button" disabled={pending > 0} onClick={() => void refresh().catch(() => undefined)}>
          Atualizar dados
        </button>
        {view.type === "calendar" && (
          <label>
            Mês
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
            Carregar mais registros
          </button>
        )}
      </div>
      {data.editable && (
        <>
          <details className="db-panel">
            <summary>Propriedades da base</summary>
            <ul className="db-property-list">
              {data.properties.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.name} <small>{PROPERTY_LABELS[item.type]}</small>
                  </span>
                  <button type="button" onClick={() => setProperty({ value: item })}>
                    Editar {item.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setProperty({ value: null })}>
              Nova propriedade
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
        <DatabaseDialog title="Excluir visualização?" onClose={() => setDeleteView(false)}>
          <p>Os registros e seus conteúdos serão mantidos. A última visualização não pode ser excluída.</p>
          <div className="db-actions">
            <button
              type="button"
              disabled={pending > 0 || data.views.length <= 1}
              onClick={() => {
                void run({ action: "deleteView", id: view.id, expectedRevision: view.revision }).then(
                  (result) => {
                    if (result.ok) setDeleteView(false);
                    else setError("Não foi possível excluir a visualização.");
                  },
                );
              }}
            >
              Excluir visualização
            </button>
            <button type="button" onClick={() => setDeleteView(false)}>
              Cancelar
            </button>
          </div>
        </DatabaseDialog>
      )}
      {creating && (
        <DatabaseDialog title="Novo registro" onClose={() => setCreating(false)}>
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
                  } else setError("Não foi possível criar o registro.");
                },
              );
            }}
          >
            <label>
              Título do registro
              <input maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Template
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                <option value="">Página em branco</option>
                {data.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.title}
                  </option>
                ))}
              </select>
            </label>
            {templateId && (
              <p>
                O corpo e os valores padrão do template serão copiados para um novo registro. Destinos de
                relações serão verificados novamente.
              </p>
            )}
            <div className="db-actions">
              <button type="submit" disabled={pending > 0}>
                Criar registro
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancelar
              </button>
            </div>
          </form>
        </DatabaseDialog>
      )}
    </section>
  );
}
