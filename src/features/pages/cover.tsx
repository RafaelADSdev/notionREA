"use client";
import { useRouter } from "next/navigation";

import { useRef, useState, useTransition } from "react";
import { finishCoverUpload, prepareCoverUpload, removeCover } from "@/features/files/actions";
import { uploadPreparedFile } from "@/features/files/upload";
import { coverUploadSchema } from "@/features/files/validation";
import { useTranslations } from "@/lib/i18n/client";

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
  const t = useTranslations();

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
      setFeedback(t("pages.coverRequirements"));
      if (input.current) input.current.value = "";
      return;
    }
    startTransition(async () => {
      setFailed(false);
      setFeedback(t("pages.uploadingCover"));
      controller.current = new AbortController();
      setUploading(true);
      try {
        const prepared = await prepareCoverUpload(descriptor);
        if (!prepared.ok) {
          setFailed(true);
          setFeedback(prepared.error);
          return;
        }
        await uploadPreparedFile(prepared.value, file, controller.current.signal, t);
        setUploading(false);
        controller.current = null;
        setFeedback(t("pages.confirmingCover"));
        const finalized = await finishCoverUpload(prepared.value.fileId, revision);
        if (!finalized.ok) {
          setFailed(true);
          setFeedback(finalized.error);
          return;
        }
        setFeedback(t("pages.coverUpdated"));
        router.refresh();
      } catch (error) {
        setFailed(true);
        setFeedback(
          error instanceof DOMException && error.name === "AbortError"
            ? t("files.uploadCancelled")
            : t("files.uploadFailed"),
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
          aria-label={t("pages.cover")}
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
            {pending ? t("pages.uploadingCover") : coverFileId ? t("pages.changeCover") : t("pages.addCover")}
          </button>
          <input
            ref={input}
            hidden
            aria-label={t("pages.cover")}
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
              {t("files.cancelUpload")}
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
                    setFeedback(t("pages.coverRemoved"));
                    setFailed(false);
                    router.refresh();
                  } catch {
                    setFailed(true);
                    setFeedback(t("pages.removeCoverFailed"));
                  }
                })
              }
            >
              {t("pages.removeCover")}
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
