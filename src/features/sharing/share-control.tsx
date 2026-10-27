"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type PageSharing, type SharingCommand, sharingSchema } from "./model";
import "./sharing.css";

const labels = { owner: "Owner", editor: "Editor", commenter: "Comentarista", viewer: "Leitor" };
type Target = { userId: string; label: string };
export function ShareControl({
  pageId,
  properties = [],
}: {
  pageId: string;
  properties?: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        Compartilhar
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
        if (!metadata.ok || !members.ok) throw new Error("Apenas owners podem gerenciar o compartilhamento.");
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
          setError(reason instanceof Error ? reason.message : "Compartilhamento indisponível.");
      });
    return () => {
      controller.abort();
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [endpoint]);
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
        throw new Error(typeof result.error === "string" ? result.error : "Não foi possível salvar.");
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
      setNotice("Compartilhamento atualizado.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar.");
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
        <h2 id="sharing-title">Compartilhar página</h2>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">Carregando acesso…</p>}
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
              Restringir herança de acesso da página acima
            </label>
            <label>
              Acesso padrão para membros
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
                <option value="">Somente pessoas autorizadas</option>
                <option value="viewer">Leitor</option>
                <option value="commenter">Comentarista</option>
                <option value="editor">Editor</option>
              </select>
            </label>
            <label>
              Owner da página
              <select
                value={data.ownerId}
                onChange={(event) => setData({ ...data, ownerId: event.target.value })}
              >
                {!targets.some((target) => target.userId === data.ownerId) && (
                  <option value={data.ownerId}>Owner atual</option>
                )}
                {targets.map((target) => (
                  <option key={target.userId} value={target.userId}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              O owner do workspace mantém a administração. Filhas podem herdar estas permissões; alterações
              que afetam outros escopos exigem confirmação.
            </p>
            <ul className="sharing-grants">
              {data.grants.map((grant) => (
                <li key={grant.userId}>
                  <span>{grant.label}</span>
                  <select
                    aria-label={`Papel de ${grant.label}`}
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
                    Remover
                  </button>
                </li>
              ))}
            </ul>
            <label>
              Adicionar membro
              <select value={person} onChange={(event) => setPerson(event.target.value)}>
                <option value="">Escolher pessoa</option>
                {targets
                  .filter((target) => !data.grants.some((grant) => grant.userId === target.userId))
                  .map((target) => (
                    <option key={target.userId} value={target.userId}>
                      {target.label}
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
              Adicionar como leitor
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
                    setError("Não foi possível carregar mais membros.");
                  }
                }}
              >
                Carregar mais membros
              </button>
            )}
            {preview && (
              <p className="sharing-preview" role="status">
                Esta mudança alcança {preview.count} página(s). Confirme para aplicar a prévia de acesso.
              </p>
            )}
            <button type="submit" disabled={pending}>
              {pending ? "Salvando…" : preview ? "Confirmar mudança de acesso" : "Salvar acesso"}
            </button>
          </form>
          <section className="sharing-publication">
            <h3>Link público somente leitura</h3>
            <p>
              A publicação é explícita. Subpáginas, registros, relações e bases inline precisam de publicação
              própria para aparecer.
            </p>
            {properties.length > 0 && (
              <fieldset>
                <legend>Campos da base publicados</legend>
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
                  Link público
                  <input
                    readOnly
                    value={`${typeof window === "undefined" ? "" : window.location.origin}/s/${data.publication.token}`}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <a href={`/s/${data.publication.token}`} target="_blank" rel="noopener noreferrer">
                  Abrir página publicada
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
                {data.publication ? "Atualizar publicação" : "Publicar página"}
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
                    Trocar link
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
                    Revogar publicação
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
