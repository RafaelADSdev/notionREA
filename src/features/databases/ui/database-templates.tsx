"use client";
import { useState } from "react";
import type { DatabaseData, DatabaseTemplate } from "../types";
import { DatabaseDialog } from "./database-dialog";
import type { RunCommand } from "./database-value";

function TemplateRow({
  template,
  run,
  onOpen,
  onRemove,
}: {
  template: DatabaseTemplate;
  run: RunCommand;
  onOpen: (id: string) => void;
  onRemove: (template: DatabaseTemplate) => void;
}) {
  const [title, setTitle] = useState(template.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const save = async (duplicate: boolean) => {
    setPending(true);
    setError("");
    try {
      const result = await run({
        action: "template",
        id: duplicate ? null : template.id,
        title: duplicate ? `${template.title} (cópia)` : title,
        expectedRevision: duplicate ? 0 : template.revision,
        ...(duplicate ? { pageId: template.pageId } : {}),
      });
      if (!result.ok) setError("Não foi possível salvar o template. Atualize os dados e tente novamente.");
    } catch {
      setError("Não foi possível salvar o template.");
    } finally {
      setPending(false);
    }
  };
  return (
    <li className="db-template-row">
      <form
        className="db-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        <label>
          Nome do template
          <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <button disabled={pending} type="submit">
          Renomear
        </button>
        <button type="button" onClick={() => onOpen(template.pageId)}>
          Editar corpo e padrões
        </button>
        <button type="button" disabled={pending} onClick={() => void save(true)}>
          Duplicar
        </button>
        <button type="button" disabled={pending} onClick={() => onRemove(template)}>
          Excluir
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </li>
  );
}
export function TemplatePanel({
  data,
  run,
  onOpen,
}: {
  data: DatabaseData;
  run: RunCommand;
  onOpen: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [removal, setRemoval] = useState<DatabaseTemplate | null>(null);
  const [error, setError] = useState("");
  return (
    <details className="db-panel">
      <summary>Templates da base</summary>
      <p>
        Edite o corpo e as propriedades da página de template para definir os padrões. Novos registros recebem
        identidades próprias; registros existentes não são alterados.
      </p>
      <ul className="db-template-list">
        {data.templates.map((template) => (
          <TemplateRow
            key={`${template.id}:${template.revision}`}
            template={template}
            run={run}
            onOpen={onOpen}
            onRemove={setRemoval}
          />
        ))}
      </ul>
      {!data.templates.length && <p>Ainda não há templates.</p>}
      <form
        className="db-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const create = async () => {
            setPending(true);
            setError("");
            try {
              const result = await run({ action: "template", id: null, title, expectedRevision: 0 });
              if (!result.ok) setError("Não foi possível criar o template.");
              else {
                setTitle("");
                if (result.pageId) onOpen(result.pageId);
              }
            } catch {
              setError("Não foi possível criar o template.");
            } finally {
              setPending(false);
            }
          };
          void create();
        }}
      >
        <label>
          Novo template
          <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <button disabled={pending} type="submit">
          Criar template
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {removal && (
        <DatabaseDialog title="Excluir template?" onClose={() => setRemoval(null)}>
          <p>O template será removido. Os registros criados a partir dele serão mantidos.</p>
          <div className="db-actions">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void run({ action: "deleteTemplate", id: removal.id, expectedRevision: removal.revision })
                  .then((result) => {
                    if (result.ok) setRemoval(null);
                    else setError("Não foi possível excluir o template.");
                  })
                  .catch(() => setError("Não foi possível excluir o template."))
                  .finally(() => setPending(false));
              }}
            >
              Excluir template
            </button>
            <button type="button" onClick={() => setRemoval(null)}>
              Cancelar
            </button>
          </div>
        </DatabaseDialog>
      )}
    </details>
  );
}
