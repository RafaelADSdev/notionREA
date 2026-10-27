"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import {
  commentAccessLost,
  commentErrorMessage,
  fetchReplies,
  patchComment,
  postThreadAction,
  removeComment,
} from "./client";
import { CommentComposer } from "./comment-composer";
import { type Comment, type CommentPageRole, type CommentThread, commentBody } from "./model";

export function CommentText({ value }: { value: string }) {
  return <p className="comment-body">{value}</p>;
}
function CommentItem({
  comment,
  own,
  onChanged,
  onDenied,
  onDraft,
}: {
  comment: Comment;
  own: boolean;
  onChanged: () => Promise<void>;
  onDenied: () => void;
  onDraft: (key: string, body: string) => void;
}) {
  const t = useTranslations();

  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(comment.body),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  const act = async (remove: boolean) => {
    if (pending || !own) return;
    if (!remove && !commentBody.safeParse(draft).success) {
      setError(t("comments.writeLimit"));
      return;
    }
    setPending(true);
    setError("");
    try {
      if (remove) await removeComment(comment.id, { expectedRevision: comment.revision });
      else await patchComment(comment.id, { body: draft, expectedRevision: comment.revision });
      setEditing(false);
      onDraft(`edit:${comment.id}`, "");
      await onChanged();
    } catch (error) {
      setError(commentErrorMessage(error, t));
      if (commentAccessLost(error)) onDenied();
    } finally {
      setPending(false);
    }
  };
  return (
    <li className="comment-item">
      <div className="comment-byline">
        <strong>{comment.authorLabel || t("common.member")}</strong>
        <time dateTime={comment.createdAt}>
          {new Date(comment.createdAt).toLocaleString(t.locale, { dateStyle: "short", timeStyle: "short" })}
        </time>
      </div>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(false);
          }}
        >
          <label htmlFor={id}>{t("comments.editOwn")}</label>
          <textarea
            ref={field}
            id={id}
            value={draft}
            maxLength={8192}
            rows={3}
            readOnly={pending || !own}
            onChange={(event) => {
              setDraft(event.target.value);
              onDraft(`edit:${comment.id}`, event.target.value);
            }}
          />
          <div className="comment-actions">
            <button type="submit" disabled={pending || !own}>
              {t("comments.save")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                onDraft(`edit:${comment.id}`, "");
              }}
            >
              {t("comments.cancelEdit")}
            </button>
          </div>
        </form>
      ) : (
        <CommentText value={comment.body} />
      )}
      {own && !editing && (
        <div className="comment-actions">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(comment.body);
              setEditing(true);
            }}
          >
            {t("comments.edit")}
          </button>
          <button type="button" disabled={pending} onClick={() => void act(true)}>
            {t("comments.delete")}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </li>
  );
}

export function CommentThreadView({
  thread,
  actorId,
  role,
  onChanged,
  onDenied,
  onDraft,
}: {
  thread: CommentThread;
  actorId: string;
  role: CommentPageRole;
  onChanged: () => Promise<void>;
  onDenied: () => void;
  onDraft: (key: string, body: string) => void;
}) {
  const t = useTranslations();

  const [open, setOpen] = useState(false),
    [comments, setComments] = useState<Comment[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const sequence = useRef(0);
  const region = useId();
  const canComment = role !== "viewer",
    canResolve = canComment && (role === "owner" || role === "editor" || thread.authorId === actorId);
  const load = useCallback(
    async (after?: string | null, signal?: AbortSignal) => {
      const currentSequence = ++sequence.current;
      setLoading(true);
      setError("");
      try {
        const page = await fetchReplies(thread.id, after, signal);
        if (signal?.aborted || sequence.current !== currentSequence) return;
        setComments((current) =>
          after
            ? [
                ...current,
                ...page.comments.filter((comment) => !current.some((item) => item.id === comment.id)),
              ]
            : page.comments,
        );
        setCursor(page.nextCursor);
        setLoaded(true);
      } catch (error) {
        if (!signal?.aborted) {
          setError(commentErrorMessage(error, t));
          if (commentAccessLost(error)) onDenied();
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [thread.id, onDenied, t],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(undefined, controller.signal);
    });
    return () => controller.abort();
  }, [open, load]);
  const changed = async () => {
    await load();
    await onChanged();
  };
  return (
    <li className="comment-thread" data-resolved={thread.resolved || undefined}>
      <div className="comment-thread-heading">
        <strong>{thread.authorLabel || t("common.member")}</strong>
        <span>{thread.resolved ? "Resolvida" : "Aberta"}</span>
        <button type="button" aria-expanded={open} aria-controls={region} onClick={() => setOpen(!open)}>
          {open ? t("comments.closeThread") : t("comments.openThread")}
        </button>
      </div>
      <p className="comment-context">
        {thread.blockId ? t("comments.blockComment") : t("comments.pageComment")}
        {!thread.anchorAvailable ? t("comments.anchorUnavailableSuffix") : ""}
      </p>
      {thread.blockId && thread.anchorAvailable && (
        <button
          type="button"
          onClick={() => {
            document.dispatchEvent(
              new CustomEvent("bloco:comment-anchor", {
                detail: { pageId: thread.pageId, blockId: thread.blockId, anchor: thread.anchor },
              }),
            );
          }}
        >
          {t("comments.goToBlock")}
        </button>
      )}
      {!open && (loaded ? comments[0] : thread.preview) && (
        <CommentText value={(loaded ? comments[0]?.body : thread.preview?.body) ?? ""} />
      )}
      {open && (
        <div id={region} className="comment-replies" aria-busy={loading || pending}>
          {loading && !comments.length && <p role="status">{t("comments.loadingThread")}</p>}
          <ol>
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                own={canComment && comment.authorId === actorId}
                onChanged={changed}
                onDenied={onDenied}
                onDraft={onDraft}
              />
            ))}
          </ol>
          {!comments.length && !loading && <p>{t("comments.noReplies")}</p>}
          {cursor && (
            <button type="button" disabled={loading} onClick={() => void load(cursor)}>
              {t("comments.moreReplies")}
            </button>
          )}
          <div className="comment-actions">
            <button type="button" disabled={loading} onClick={() => void load()}>
              {t("comments.refreshThread")}
            </button>
            {canResolve && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  setError("");
                  void postThreadAction(thread.id, {
                    action: "resolve",
                    resolved: !thread.resolved,
                    expectedRevision: thread.revision,
                  })
                    .then(onChanged)
                    .catch((error) => {
                      setError(commentErrorMessage(error, t));
                      if (commentAccessLost(error)) onDenied();
                    })
                    .finally(() => setPending(false));
                }}
              >
                {thread.resolved ? t("comments.reopen") : t("comments.resolve")}
              </button>
            )}
          </div>
          {canComment && (
            <CommentComposer
              label="Responder à conversa"
              submitLabel="Enviar resposta"
              requestScope={thread.id}
              onDraft={(body) => onDraft(`reply:${thread.id}`, body)}
              disabled={pending}
              onSend={async (body, requestId) => {
                try {
                  await postThreadAction(thread.id, { action: "reply", body, requestId });
                  await changed();
                  return true;
                } catch (error) {
                  setError(commentErrorMessage(error, t));
                  if (commentAccessLost(error)) onDenied();
                  return false;
                }
              }}
            />
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </li>
  );
}
