"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import type {
  DatabaseCommand,
  DatabaseCommandResult,
  DatabaseData,
  DatabaseReference,
  DatabaseRow,
} from "./types";
import { PeopleSearchContext, ReferenceSearchContext } from "./ui/database-context";
import { DatabaseCell } from "./ui/database-value";

export function RecordProperties({
  databaseId,
  pageId,
  workspaceId,
  isTemplate,
}: {
  databaseId: string;
  pageId: string;
  workspaceId: string;
  isTemplate: boolean;
}) {
  const t = useTranslations();

  const [record, setRecord] = useState<{ data: DatabaseData; row: DatabaseRow } | null>(null);
  const [error, setError] = useState("");
  const readRecord = useCallback(async (): Promise<{ data: DatabaseData; row: DatabaseRow }> => {
    const response = await fetch(`/api/databases/${databaseId}/records/${pageId}`, { cache: "no-store" });
    if (!response.ok) throw new Error(t("database.loadPropertiesFailed"));
    return response.json();
  }, [databaseId, pageId, t]);
  const refresh = async () => {
    setRecord(await readRecord());
    setError("");
  };
  useEffect(() => {
    let active = true;
    void readRecord()
      .then((next) => {
        if (active) {
          setRecord(next);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError(t("database.propertiesPreserved"));
      });
    return () => {
      active = false;
    };
  }, [readRecord, t]);
  const run = async (command: DatabaseCommand): Promise<DatabaseCommandResult> => {
    const response = await fetch(`/api/databases/${databaseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Operation-Id": crypto.randomUUID() },
      body: JSON.stringify(command),
    });
    const result: DatabaseCommandResult = await response.json();
    if (!response.ok) return { ok: false, error: result.error ?? t("database.saveFailed") };
    if (result.ok) await refresh();
    return result;
  };
  const references = async (
    url: string,
  ): Promise<{ items: DatabaseReference[]; nextCursor: string | null }> => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(t("database.referencesUnavailable"));
    return response.json();
  };
  return (
    <PeopleSearchContext
      value={(cursor) =>
        references(
          `/api/databases/${databaseId}/people${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
        )
      }
    >
      <ReferenceSearchContext
        value={(target, query, cursor) =>
          references(
            `/api/databases/${target}/references?${new URLSearchParams({ query, ...(cursor ? { cursor } : {}) })}`,
          )
        }
      >
        <section
          className="db-record-properties"
          aria-label={isTemplate ? t("database.templateDefaults") : t("database.recordProperties")}
        >
          {error && (
            <p role="alert">
              {error}
              <button
                type="button"
                onClick={() => void refresh().catch(() => setError(t("database.propertiesUnavailable")))}
              >
                {t("common.tryAgain")}
              </button>
            </p>
          )}
          {record && (
            <>
              <p>
                {isTemplate ? t("database.templateDefaultsNotice") : t("database.recordDatabase")}{" "}
                <Link href={`/w/${workspaceId}/p/${record.data.pageId}`}>
                  {record.data.title || t("database.openDatabase")}
                </Link>
              </p>
              <dl className="db-record-fields">
                {record.data.properties
                  .filter((property) => property.type !== "title")
                  .map((property) => (
                    <div className="db-record-field" key={property.id}>
                      <dt className="db-field-label">{property.name}</dt>
                      <dd>
                        <DatabaseCell
                          row={record.row}
                          property={property}
                          data={record.data}
                          run={run}
                          onRefresh={refresh}
                          onOpen={() => undefined}
                        />
                      </dd>
                    </div>
                  ))}
              </dl>
            </>
          )}
        </section>
      </ReferenceSearchContext>
    </PeopleSearchContext>
  );
}
