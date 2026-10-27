"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { type PageSharing, type SharingCommand, sharingSchema } from "./model";
import "./sharing.css";

type Target = { userId: string; label: string };
export function ShareControl({
  pageId,
  properties = [],
}: {
  pageId: string;
  properties?: { id: string; name: string }[];
}) {
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        {t("sharing.share")}
      </button>
      {open && (
        <ShareDialog key={pageId} pageId={pageId} properties={properties} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
function ShareDialog({
  pageId,
  properties,
  onClose,
}: {
  pageId: string;
  properties: { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations();

  const labels = {
    owner: "Owner",
    editor: t("sharing.editor"),
    commenter: t("sharing.commenter"),
    viewer: t("sharing.viewer"),
  };
  const router = useRouter(),
    dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<PageSharing | null>(null),
    [targets, setTargets] = useState<Target[]>([]);
  const [after, setAfter] = useState<string | null>(null),
    [person, setPerson] = useState("");
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ token: string; count: number } | null>(null);
  const endpoint = `/api/pages/${pageId}/sharing`;
  useEffect(() => {
    const previous = document.activeElement,
      element = dialog.current,
      controller = new AbortController();
    element?.showModal();
    void Promise.all([
      fetch(endpoint, { signal: controller.signal, cache: "no-store" }),
      fetch(`${endpoint}?targets=1`, { signal: controller.signal, cache: "no-store" }),
    ])
      .then(async ([metadata, members]) => {
        if (!metadata.ok || !members.ok) throw new Error(t("sharing.ownersOnly"));
        const value = sharingSchema.parse(await metadata.json()),
          people: { items: Target[]; nextCursor: string | null } = await members.json();
        if (!controller.signal.aborted) {
          setData(value);
          setFields(value.publication?.fields ?? []);
          setTargets(people.items);
          setAfter(people.nextCursor);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : t("sharing.unavailable"));
      });
    return () => {
      controller.abort();
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [endpoint, t]);
  const mutate = async (command: SharingCommand) => {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(typeof result.error === "string" ? result.error : t("database.saveFailed"));
      if (result.requiresConfirmation === true) {
        setPreview({ token: String(result.previewToken), count: Number(result.affectedPages) });
        return;
      }
      if (result.accessChanged === true) {
        onClose();
        router.refresh();
        return;
      }
      const value = sharingSchema.parse({
        revision: result.revision,
        ownerId: result.ownerId,
        restricted: result.restricted,
        workspaceRole: result.workspaceRole,
        grants: result.grants,
        publication: result.publication,
      });
      setData(value);
      setPreview(null);
      setNotice(t("sharing.updated"));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("database.saveFailed"));
    } finally {
      setPending(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="sharing-dialog"
      aria-labelledby="sharing-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="sharing-title">{t("sharing.sharePage")}</h2>
        <button type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">{t("sharing.loading")}</p>}
      {data && (
        <>
          <form
            className="sharing-form"
            onChangeCapture={() => setPreview(null)}
            onSubmit={(event) => {
              event.preventDefault();
              void mutate({
                action: "access",
                expectedRevision: data.revision,
                restricted: data.restricted,
                workspaceRole: data.workspaceRole,
                grants: data.grants.map(({ userId, role }) => ({ userId, role })),
                ownerId: data.ownerId,
                ...(preview ? { confirm: true, previewToken: preview.token } : {}),
              });
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={data.restricted}
                onChange={(event) => setData({ ...data, restricted: event.target.checked })}
              />
              {t("sharing.restrictInheritance")}
            </label>
            <label>
              {t("sharing.workspaceDefault")}
              <select
                value={data.workspaceRole ?? ""}
                onChange={(event) =>
                  setData({
                    ...data,
                    workspaceRole: event.target.value
                      ? (event.target.value as "editor" | "commenter" | "viewer")
                      : null,
                  })
                }
              >
                <option value="">{t("sharing.authorizedOnly")}</option>
                <option value="viewer">{t("sharing.viewer")}</option>
                <option value="commenter">{t("sharing.commenter")}</option>
                <option value="editor">{t("sharing.editor")}</option>
              </select>
            </label>
            <label>
              {t("sharing.pageOwner")}
              <select
                value={data.ownerId}
                onChange={(event) => setData({ ...data, ownerId: event.target.value })}
              >
                {!targets.some((target) => target.userId === data.ownerId) && (
                  <option value={data.ownerId}>{t("sharing.currentOwner")}</option>
                )}
                {targets.map((target) => (
                  <option key={target.userId} value={target.userId}>
                    {target.label || t("common.member")}
                  </option>
                ))}
              </select>
            </label>
            <p>{t("sharing.inheritanceNotice")}</p>
            <ul className="sharing-grants">
              {data.grants.map((grant) => (
                <li key={grant.userId}>
                  <span>{grant.label || t("common.member")}</span>
                  <select
                    aria-label={t("sharing.roleNamed", { name: grant.label || t("common.member") })}
                    value={grant.role}
                    onChange={(event) =>
                      setData({
                        ...data,
                        grants: data.grants.map((item) =>
                          item.userId === grant.userId
                            ? { ...item, role: event.target.value as typeof grant.role }
                            : item,
                        ),
                      })
                    }
                  >
                    {Object.entries(labels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setPreview(null);
                      setData({
                        ...data,
                        grants: data.grants.filter((item) => item.userId !== grant.userId),
                      });
                    }}
                  >
                    {t("common.remove")}
                  </button>
                </li>
              ))}
            </ul>
            <label>
              {t("sharing.addMember")}
              <select value={person} onChange={(event) => setPerson(event.target.value)}>
                <option value="">{t("sharing.choosePerson")}</option>
                {targets
                  .filter((target) => !data.grants.some((grant) => grant.userId === target.userId))
                  .map((target) => (
                    <option key={target.userId} value={target.userId}>
                      {target.label || t("common.member")}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!person}
              onClick={() => {
                const target = targets.find((item) => item.userId === person);
                if (target) {
                  setData({ ...data, grants: [...data.grants, { ...target, role: "viewer" }] });
                  setPerson("");
                  setPreview(null);
                }
              }}
            >
              {t("sharing.addViewer")}
            </button>
            {after && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch(
                      `${endpoint}?${new URLSearchParams({ targets: "1", after })}`,
                      { cache: "no-store" },
                    );
                    if (!response.ok) throw new Error();
                    const result = await response.json();
                    setTargets((previous) => [...previous, ...result.items]);
                    setAfter(result.nextCursor);
                  } catch {
                    setError(t("sharing.moreMembersFailed"));
                  }
                }}
              >
                {t("database.moreMembers")}
              </button>
            )}
            {preview && (
              <p className="sharing-preview" role="status">
                {t("sharing.affectedCount", { count: preview.count })}
              </p>
            )}
            <button type="submit" disabled={pending}>
              {pending
                ? t("common.saving")
                : preview
                  ? t("pages.confirmAccessChange")
                  : t("sharing.saveAccess")}
            </button>
          </form>
          <section className="sharing-publication">
            <h3>{t("sharing.publicLinkReadonly")}</h3>
            <p>{t("sharing.explicitPublicationNotice")}</p>
            {properties.length > 0 && (
              <fieldset>
                <legend>{t("sharing.publishedFields")}</legend>
                {properties.map((property) => (
                  <label key={property.id}>
                    <input
                      type="checkbox"
                      checked={fields.includes(property.id)}
                      onChange={(event) =>
                        setFields(
                          event.target.checked
                            ? [...fields, property.id]
                            : fields.filter((id) => id !== property.id),
                        )
                      }
                    />
                    {property.name}
                  </label>
                ))}
              </fieldset>
            )}
            {data.publication && (
              <>
                <label>
                  {t("sharing.publicLink")}
                  <input
                    readOnly
                    value={`${typeof window === "undefined" ? "" : window.location.origin}/s/${data.publication.token}`}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <a href={`/s/${data.publication.token}`} target="_blank" rel="noopener noreferrer">
                  {t("sharing.openPublishedPage")}
                </a>
              </>
            )}
            <div className="sharing-actions">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void mutate({
                    action: "publication",
                    expectedRevision: data.revision,
                    enabled: true,
                    fields,
                  })
                }
              >
                {data.publication ? t("sharing.updatePublication") : t("sharing.publishPage")}
              </button>
              {data.publication && (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void mutate({
                        action: "publication",
                        expectedRevision: data.revision,
                        enabled: true,
                        fields,
                        rotate: true,
                      })
                    }
                  >
                    {t("sharing.rotateLink")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void mutate({
                        action: "publication",
                        expectedRevision: data.revision,
                        enabled: false,
                        fields: [],
                      })
                    }
                  >
                    {t("sharing.revokePublication")}
                  </button>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </dialog>
  );
}
