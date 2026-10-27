"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { INTERCHANGE_LIMITS } from "../model/contracts";
import { InterchangeJobPanel } from "./interchange-job";
import { phases, useInterchangeText } from "./text";
import { activeInterchangeJob, useInterchangeJobs } from "./use-interchange-jobs";
import "./interchange.css";

export function ImportExportControl({ workspaceId, pageId }: { workspaceId: string; pageId?: string }) {
  const text = useInterchangeText(),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(false);
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  const close = useCallback(() => {
    setOpen(false);
    setActive(false);
  }, []);
  return (
    <div className="interchange-control">
      <button type="button" onClick={() => setOpen(true)}>
        {text("Importar / exportar", "Import / export")}
      </button>
      {active && <span role="status">{text("Trabalho em andamento", "Job in progress")}</span>}
      {open && (
        <InterchangeDialog
          key={workspaceId}
          workspaceId={workspaceId}
          {...(pageId ? { pageId } : {})}
          onClose={close}
          onActivity={setActive}
        />
      )}
    </div>
  );
}
function InterchangeDialog({
  workspaceId,
  pageId,
  onClose,
  onActivity,
}: {
  workspaceId: string;
  pageId?: string;
  onClose: () => void;
  onActivity: (active: boolean) => void;
}) {
  const text = useInterchangeText(),
    manager = useInterchangeJobs(workspaceId, onActivity),
    id = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    closeButton = useRef<HTMLButtonElement>(null),
    confirmClose = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null),
    [nested, setNested] = useState(Boolean(pageId)),
    [dirty, setDirty] = useState(false),
    [closing, setClosing] = useState(false),
    [fileError, setFileError] = useState("");
  useEffect(() => {
    const previous = document.activeElement,
      element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    heading.current?.focus();
    return () => {
      if (element?.open && typeof element.close === "function") element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (closing) confirmClose.current?.focus();
  }, [closing]);
  const requestClose = () => {
    if (manager.busy || activeInterchangeJob(manager.detail?.job) || dirty) setClosing(true);
    else {
      manager.stop();
      onClose();
    }
  };
  const busy = manager.busy || manager.loading;
  return (
    <dialog
      ref={dialog}
      className="interchange-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.nativeEvent.isComposing) event.preventDefault();
      }}
    >
      <header>
        <div>
          <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
            {text("Importar e exportar", "Import and export")}
          </h2>
          <p>
            {text(
              "Arquivos privados, revisão antes de importar e trabalhos retomáveis.",
              "Private archives, review before importing and resumable jobs.",
            )}
          </p>
        </div>
        <button ref={closeButton} type="button" onClick={requestClose}>
          {text("Fechar", "Close")}
        </button>
      </header>
      {closing && (
        <div className="interchange-warning" role="alert">
          <p>
            {text(
              "Fechar pausa os próximos lotes nesta aba. Um lote já enviado pode concluir. Você poderá retomar o mesmo trabalho; mapeamentos ainda não salvos serão descartados.",
              "Closing pauses future batches in this tab. An already submitted batch may finish. You can resume the same job; unsaved mapping changes will be discarded.",
            )}
          </p>
          <div className="interchange-actions">
            <button
              ref={confirmClose}
              type="button"
              onClick={() => {
                manager.stop();
                onClose();
              }}
            >
              {text("Pausar e fechar", "Pause and close")}
            </button>
            <button
              type="button"
              onClick={() => {
                setClosing(false);
                closeButton.current?.focus();
              }}
            >
              {text("Continuar aqui", "Stay here")}
            </button>
          </div>
        </div>
      )}
      <div className="interchange-start">
        <section>
          <h3>{text("Importar ZIP", "Import ZIP")}</h3>
          <p className="interchange-hint">
            {text(
              "Markdown, CSV e anexos · até 50 MiB. O ZIP é validado no servidor; nenhuma conexão à conta de outro produto.",
              "Markdown, CSV and attachments · up to 50 MiB. The archive is validated on the server; no connection to another product account.",
            )}
          </p>
          <label htmlFor={`${id}-file`}>{text("Arquivo ZIP original", "Original ZIP archive")}</label>
          <input
            id={`${id}-file`}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={busy}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFileError("");
              if (
                selected &&
                (selected.size < 1 ||
                  selected.size > INTERCHANGE_LIMITS.sourceBytes ||
                  !/\.zip$/i.test(selected.name))
              ) {
                setFile(null);
                setFileError(text("Escolha um ZIP de até 50 MiB.", "Choose a ZIP of up to 50 MiB."));
                return;
              }
              setFile(selected);
            }}
          />
          {pageId && (
            <label>
              <input
                type="checkbox"
                checked={nested}
                disabled={busy}
                onChange={(event) => setNested(event.target.checked)}
              />
              {text(
                "Criar a raiz importada dentro da página atual",
                "Create the imported root inside the current page",
              )}
            </label>
          )}
          <div className="interchange-actions">
            <button
              className="interchange-primary"
              type="button"
              disabled={!file || busy || dirty}
              onClick={() => {
                if (file)
                  void (manager.detail?.job.state === "uploading"
                    ? manager.resumeUpload(file)
                    : manager.importFile(file, nested ? (pageId ?? null) : null));
              }}
            >
              {manager.detail?.job.state === "uploading"
                ? text("Retomar envio do mesmo ZIP", "Resume uploading the same ZIP")
                : text("Enviar e validar ZIP", "Upload and validate ZIP")}
            </button>
          </div>
          {fileError && <p role="alert">{fileError}</p>}
        </section>
        <section>
          <h3>{text("Exportar subárvore", "Export subtree")}</h3>
          <p>
            {text(
              "Cria um ZIP com Markdown, CSV e arquivos autorizados. Formatação não representável será informada no relatório.",
              "Creates a ZIP with authorized Markdown, CSV and files. Unrepresentable formatting is listed in the report.",
            )}
          </p>
          {pageId ? (
            <button type="button" disabled={busy || dirty} onClick={() => void manager.exportPage(pageId)}>
              {text("Preparar exportação desta página", "Prepare this page's export")}
            </button>
          ) : (
            <p className="interchange-hint">
              {text(
                "Abra uma página para exportar sua subárvore autorizada.",
                "Open a page to export its authorized subtree.",
              )}
            </p>
          )}
          <div className="interchange-actions">
            <button
              type="button"
              disabled={busy || dirty}
              onClick={() => {
                manager.newWork();
                setFile(null);
                setDirty(false);
              }}
            >
              {text("Iniciar outro trabalho", "Start another job")}
            </button>
          </div>
        </section>
      </div>
      {manager.error && (
        <p className="interchange-error" role="alert">
          {manager.error}
        </p>
      )}
      {manager.notice && <p role="status">{manager.notice}</p>}
      <div className="interchange-layout">
        <aside className="interchange-history" aria-label={text("Meus trabalhos", "My jobs")}>
          <h3>{text("Meus trabalhos", "My jobs")}</h3>
          <button type="button" disabled={busy || dirty} onClick={() => void manager.list()}>
            {text("Atualizar lista", "Refresh list")}
          </button>
          <ol>
            {manager.jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  disabled={busy || dirty}
                  aria-pressed={manager.detail?.job.id === job.id}
                  onClick={() => {
                    setDirty(false);
                    void manager.load(job.id);
                  }}
                >
                  <strong>
                    {job.sourceName ||
                      text(
                        job.kind === "export" ? "Exportação" : "Importação",
                        job.kind === "export" ? "Export" : "Import",
                      )}
                  </strong>
                  <small>{text(...phases[job.state])}</small>
                </button>
              </li>
            ))}
          </ol>
          {manager.loading && <p role="status">{text("Carregando…", "Loading…")}</p>}
          {manager.nextCursor && (
            <button
              type="button"
              disabled={busy || dirty}
              onClick={() => void manager.list(manager.nextCursor)}
            >
              {text("Mais trabalhos", "More jobs")}
            </button>
          )}
        </aside>
        <InterchangeJobPanel
          key={`${manager.detail?.job.id ?? "none"}:${manager.detail?.job.state ?? "none"}:${manager.detail?.items[0]?.index ?? -1}`}
          manager={manager}
          dirty={dirty}
          onDirty={setDirty}
        />
      </div>
    </dialog>
  );
}
