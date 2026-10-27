"use client";
import { Accessibility, defaultPreset } from "@dnd-kit/dom";
import { DragDropProvider, type DragEndEvent, useDroppable } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { useTranslations } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/core";
import { movePage } from "./actions";
import { reorderIntent } from "./model/order";
import type { PageActionState, PageSummary } from "./model/validation";

function plugins(t: Translator) {
  return [
    ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
    {
      plugin: Accessibility,
      options: {
        screenReaderInstructions: {
          draggable: t("pages.dragInstructions"),
        },
        announcements: {
          dragstart: () => t("pages.dragSelected"),
          dragover: () => t("pages.dragPosition"),
          dragend: (event: DragEndEvent) =>
            event.canceled ? t("common.moveCancelled") : t("pages.dragDropped"),
        },
      },
    },
  ];
}

function PageRow({
  page,
  workspaceId,
  sortable,
  disabled,
  index,
  draggingId,
}: {
  page: PageSummary;
  workspaceId: string;
  sortable: boolean;
  disabled: boolean;
  index: number;
  draggingId: string;
}) {
  const t = useTranslations();

  const { ref, handleRef } = useSortable({ id: page.id, index, disabled: disabled || !sortable });
  const { ref: folderRef, isDropTarget } = useDroppable({
    id: `inside:${page.id}`,
    disabled: disabled || !sortable || !draggingId || draggingId === page.id,
  });
  return (
    <li ref={ref} className="page-list-row">
      {sortable && (
        <button
          ref={handleRef}
          type="button"
          className="icon-button drag-handle"
          disabled={disabled}
          aria-label={t("pages.moveNamed", { name: page.title || t("pages.untitled") })}
        >
          <Icon name="drag" />
        </button>
      )}
      <Link className="page-link" href={`/w/${workspaceId}/p/${page.id}`}>
        <span aria-hidden="true">{page.icon || <Icon name="document" />}</span>
        <span>{page.title || t("pages.untitled")}</span>
        <Icon name="arrow" />
      </Link>
      {sortable && (
        <span
          ref={folderRef}
          className="folder-drop"
          title={t("pages.putInsideNamed", { name: page.title || t("pages.untitled") })}
          aria-hidden={!draggingId}
          data-drop-target={isDropTarget}
        >
          <Icon name="document" size={16} />
          {t("pages.inside")}
        </span>
      )}
    </li>
  );
}

export function PageList({
  pages,
  workspaceId,
  canReorder = true,
}: {
  pages: PageSummary[];
  workspaceId: string;
  canReorder?: boolean;
}) {
  const t = useTranslations();

  const router = useRouter();
  const localizedPlugins = useMemo(() => plugins(t), [t]);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [confirmation, setConfirmation] = useState<{ form: FormData; state: PageActionState } | null>(null);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const sortable = canReorder && pages.every((page) => page.parent_id === pages[0]?.parent_id);
  function finish(event: DragEndEvent) {
    const source = event.operation.source;
    if (event.canceled || !sortable || !isSortable(source)) return;
    const targetId = String(event.operation.target?.id ?? "");
    const inside = targetId.startsWith("inside:")
      ? pages.find((page) => page.id === targetId.slice(7))
      : null;
    if (!inside && source.initialIndex === source.index) return;
    const destination = pages[source.index];
    if (!destination && !inside) return;
    const activeId = String(source.id);
    const intent = inside
      ? { beforeId: null }
      : reorderIntent(
          pages.map((page) => page.id),
          activeId,
          destination?.id ?? "",
        );
    const page = pages.find((item) => item.id === activeId);
    if (!intent || !page) return;
    startTransition(async () => {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      form.set("pageId", page.id);
      form.set("revision", String(page.revision));
      form.set("parentId", inside?.id ?? page.parent_id ?? "");
      if (!inside) form.set("keepParent", "on");
      form.set("beforeId", intent.beforeId ?? "");
      const result = await movePage({}, form);
      if (result.requiresConfirmation) {
        setConfirmation({ form, state: result });
        confirmationDialog.current?.showModal();
        return;
      }
      setNotice(result.error ?? result.message ?? t("pages.reloadMove"));
      router.refresh();
    });
  }
  return (
    <>
      <p className="sr-only" id={`order-help-${workspaceId}`}>
        {t("pages.reorderInstructions")}
      </p>
      <DragDropProvider
        onDragStart={(event) => {
          setNotice("");
          setDraggingId(String(event.operation.source?.id ?? ""));
        }}
        onDragEnd={(event) => {
          setDraggingId("");
          finish(event);
        }}
        plugins={localizedPlugins}
      >
        <ul
          className="page-list"
          aria-label={t("navigation.pages")}
          aria-describedby={sortable ? `order-help-${workspaceId}` : undefined}
          data-dragging={Boolean(draggingId)}
        >
          {pages.map((page, index) => (
            <PageRow
              key={page.id}
              page={page}
              workspaceId={workspaceId}
              sortable={sortable}
              disabled={pending}
              index={index}
              draggingId={draggingId}
            />
          ))}
        </ul>
      </DragDropProvider>
      {!pages.length && <p className="notice">{t("pages.empty")}</p>}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <dialog
        ref={confirmationDialog}
        className="command-dialog move-confirmation"
        aria-label={t("pages.confirmAccessChange")}
        onCancel={() => setConfirmation(null)}
      >
        <h2>{t("pages.reviewMove")}</h2>
        <p>
          {confirmation?.state.message} {t("pages.affectedPages")} {confirmation?.state.affectedPages}.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!confirmation) return;
            const form = new FormData(event.currentTarget);
            confirmation.form.set("confirmAccess", form.get("confirmAccess") === "on" ? "on" : "");
            confirmation.form.set("previewHash", confirmation.state.previewHash ?? "");
            startTransition(async () => {
              const result = await movePage({}, confirmation.form);
              if (result.requiresConfirmation) {
                setConfirmation({ form: confirmation.form, state: result });
                return;
              }
              setNotice(result.error ?? result.message ?? t("pages.reloadReview"));
              confirmationDialog.current?.close();
              setConfirmation(null);
              router.refresh();
            });
          }}
        >
          <label className="checkbox-field">
            <input type="checkbox" name="confirmAccess" required />
            {t("pages.confirmAccess")}
          </label>
          <div className="form-links">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                confirmationDialog.current?.close();
                setConfirmation(null);
              }}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="button" disabled={pending}>
              {t("pages.confirmMove")}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
