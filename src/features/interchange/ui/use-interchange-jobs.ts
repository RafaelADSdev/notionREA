"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CsvMapping, InterchangeJob } from "../model/contracts";
import {
  InterchangeClient,
  type InterchangeDetail,
  InterchangeHttpError,
  InterchangeQueue,
  uploadInterchangeSource,
  zipDigest,
} from "./job-client";
import { useInterchangeText } from "./text";

export function activeInterchangeJob(job: InterchangeJob | undefined): boolean {
  return Boolean(job && ["uploading", "scanning", "running"].includes(job.state));
}
export function useInterchangeJobs(workspaceId: string, onActivity: (active: boolean) => void) {
  const text = useInterchangeText();
  // The dialog is keyed by workspace, keeping operation receipts stable until it closes.
  const [client] = useState(() => new InterchangeClient(workspaceId));
  const [queue] = useState(() => new InterchangeQueue(client));
  const [jobs, setJobs] = useState<InterchangeJob[]>([]),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [detail, setDetail] = useState<InterchangeDetail | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [upload, setUpload] = useState<{ bytes: number; total: number } | null>(null);
  const latest = useRef<InterchangeDetail | null>(null),
    generation = useRef(0),
    request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const update = useCallback(
    (value: InterchangeDetail) => {
      latest.current = value;
      setDetail(value);
      setJobs((current) => [value.job, ...current.filter((job) => job.id !== value.job.id)]);
      onActivity(activeInterchangeJob(value.job));
    },
    [onActivity],
  );
  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof InterchangeHttpError && [401, 403, 404].includes(error.status)) {
        latest.current = null;
        setDetail(null);
        setJobs([]);
        onActivity(false);
        setError(
          text(
            "Este trabalho não está disponível para esta conta. O acesso é conferido novamente em cada etapa.",
            "This job is unavailable to this account. Access is checked again at every step.",
          ),
        );
      } else
        setError(
          error instanceof InterchangeHttpError && [400, 413, 422].includes(error.status)
            ? text(
                "Confira o ZIP original e o mapeamento. Atualize o trabalho para consultar os itens que precisam de atenção.",
                "Check the original ZIP and mappings. Refresh the job to review items needing attention.",
              )
            : text(
                "Não foi possível confirmar a última etapa. Atualize o trabalho antes de retomar; itens já gravados não devem ser recriados.",
                "The latest step could not be confirmed. Refresh before resuming; already saved items must not be recreated.",
              ),
        );
    },
    [text, onActivity],
  );
  const abort = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    queue.stop();
  }, [queue]);
  const stop = useCallback(() => {
    abort();
    setBusy(false);
  }, [abort]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort();
    };
  }, [abort]);
  const list = useCallback(
    async (cursor?: string | null) => {
      const sequence = generation.current;
      setLoading(true);
      try {
        const result = await client.list(cursor);
        if (!mounted.current || sequence !== generation.current) return;
        setJobs((current) =>
          cursor
            ? [...new Map([...current, ...result.jobs].map((job) => [job.id, job])).values()]
            : result.jobs,
        );
        setNextCursor(result.nextCursor);
      } catch (error) {
        if (mounted.current && sequence === generation.current) fail(error);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [client, fail],
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void list();
    });
    return () => {
      active = false;
    };
  }, [list]);
  const load = async (id: string, afterIndex = -1) => {
    const sequence = generation.current;
    setLoading(true);
    setError("");
    try {
      const value = await client.detail(id, afterIndex);
      if (mounted.current && sequence === generation.current) update(value);
    } catch (error) {
      if (mounted.current && sequence === generation.current) fail(error);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  const perform = async (
    action: (signal: AbortSignal, accept: (detail: InterchangeDetail) => void) => Promise<void>,
  ) => {
    stop();
    const sequence = generation.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    onActivity(true);
    try {
      await action(controller.signal, (value) => {
        if (generation.current === sequence && !controller.signal.aborted) update(value);
      });
    } catch (error) {
      if (!controller.signal.aborted && generation.current === sequence) fail(error);
    } finally {
      if (generation.current === sequence) {
        setBusy(false);
        request.current = null;
        onActivity(activeInterchangeJob(latest.current?.job));
      }
    }
  };
  const advance = async (
    job: InterchangeJob,
    accept: (value: InterchangeDetail) => void,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted();
    const result = await queue.run(job, accept);
    if (result.reason === "bounded" || result.reason === "unchanged")
      setNotice(
        text(
          "Processamento pausado entre lotes. Você pode retomar pelo mesmo trabalho.",
          "Processing paused between batches. Resume the same job to continue.",
        ),
      );
  };
  const importFile = async (file: File, parentId: string | null) =>
    perform(async (signal, accept) => {
      setUpload(null);
      setNotice(text("Calculando a verificação do arquivo…", "Calculating the archive checksum…"));
      const digest = await zipDigest(file, signal);
      const created = await client.create(
        { kind: "import", workspaceId, parentId, name: file.name, size: file.size, digest },
        signal,
      );
      let current = await client.detail(created.job.id, -1, signal);
      accept(current);
      if (current.job.state === "uploading") {
        if (!current.upload) throw new InterchangeHttpError(503);
        try {
          await uploadInterchangeSource(current.job, current.upload, file, signal, (bytes, total) =>
            setUpload({ bytes, total }),
          );
        } catch (error) {
          if (!(error instanceof InterchangeHttpError && error.status === 409)) throw error;
        }
        current = await client.action(current.job.id, { action: "scan" }, signal);
        accept(current);
      }
      setNotice("");
      await advance(current.job, accept, signal);
    });
  const exportPage = async (pageId: string) =>
    perform(async (signal, accept) => {
      const created = await client.create({ kind: "export", workspaceId, pageId }, signal);
      const current = await client.detail(created.job.id, -1, signal);
      accept(current);
      await advance(current.job, accept, signal);
    });
  const resumeUpload = async (file: File) => {
    const selected = latest.current?.job;
    if (!selected) return;
    await perform(async (signal, accept) => {
      const digest = await zipDigest(file, signal);
      if (digest !== selected.sourceDigest || file.size !== selected.sourceSize)
        throw new InterchangeHttpError(400);
      const current = await client.detail(selected.id, -1, signal);
      accept(current);
      if (current.job.state !== "uploading" || !current.upload) {
        await advance(current.job, accept, signal);
        return;
      }
      try {
        await uploadInterchangeSource(current.job, current.upload, file, signal, (bytes, total) =>
          setUpload({ bytes, total }),
        );
      } catch (error) {
        if (!(error instanceof InterchangeHttpError && error.status === 409)) throw error;
      }
      const scanned = await client.action(selected.id, { action: "scan" }, signal);
      accept(scanned);
      await advance(scanned.job, accept, signal);
    });
  };
  const action = async (
    command: { action: "confirm" | "cancel" | "scan" } | { action: "configure"; mappings: CsvMapping[] },
  ): Promise<boolean> => {
    const selected = latest.current?.job;
    if (!selected) return false;
    let accepted = false;
    await perform(async (signal, accept) => {
      const result = await client.action(selected.id, command, signal);
      accepted = true;
      accept(result);
      await advance(result.job, accept, signal);
    });
    return accepted;
  };
  const resume = async () => {
    const selected = latest.current?.job;
    if (selected)
      await perform(async (signal, accept) => {
        const current = await client.detail(selected.id, -1, signal);
        accept(current);
        await advance(current.job, accept, signal);
      });
  };
  const newWork = () => {
    stop();
    client.beginNewOperation();
    latest.current = null;
    setDetail(null);
    setUpload(null);
    setError("");
    setNotice("");
    onActivity(false);
  };
  const download = async () => {
    const selected = latest.current?.job;
    if (!selected) return;
    try {
      const current = await client.detail(selected.id);
      update(current);
      if (current.job.state !== "complete" || current.job.kind !== "export") return;
      const anchor = document.createElement("a");
      anchor.href = `/api/interchange/${current.job.id}/download`;
      anchor.download = "Bloco-export.zip";
      anchor.click();
      setNotice(
        text("O download foi solicitado ao navegador.", "The download was requested from your browser."),
      );
    } catch (error) {
      fail(error);
    }
  };
  return {
    jobs,
    nextCursor,
    detail,
    busy,
    loading,
    error,
    notice,
    upload,
    list,
    load,
    stop,
    importFile,
    exportPage,
    resumeUpload,
    action,
    resume,
    newWork,
    download,
  };
}
