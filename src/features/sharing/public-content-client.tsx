"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import type { PublicContent, PublicPage } from "./model";
import { loadPublicContent, PublicTransferError } from "./public-content";
import { PublicPageDocument } from "./public-page";

export function PublishedDocument({ data, token }: { data: PublicPage; token: string }) {
  const t = useTranslations();
  const router = useRouter();
  const manifest = data.content.chunked;
  const [loaded, setLoaded] = useState<{ hash: string; content?: PublicContent; status?: number } | null>(
    null,
  );
  useEffect(() => {
    if (!manifest) return;
    const controller = new AbortController();
    void loadPublicContent(token, manifest, controller.signal).then(
      (content) => {
        if (!controller.signal.aborted) setLoaded({ hash: manifest.hash, content });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            hash: manifest.hash,
            status: error instanceof PublicTransferError ? error.status : 503,
          });
      },
    );
    return () => controller.abort();
  }, [token, manifest]);
  if (!manifest) return <PublicPageDocument data={data} token={token} />;
  const current = loaded?.hash === manifest.hash ? loaded : null;
  if (current?.content)
    return <PublicPageDocument data={{ ...data, content: current.content }} token={token} />;
  return (
    <main className="public-page" aria-busy={!current?.status}>
      <h1>{data.page.title || t("pages.untitled")}</h1>
      {current?.status ? (
        <>
          <p role="alert">{t(current.status === 409 ? "sharing.contentChanged" : "sharing.temporary")}</p>
          <button
            type="button"
            onClick={() => {
              setLoaded(null);
              router.refresh();
            }}
          >
            {t("sharing.retryContent")}
          </button>
        </>
      ) : (
        <p role="status">{t("sharing.loadingContent")}</p>
      )}
    </main>
  );
}
