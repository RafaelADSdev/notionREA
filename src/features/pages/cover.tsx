"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareCoverUpload, finishCoverUpload, removeCover } from "@/features/files/actions";
import { uploadPreparedFile } from "@/features/files/upload";
import { coverUploadSchema } from "@/features/files/validation";

export function PageCover({
  pageId,
  coverFileId,
  revision,
  editable,
}: {
  pageId: string;
  coverFileId: string | null;
  revision: number;
  editable: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  function upload(file: File) {
    const descriptor = { pageId, name: file.name, type: file.type, size: file.size };
    if (!coverUploadSchema.safeParse(descriptor).success) {
      setFailed(true);
      setFeedback("Envie uma imagem PNG, JPEG, WebP ou GIF de até 25 MiB.");
      if (input.current) input.current.value = "";
      return;
    }
    startTransition(async () => {
      setFailed(false);
      setFeedback("Enviando capa…");
      controller.current = new AbortController();
      setUploading(true);
      try {
        const prepared = await prepareCoverUpload(descriptor);
        if (!prepared.ok) {
          setFailed(true);
          setFeedback(prepared.error);
          return;
        }
        await uploadPreparedFile(prepared.value, file, controller.current.signal);
        setUploading(false);
        controller.current = null;
        setFeedback("Confirmando capa…");
        const finalized = await finishCoverUpload(prepared.value.fileId, revision);
        if (!finalized.ok) {
          setFailed(true);
          setFeedback(finalized.error);
          return;
        }
        setFeedback("Capa atualizada.");
        router.refresh();
      } catch (error) {
        setFailed(true);
        setFeedback(
          error instanceof DOMException && error.name === "AbortError"
            ? "Envio cancelado. Você pode tentar novamente."
            : "O envio não terminou. Confira sua conexão e tente novamente.",
        );
      } finally {
        controller.current = null;
        setUploading(false);
        if (input.current) input.current.value = "";
      }
    });
  }
  return (
    <div className="page-cover-area">
      {coverFileId && (
        <div
          className="page-cover"
          role="img"
          aria-label="Capa da página"
          style={{ backgroundImage: `url("/api/files/${coverFileId}")` }}
        />
      )}
      {editable && (
        <div className="cover-controls">
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            {pending ? "Enviando capa…" : coverFileId ? "Trocar capa" : "Adicionar capa"}
          </button>
          <input
            ref={input}
            hidden
            aria-label="Capa da página"
            tabIndex={-1}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
          {pending && uploading && (
            <button type="button" className="button quiet" onClick={() => controller.current?.abort()}>
              Cancelar envio
            </button>
          )}
          {coverFileId && (
            <button
              type="button"
              className="button quiet"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const result = await removeCover(pageId, revision);
                    if (!result.ok) {
                      setFailed(true);
                      setFeedback(result.error);
                      return;
                    }
                    setFeedback("Capa removida.");
                    setFailed(false);
                    router.refresh();
                  } catch {
                    setFailed(true);
                    setFeedback("Não foi possível remover. Recarregue a página e tente novamente.");
                  }
                })
              }
            >
              Remover capa
            </button>
          )}
          {feedback && (
            <p role={failed ? "alert" : "status"} className="notice">
              {feedback}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
