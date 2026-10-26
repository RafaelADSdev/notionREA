"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={compact ? "nav-link" : "button"}
        aria-label={compact ? "Criar página no workspace" : undefined}
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
        {pending ? "Criando…" : parentId ? "Adicionar subpágina" : "Nova página"}
      </button>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </>
  );
}
