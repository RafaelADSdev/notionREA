"use client";

import { useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
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
  const t = useTranslations();

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
        title: duplicate ? `${template.title}${t("database.copySuffix")}` : title,
        expectedRevision: duplicate ? 0 : template.revision,
        ...(duplicate ? { pageId: template.pageId } : {}),
      });
      if (!result.ok) setError(t("database.saveTemplateRefreshFailed"));
    } catch {
      setError(t("database.saveTemplateFailed"));
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
          {t("database.templateName")}
          <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <button disabled={pending} type="submit">
          {t("common.rename")}
        </button>
        <button type="button" onClick={() => onOpen(template.pageId)}>
          {t("database.editTemplateBody")}
        </button>
        <button type="button" disabled={pending} onClick={() => void save(true)}>
          {t("common.duplicate")}
        </button>
        <button type="button" disabled={pending} onClick={() => onRemove(template)}>
          {t("common.delete")}
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
  const t = useTranslations();

  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [removal, setRemoval] = useState<DatabaseTemplate | null>(null);
  const [error, setError] = useState("");
  return (
    <details className="db-panel">
      <summary>{t("database.templates")}</summary>
      <p>{t("database.templateNotice")}</p>
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
      {!data.templates.length && <p>{t("database.noTemplates")}</p>}
      <form
        className="db-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const create = async () => {
            setPending(true);
            setError("");
            try {
              const result = await run({ action: "template", id: null, title, expectedRevision: 0 });
              if (!result.ok) setError(t("database.createTemplateFailed"));
              else {
                setTitle("");
                if (result.pageId) onOpen(result.pageId);
              }
            } catch {
              setError(t("database.createTemplateFailed"));
            } finally {
              setPending(false);
            }
          };
          void create();
        }}
      >
        <label>
          {t("database.newTemplate")}
          <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <button disabled={pending} type="submit">
          {t("database.createTemplate")}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {removal && (
        <DatabaseDialog title={t("database.deleteTemplateQuestion")} onClose={() => setRemoval(null)}>
          <p>{t("database.deleteTemplateNotice")}</p>
          <div className="db-actions">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void run({ action: "deleteTemplate", id: removal.id, expectedRevision: removal.revision })
                  .then((result) => {
                    if (result.ok) setRemoval(null);
                    else setError(t("database.deleteTemplateFailed"));
                  })
                  .catch(() => setError(t("database.deleteTemplateFailed")))
                  .finally(() => setPending(false));
              }}
            >
              {t("database.deleteTemplate")}
            </button>
            <button type="button" onClick={() => setRemoval(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </DatabaseDialog>
      )}
    </details>
  );
}
