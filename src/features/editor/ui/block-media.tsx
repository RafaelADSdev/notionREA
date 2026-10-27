"use client";
import Image from "next/image";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { PreparedFileUpload } from "@/features/files/actions";
import { finishBlockUpload, prepareBlockUpload } from "@/features/files/block-actions";
import type { BlockFileResolver } from "@/features/files/types";
import { blockUploadSchema } from "@/features/files/validation";
import type { StablePage } from "../model/stable-page";

export type { BlockFileResolver, PageFileInfo } from "@/features/files/types";

function uploadBytes(
  prepared: PreparedFileUpload,
  file: File,
  kind: "image" | "file",
  signal: AbortSignal,
  onProgress: (value: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      request.onload = null;
      request.onerror = null;
      request.onabort = null;
      request.upload.onprogress = null;
      if (error) reject(error);
      else resolve();
    };
    request.open("PUT", prepared.signedUrl);
    request.setRequestHeader("x-upsert", "false");
    request.onload = () =>
      finish(request.status >= 200 && request.status < 300 ? undefined : new Error("Upload failed"));
    request.onerror = () => finish(new Error("Upload failed"));
    request.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    signal.addEventListener("abort", abort, { once: true });
    const form = new FormData();
    form.append("cacheControl", "0");
    form.append("", kind === "file" ? file.slice(0, file.size, "application/octet-stream") : file, file.name);
    request.send(form);
  });
}

function MediaField({
  label,
  value,
  editable,
  onCommit,
  onPreview,
  type = "text",
}: {
  label: string;
  value: string;
  editable: boolean;
  onCommit: (value: string) => void;
  onPreview?: (value: string) => void;
  type?: "text" | "number";
}) {
  const input = useRef<HTMLInputElement>(null);
  const changed = useRef(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!changed.current) setDraft(value);
  }, [value]);
  if (!editable) return null;
  return (
    <label className="block-media-field">
      {label}
      <input
        ref={input}
        type={type}
        value={draft}
        {...(type === "number" ? { min: 10, max: 4096 } : { maxLength: 1000 })}
        onChange={(event) => {
          changed.current = true;
          setDraft(event.currentTarget.value);
          onPreview?.(event.currentTarget.value);
        }}
        onBlur={() => {
          if (changed.current && draft !== value) onCommit(draft);
          changed.current = false;
        }}
      />
    </label>
  );
}

