"use client";
import { useRouter } from "next/navigation";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { useTranslations } from "@/lib/i18n/client";
import { createPage } from "./actions";

export function CreatePageControl({
  workspaceId,
  parentId = null,
  compact = false,
  onNavigate,
}: {
  workspaceId: string;
  parentId?: string | null;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={compact ? "nav-link" : "button"}
        aria-label={compact ? t("pages.createInWorkspace") : undefined}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const form = new FormData();
            form.set("workspaceId", workspaceId);
            form.set("parentId", parentId ?? "");
            form.set("requestId", crypto.randomUUID());
            const result = await createPage({}, form);
            setError(result.error ?? "");
            if (result.createdPageId) {
              onNavigate?.();
              router.push(`/w/${workspaceId}/p/${result.createdPageId}?new=1`);
            }
          })
        }
      >
        <Icon name="plus" />
        {pending ? t("common.creating") : parentId ? t("pages.addSubpage") : t("pages.newPage")}
      </button>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </>
  );
}
