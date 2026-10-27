"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { InterchangeClient, InterchangeQueue } from "@/features/interchange/ui/job-client";
import { useTranslations } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/core";
import type {
  DatabaseCommand,
  DatabaseCommandResult,
  DatabaseData,
  DatabaseQuery,
  DatabaseReference,
} from "./types";
import { DatabaseWorkspace } from "./ui/database-workspace";

async function responseJson<T>(response: Response, t: Translator): Promise<T> {
  const value = await response.json();
  if (!response.ok)
    throw new Error(typeof value?.error === "string" ? value.error : t("database.loadFailed"));
  return value as T;
}

export function DatabaseClient({
  databaseId,
  workspaceId,
  viewId,
}: {
  databaseId: string;
  workspaceId: string;
  viewId?: string;
}) {
  return (
    <DatabaseLoader
      key={databaseId}
      databaseId={databaseId}
      workspaceId={workspaceId}
      {...(viewId ? { viewId } : {})}
    />
  );
}
function DatabaseLoader({
  databaseId,
  workspaceId,
  viewId,
}: {
  databaseId: string;
  workspaceId: string;
  viewId?: string;
}) {
  const t = useTranslations();

  const router = useRouter();
  const [data, setData] = useState<DatabaseData | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const initialView = useRef(viewId);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const operations = useRef(new Map<string, string>());
  const [jobClient] = useState(() => new InterchangeClient(workspaceId));
  const [jobQueue] = useState(() => new InterchangeQueue(jobClient));
  const [resuming, setResuming] = useState(false);
  useEffect(() => () => jobQueue.stop(), [jobQueue]);
  const runCopy = async (jobId: string) => {
    const initial = await jobClient.detail(jobId);
    const result = await jobQueue.run(initial.job, () => {});
    return result.job.state === "complete";
  };
  const [recovery, setRecovery] = useState<DatabaseCommandResult | null>(null);
  const load = useCallback(
    async (query: DatabaseQuery = {}) => {
      const ticket = ++generation.current;
      const response = await fetch(`/api/databases/${databaseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "query", ...query }),
      });
      const next = await responseJson<DatabaseData>(response, t);
      if (ticket !== generation.current) return;
      setData((previous) => {
        if (!query.cursor || !previous || previous.viewId !== next.viewId) return next;
        const known = new Set(previous.rows.map((row) => row.id));
        return { ...next, rows: [...previous.rows, ...next.rows.filter((row) => !known.has(row.id))] };
      });
      setError("");
    },
    [databaseId, t],
  );
  useEffect(() => {
    void load(initialView.current ? { viewId: initialView.current } : {}).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t("database.unavailable"));
    });
    return invalidate;
  }, [load, invalidate, t]);
  useEffect(() => {
    let active = true;
    void jobClient
      .list()
      .then(({ jobs }) => {
        const job = jobs.find(
          (job) =>
            job.kind === "templateCopy" &&
            job.state === "running" &&
            data?.templates.some((template) => template.pageId === job.rootPageId),
        );
        if (active && job)
          setRecovery({
            ok: false,
            jobId: job.id,
            ...(job.parentId ? { pageId: job.parentId } : {}),
            error: t("database.templatePartialNotice"),
          });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [jobClient, data?.templates, t]);
  const command = async (input: DatabaseCommand): Promise<DatabaseCommandResult> => {
    const key = JSON.stringify(input);
    let operationId = operations.current.get(key);
    if (!operationId) {
      operationId = crypto.randomUUID();
      operations.current.set(key, operationId);
    }
    try {
      const result = await responseJson<DatabaseCommandResult>(
        await fetch(`/api/databases/${databaseId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Operation-Id": operationId },
          body: JSON.stringify(input),
        }),
        t,
      );
      if (result.jobId) {
        try {
          result.ok = await runCopy(result.jobId);
        } catch {
          result.ok = false;
        }
        if (!result.ok) result.error = t("database.templatePartialNotice");
      }
      if (result.ok) operations.current.delete(key);
      if (!result.ok && result.pageId) setRecovery(result);
      return result;
    } catch (reason) {
      return { ok: false, error: reason instanceof Error ? reason.message : t("database.saveFailed") };
    }
  };
  if (!data)
    return (
      <div className="db-loading" aria-live="polite">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              onClick={() =>
                void load().catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : t("database.unavailable")),
                )
              }
            >
              {t("common.tryAgain")}
            </button>
          </>
        ) : (
          t("database.loading")
        )}
      </div>
    );
  return (
    <>
      {recovery?.pageId && (
        <p className="db-feedback" role="alert">
          {recovery.error}{" "}
          {recovery.jobId && (
            <button
              type="button"
              disabled={resuming}
              onClick={() => {
                const saved = recovery;
                setResuming(true);
                void runCopy(saved.jobId ?? "")
                  .then(async (done) => {
                    if (done) {
                      setRecovery(null);
                      await load();
                    } else setRecovery({ ...saved, error: t("database.templatePartialNotice") });
                  })
                  .catch(() => setRecovery({ ...saved, error: t("database.templatePartialNotice") }))
                  .finally(() => setResuming(false));
              }}
            >
              {t("editor.retrySave")}
            </button>
          )}
          <button type="button" onClick={() => router.push(`/w/${workspaceId}/p/${recovery.pageId}`)}>
            {t("database.openCreatedPage")}
          </button>
        </p>
      )}
      <DatabaseWorkspace
        data={data}
        onQuery={load}
        onCommand={command}
        onOpenRow={(id) => router.push(`/w/${workspaceId}/p/${id}`)}
        onFindPeople={async (cursor) =>
          responseJson<{ items: DatabaseReference[]; nextCursor: string | null }>(
            await fetch(
              `/api/databases/${databaseId}/people${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
              { cache: "no-store" },
            ),
            t,
          )
        }
        onFindReferences={async (target, query, cursor) => {
          const parameters = new URLSearchParams({ query, ...(cursor ? { cursor } : {}) });
          return responseJson<{ items: DatabaseReference[]; nextCursor: string | null }>(
            await fetch(`/api/databases/${target}/references?${parameters}`, { cache: "no-store" }),
            t,
          );
        }}
      />
    </>
  );
}
