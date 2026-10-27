"use client";
import { useState } from "react";
import type { InterchangeJob } from "../model/contracts";
import { CsvMappingEditor } from "./csv-mapping-editor";
import { phases, useInterchangeText, warningDescription } from "./text";
import type { useInterchangeJobs } from "./use-interchange-jobs";

function warningRows(job: InterchangeJob) {
  const counts = new Map<string, number>();
  return job.report.map((warning) => {
    const signature = JSON.stringify(warning),
      count = counts.get(signature) ?? 0;
    counts.set(signature, count + 1);
    return { id: `${signature}:${count}`, warning };
  });
}
const states = {
  pending: ["Enfileirado", "Queued"],
  ready: ["Validado", "Validated"],
  running: ["Em processamento", "Processing"],
  done: ["Concluído", "Completed"],
  error: ["Requer atenção", "Needs attention"],
  skipped: ["Não importado", "Skipped"],
} satisfies Record<string, [string, string]>;
export function InterchangeJobPanel({
  manager,
  dirty,
  onDirty,
}: {
  manager: ReturnType<typeof useInterchangeJobs>;
  dirty: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const text = useInterchangeText(),
    detail = manager.detail;
  const [confirmed, setConfirmed] = useState(false),
    [csvKey, setCsvKey] = useState("");
  if (!detail)
    return (
      <p>
        {text(
          "Escolha um trabalho para consultar a prévia e o relatório.",
          "Choose a job to review its preview and report.",
        )}
      </p>
    );
  const { job, items } = detail;
  const csv = items.filter((item) => item.header?.length),
    selectedCsv = csv.find((item) => item.key === csvKey) ?? csv[0];
  const busy = manager.busy || manager.loading;
  return (
    <section
      className="interchange-job"
      aria-label={text("Trabalho selecionado", "Selected job")}
      aria-busy={busy}
    >
      <header>
        <h3>
          {job.sourceName ||
            text(
              job.kind === "export" ? "Exportação" : "Importação",
              job.kind === "export" ? "Export" : "Import",
            )}
        </h3>
        <p className="interchange-phase" role="status">
          {text(...phases[job.state])}
        </p>
        <progress
          aria-label={text("Progresso do trabalho", "Job progress")}
          {...(manager.upload && job.state === "uploading"
            ? { value: manager.upload.bytes, max: manager.upload.total }
            : job.state === "complete"
              ? { value: 1, max: 1 }
              : {})}
        />
      </header>
      {job.kind === "import" && !job.confirmed && (
        <p className="interchange-warning">
          {text(
            "Nenhuma página é criada antes da sua confirmação da prévia.",
            "No pages are created before you confirm the preview.",
          )}
        </p>
      )}
      {job.state === "uploading" && (
        <p>
          {text(
            "Para retomar o envio, selecione o mesmo ZIP no formulário acima. O tamanho e a verificação do arquivo precisam coincidir.",
            "To resume upload, select the same ZIP in the form above. Its size and checksum must match.",
          )}
        </p>
      )}
      <div className="interchange-actions">
        {(job.state === "scanning" || job.state === "running") && (
          <button type="button" disabled={busy} onClick={() => void manager.resume()}>
            {text("Retomar processamento", "Resume processing")}
          </button>
        )}
        {manager.busy && (
          <button type="button" onClick={manager.stop}>
            {text("Pausar após o lote enviado", "Pause after the submitted batch")}
          </button>
        )}
        <button type="button" disabled={busy || dirty} onClick={() => void manager.load(job.id)}>
          {text("Atualizar trabalho", "Refresh job")}
        </button>
        {!["complete", "cancelled"].includes(job.state) && (
          <button
            type="button"
            onClick={() => {
              onDirty(false);
              void manager.action({ action: "cancel" });
            }}
          >
            {text("Cancelar trabalho", "Cancel job")}
          </button>
        )}
        {job.kind === "export" && job.state === "complete" && (
          <button
            className="interchange-primary"
            type="button"
            disabled={busy}
            onClick={() => void manager.download()}
          >
            {text("Baixar ZIP autorizado", "Download authorized ZIP")}
          </button>
        )}
        {job.rootPageId && (
          <a href={`/w/${job.workspaceId}/p/${job.rootPageId}`}>
            {text(
              job.kind === "import" ? "Abrir raiz criada" : "Abrir página",
              job.kind === "import" ? "Open created root" : "Open page",
            )}
          </a>
        )}
      </div>
      {job.state === "cancelled" && (
        <p>
          {text(
            "Os próximos lotes foram cancelados. Itens já criados permanecem na raiz deste trabalho.",
            "Future batches were cancelled. Already created items remain under this job's root.",
          )}
        </p>
      )}
      <div className="interchange-table-scroll">
        <table className="interchange-items">
          <caption>{text("Inventário e resultado por item", "Inventory and per-item results")}</caption>
          <thead>
            <tr>
              <th>{text("Arquivo ou item", "File or item")}</th>
              <th>{text("Estado", "Status")}</th>
              <th>{text("Resultado", "Result")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td>{item.path ?? item.key}</td>
                <td>{text(...states[item.state])}</td>
                <td>
                  {item.error ? (
                    <span>{item.error}</span>
                  ) : item.pageId ? (
                    <a href={`/w/${job.workspaceId}/p/${item.pageId}`}>
                      {text("Abrir página criada", "Open created page")}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="interchange-actions">
        <button type="button" disabled={busy || dirty} onClick={() => void manager.load(job.id)}>
          {text("Primeira página de itens", "First page of items")}
        </button>
        {detail.nextIndex !== null && (
          <button
            type="button"
            disabled={busy || dirty}
            onClick={() => void manager.load(job.id, detail.nextIndex ?? -1)}
          >
            {text("Próxima página de itens", "Next page of items")}
          </button>
        )}
      </div>
      {job.state === "preview" && selectedCsv && (
        <section aria-label={text("Mapeamento CSV", "CSV mapping")}>
          <label>
            {text("CSV a revisar nesta página de itens", "CSV to review on this item page")}
            <select
              value={selectedCsv.key}
              disabled={busy || dirty}
              onChange={(event) => setCsvKey(event.target.value)}
            >
              {csv.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.path ?? item.key}
                </option>
              ))}
            </select>
          </label>
          <CsvMappingEditor
            key={`${selectedCsv.key}:${job.revision}`}
            item={selectedCsv}
            busy={busy}
            onDirty={onDirty}
            onSave={(mapping) => manager.action({ action: "configure", mappings: [mapping] })}
          />
        </section>
      )}
      <details className="interchange-reports">
        <summary>
          {text("Relatório e avisos", "Report and notices")} ({job.report.length})
        </summary>
        {job.report.length ? (
          <ol>
            {warningRows(job).map(({ id, warning }) => (
              <li key={id}>
                {warningDescription(warning.code, text)}
                {warning.path && <small>{warning.path}</small>}
                {warning.count !== undefined && (
                  <small>
                    {text("Ocorrências", "Occurrences")}: {warning.count}
                  </small>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p>{text("Nenhum aviso registrado até esta etapa.", "No notices recorded at this step.")}</p>
        )}
      </details>
      {job.kind === "import" && job.state === "preview" && !job.confirmed && (
        <div className="interchange-warning">
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || dirty}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {text(
              "Revisei o inventário, os mapeamentos e os avisos. Autorizo criar novas páginas na importação.",
              "I reviewed the inventory, mappings and notices. I authorize creating new pages for this import.",
            )}
          </label>
          {dirty && (
            <p>
              {text(
                "Salve ou descarte as alterações de mapeamento antes de confirmar.",
                "Save or discard mapping changes before confirming.",
              )}
            </p>
          )}
          <button
            type="button"
            className="interchange-primary"
            disabled={!confirmed || busy || dirty}
            onClick={() => {
              setConfirmed(false);
              void manager.action({ action: "confirm" });
            }}
          >
            {text("Confirmar importação", "Confirm import")}
          </button>
        </div>
      )}
    </section>
  );
}
