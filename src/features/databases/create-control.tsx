"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { useTranslations } from "@/lib/i18n/client";

export function CreateDatabaseControl({
  workspaceId,
  parentId = null,
  onCreated,
}: {
  workspaceId: string;
  parentId?: string | null;
  onCreated?: (id: string, pageId: string) => void;
}) {
  const t = useTranslations();

  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={pending}
        onClick={async () => {
          if (pending) return;
          setPending(true);
          setError("");
          requestId.current ??= crypto.randomUUID();
          try {
            const response = await fetch("/api/databases", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workspaceId,
                parentId,
                title: t("database.newDatabaseName"),
                requestId: requestId.current,
              }),
            });
            const result = await response.json();
            if (!response.ok || typeof result.id !== "string" || typeof result.pageId !== "string")
              throw new Error(t("database.createDatabaseRetry"));
            requestId.current = null;
            if (onCreated) onCreated(result.id, result.pageId);
            else router.push(`/w/${workspaceId}/p/${result.pageId}?new=1`);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("database.createDatabaseFailed"));
          } finally {
            setPending(false);
          }
        }}
      >
        <Icon name="plus" />
        {pending ? t("common.creating") : t("database.newDatabase")}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