export function BlockMedia({
  page,
  blockId,
  pageId,
  editable,
  kind,
  resolver,
}: {
  page: StablePage;
  blockId: string;
  pageId: string;
  editable: boolean;
  kind: "image" | "file";
  resolver: BlockFileResolver;
}) {
  const attrs = page.getBlockAttributes(blockId);
  const fileId = typeof attrs.fileId === "string" ? attrs.fileId : null;
  const info = useSyncExternalStore(
    (listener) => resolver.subscribe(listener),
    () => (fileId ? resolver.resolve(fileId) : null),
    () => null,
  );
  useEffect(() => {
    if (fileId) resolver.ensure(fileId);
  }, [fileId, resolver]);
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null);
  const permission = useRef(editable),
    generation = useRef(0),
    retryFile = useRef<File | null>(null),
    confirmedUpload = useRef<{ file: File; prepared: PreparedFileUpload } | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "uploading" | "confirming" | "failed">("idle");
  const [progress, setProgress] = useState(0),
    [feedback, setFeedback] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);
  const visibleCaption = captionDraft ?? String(attrs.caption ?? "");
  const statusId = useId();
  useEffect(() => {
    permission.current = editable;
    if (!editable) controller.current?.abort();
  }, [editable]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const busy = phase === "preparing" || phase === "uploading" || phase === "confirming";
  function commit(patch: Record<string, unknown>) {
    if (!permission.current || page.getBlock(blockId)?.type !== kind) return;
    try {
      page.setBlockAttributes(blockId, patch);
    } catch {
      setFeedback("Confira o valor informado e tente novamente.");
    }
  }
  async function upload(file: File) {
    if (!permission.current || busy) return;
    const declaration = { pageId, name: file.name, type: file.type, size: file.size, kind };
    if (!blockUploadSchema.safeParse(declaration).success) {
      retryFile.current = null;
      setCanRetry(false);
      setFeedback("Use PNG, JPEG, WebP ou GIF para imagens e arquivos de até 25 MiB.");
      setPhase("failed");
      return;
    }
    retryFile.current = file;
    setCanRetry(true);
    const version = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const current = () =>
      generation.current === version && permission.current && page.getBlock(blockId)?.type === kind;
    try {
      let prepared: PreparedFileUpload;
      if (confirmedUpload.current?.file === file) prepared = confirmedUpload.current.prepared;
      else {
        setPhase("preparing");
        setFeedback("Preparando envio…");
        const result = await prepareBlockUpload(declaration);
        if (!current()) return;
        if (!result.ok) {
          setFeedback(result.error);
          setPhase("failed");
          return;
        }
        prepared = result.value;
        if (abort.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
        setPhase("uploading");
        setProgress(0);
        setFeedback("Enviando arquivo…");
        await uploadBytes(prepared, file, kind, abort.signal, (value) => {
          if (current()) setProgress(value);
        });
        confirmedUpload.current = { file, prepared };
      }
      if (!current() || abort.signal.aborted) return;
      setPhase("confirming");
      setFeedback("Confirmando arquivo…");
      const result = await finishBlockUpload(prepared.fileId);
      if (!current()) return;
      if (!result.ok) {
        setFeedback(result.error);
        setPhase("failed");
        return;
      }
      resolver.prime(result.value);
      commit({ fileId: result.value.fileId });
      confirmedUpload.current = null;
      retryFile.current = null;
      setCanRetry(false);
      setPhase("idle");
      setFeedback("Arquivo adicionado.");
    } catch (error) {
      if (current()) {
        setPhase("failed");
        setFeedback(
          error instanceof DOMException && error.name === "AbortError"
            ? "Envio cancelado. Você pode tentar novamente."
            : "O envio não terminou. Confira sua conexão e tente novamente.",
        );
      }
    } finally {
      if (generation.current === version) {
        controller.current = null;
        if (!permission.current) setPhase("idle");
        if (input.current) input.current.value = "";
      }
    }
  }
  return (
    <figure className={`block-media block-media-${kind}`} aria-busy={busy}>
      {fileId && info ? (
        kind === "image" && info.width && info.height ? (
          <Image
            src={`/api/files/${info.fileId}`}
            alt={String(attrs.alt ?? "")}
            width={info.width}
            height={info.height}
            loading="lazy"
            unoptimized
            style={{
              maxWidth: "100%",
              height: "auto",
              ...(typeof attrs.width === "number" ? { width: attrs.width } : {}),
            }}
          />
        ) : (
          <a className="block-file-download" href={`/api/files/${info.fileId}`} download>
            {String(attrs.displayName ?? info.name)} <span>({info.size.toLocaleString("pt-BR")} bytes)</span>
          </a>
        )
      ) : (
        <p className="block-media-placeholder">
          {fileId
            ? "Arquivo indisponível ou carregando…"
            : kind === "image"
              ? "Adicione uma imagem."
              : "Adicione um arquivo."}
        </p>
      )}
      {visibleCaption && <figcaption>{visibleCaption}</figcaption>}
      {editable && (
        <div className="block-media-controls">
          <button
            type="button"
            disabled={busy}
            aria-describedby={statusId}
            onClick={() => input.current?.click()}
          >
            {fileId ? "Trocar arquivo" : kind === "image" ? "Enviar imagem" : "Enviar arquivo"}
          </button>
          <input
            ref={input}
            hidden
            tabIndex={-1}
            aria-label={kind === "image" ? "Imagem do bloco" : "Arquivo do bloco"}
            type="file"
            disabled={busy}
            {...(kind === "image" ? { accept: "image/png,image/jpeg,image/webp,image/gif" } : {})}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
            }}
          />
          {(phase === "preparing" || phase === "uploading") && (
            <button type="button" onClick={() => controller.current?.abort()}>
              Cancelar envio
            </button>
          )}
          {phase === "failed" && canRetry && (
            <button
              type="button"
              onClick={() => {
                const file = retryFile.current;
                if (file) void upload(file);
              }}
            >
              Tentar envio novamente
            </button>
          )}
          {phase === "uploading" && (
            <progress aria-label="Progresso do envio" value={progress} max={100}>
              {progress}%
            </progress>
          )}
          {kind === "image" && (
            <MediaField
              label="Descrição da imagem"
              value={String(attrs.alt ?? "")}
              editable={editable}
              onCommit={(value) => commit({ alt: value })}
            />
          )}
          <MediaField
            label="Legenda"
            value={String(attrs.caption ?? "")}
            editable={editable}
            onPreview={setCaptionDraft}
            onCommit={(value) => {
              commit({ caption: value });
              setCaptionDraft(null);
            }}
          />
          {kind === "image" && (
            <MediaField
              label="Largura da imagem"
              value={typeof attrs.width === "number" ? String(attrs.width) : ""}
              editable={editable}
              type="number"
              onCommit={(value) => {
                const width = Number(value);
                if (Number.isFinite(width) && width >= 10 && width <= 4096) commit({ width });
                else setFeedback("Informe uma largura de 10 a 4096 pixels.");
              }}
            />
          )}
        </div>
      )}
      <p id={statusId} role="status">
        {feedback}
      </p>
    </figure>
  );
}
