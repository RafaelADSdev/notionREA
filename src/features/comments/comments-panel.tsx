"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { commentAccessLost, commentErrorMessage, fetchThreads, postThread } from "./client";
import { CommentComposer } from "./comment-composer";
import { CommentThreadView } from "./comment-thread";
import type { CommentAnchor, CommentPageRole, CommentThread } from "./model";
import "./comments.css";

export function CommentsPanel({
  pageId,
  blockId,
  anchor,
}: {
  pageId: string;
  blockId?: string;
  anchor?: CommentAnchor;
}) {
  const [threads, setThreads] = useState<CommentThread[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [actor, setActor] = useState(""),
    [role, setRole] = useState<CommentPageRole>("viewer");
  const [loading, setLoading] = useState(true),
    [available, setAvailable] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const retainDraft = useCallback(
    (key: string, body: string) => setDrafts((current) => ({ ...current, [key]: body })),
    [],
  );
  const denied = useCallback(() => {
    sequence.current += 1;
    setThreads([]);
    setCursor(null);
    setAvailable(false);
    setRole("viewer");
    setLoading(false);
    setError("O acesso aos comentários mudou. Seu rascunho foi preservado.");
  }, []);
  const load = useCallback(
    async (after?: string | null, signal?: AbortSignal, replace = false) => {
      const currentSequence = ++sequence.current;
      setLoading(true);
      setError("");
      try {
        const page = await fetchThreads(pageId, after, signal);
        if (signal?.aborted || sequence.current !== currentSequence) return;
        setThreads((current) =>
          replace
            ? page.threads
            : [...new Map([...current, ...page.threads].map((thread) => [thread.id, thread])).values()],
        );
        setCursor(page.nextCursor);
        setActor(page.actorId);
        setRole(page.role);
        setAvailable(true);
      } catch (error) {
        if (!signal?.aborted) {
          setError(commentErrorMessage(error));
          if (commentAccessLost(error)) denied();
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [pageId, denied],
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(undefined, controller.signal, true);
    });
    return () => controller.abort();
  }, [load]);
  const refresh = useCallback(() => load(), [load]);
  const visible = blockId ? threads.filter((thread) => thread.blockId === blockId) : threads;
  const canComment = available && role !== "viewer";
  return (
    <section className="comments-panel" aria-label="Comentários" aria-busy={loading}>
      <header>
        <div>
          <p className="comments-eyebrow">Conversa</p>
          <h2>{blockId ? "Comentários do bloco" : "Comentários"}</h2>
        </div>
        <button type="button" disabled={loading} onClick={() => void refresh()}>
          Atualizar comentários
        </button>
      </header>
      {blockId && (
        <p className="comment-context">
          {anchor
            ? "Seu comentário será vinculado ao trecho selecionado."
            : "Seu comentário será vinculado ao bloco selecionado."}
        </p>
      )}
      {loading && !threads.length && <p role="status">Carregando comentários…</p>}
      {available && (
        <ol className="comment-threads">
          {visible.map((thread) => (
            <CommentThreadView
              key={thread.id}
              thread={thread}
              actorId={actor}
              role={role}
              onChanged={refresh}
              onDenied={denied}
              onDraft={retainDraft}
            />
          ))}
        </ol>
      )}
      {available && !visible.length && !loading && (
        <p>
          {blockId ? "Nenhuma conversa exibida para este bloco." : "Ainda não há conversas nesta página."}
        </p>
      )}
      {cursor && available && (
        <button type="button" disabled={loading} onClick={() => void load(cursor)}>
          Mais conversas
        </button>
      )}
      <CommentComposer
        label={blockId ? "Novo comentário no bloco" : "Novo comentário na página"}
        submitLabel="Enviar comentário"
        requestScope={`${pageId}:${blockId ?? ""}:${JSON.stringify(anchor ?? null)}`}
        disabled={!canComment}
        onSend={async (body, requestId) => {
          try {
            await postThread(pageId, {
              body,
              requestId,
              ...(blockId ? { blockId } : {}),
              ...(anchor ? { anchor } : {}),
            });
            setNotice("Comentário enviado.");
            await refresh();
            return true;
          } catch (error) {
            setError(commentErrorMessage(error));
            if (commentAccessLost(error)) denied();
            return false;
          }
        }}
      />
      {!canComment && Object.values(drafts).some(Boolean) && (
        <div className="comment-preserved-drafts">
          <label>
            Meus rascunhos preservados
            <textarea readOnly value={Object.values(drafts).filter(Boolean).join("\n\n")} />
          </label>
        </div>
      )}
      {available && role === "viewer" && (
        <p className="comment-context">
          Você pode ler as conversas. Para comentar, solicite essa permissão ao responsável pela página.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
