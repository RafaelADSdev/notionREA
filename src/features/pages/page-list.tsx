"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { DragDropProvider, useDroppable, type DragEndEvent } from "@dnd-kit/react";
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import { Accessibility, defaultPreset } from "@dnd-kit/dom";
import { Icon } from "@/components/icon";
import { movePage } from "./actions";
import { reorderIntent } from "./model/order";
import type { PageActionState, PageSummary } from "./model/validation";

const plugins = [
  ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
  {
    plugin: Accessibility,
    options: {
      screenReaderInstructions: {
        draggable: "Para mover, pressione Espaço. Use as setas; Espaço confirma e Escape cancela.",
      },
      announcements: {
        dragstart: () => "Página selecionada para mover.",
        dragover: () => "Posição de destino atualizada.",
        dragend: (event: DragEndEvent) =>
          event.canceled ? "Movimento cancelado." : "Página solta. Salvando a ordem.",
      },
    },
  },
];

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
          aria-label={`Mover ${page.title || "Página sem título"}`}
        >
          <Icon name="drag" />
        </button>
      )}
      <Link className="page-link" href={`/w/${workspaceId}/p/${page.id}`}>
        <span aria-hidden="true">{page.icon || <Icon name="document" />}</span>
        <span>{page.title || "Página sem título"}</span>
        <Icon name="arrow" />
      </Link>
      {sortable && (
        <span
          ref={folderRef}
          className="folder-drop"
          title={`Colocar dentro de ${page.title || "Página sem título"}`}
          aria-hidden={!draggingId}
          data-drop-target={isDropTarget}
        >
          <Icon name="document" size={16} />
          Dentro
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
  const router = useRouter();
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
      setNotice(result.error ?? result.message ?? "Recarregue a lista para revisar o movimento.");
      router.refresh();
    });
  }
  return (
    <>
      <p className="sr-only" id={`order-help-${workspaceId}`}>
        Para reordenar, foque o controle de movimento, pressione Espaço, use as setas e confirme com Espaço.
        Escape cancela.
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
        plugins={plugins}
      >
        <ul
          className="page-list"
          aria-label="Páginas"
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
      {!pages.length && <p className="notice">Ainda não há páginas aqui. Crie a primeira para começar.</p>}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <dialog
        ref={confirmationDialog}
        className="command-dialog move-confirmation"
        aria-label="Confirmar mudança de acesso"
        onCancel={() => setConfirmation(null)}
      >
        <h2>Revisar movimento</h2>
        <p>
          {confirmation?.state.message} Páginas afetadas: {confirmation?.state.affectedPages}.
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
              setNotice(result.error ?? result.message ?? "Recarregue para revisar a página.");
              confirmationDialog.current?.close();
              setConfirmation(null);
              router.refresh();
            });
          }}
        >
          <label className="checkbox-field">
            <input type="checkbox" name="confirmAccess" required />
            Confirmo a mudança de acesso
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
              Cancelar
            </button>
            <button type="submit" className="button" disabled={pending}>
              Confirmar movimento
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
