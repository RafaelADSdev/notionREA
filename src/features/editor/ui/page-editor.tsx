"use client";
import { Accessibility, defaultPreset } from "@dnd-kit/dom";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { TextSelection } from "@tiptap/pm/state";
import { relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Collaborators } from "@/features/collaboration/collaborators";
import type { SharedCursor } from "@/features/collaboration/protocol";
import { decodePosition, validCursor } from "@/features/collaboration/protocol";
import { usePageCollaboration } from "@/features/collaboration/use-page-collaboration";
import { BlockCommentsDialog } from "@/features/comments/block-comments-dialog";
import { commentAnchorSchema } from "@/features/comments/model";
import { clearOtherEditorSessions, type EditorSession, getEditorSession } from "../client/editor-session";
import { DocumentReferences } from "../client/reference-resolver";
import { useEditorNavigation } from "../client/use-editor-navigation";
import { insertBlock, moveBlockSelection, orderedBlocks } from "../model/block-commands";
import { CommandMenu } from "./command-menu";
import { FormattingToolbar } from "./formatting-toolbar";
import { LinkDialog } from "./link-dialog";
import { MentionMenu } from "./mention-menu";
import { PageEditorBlocks } from "./page-editor-blocks";
import { usePageEditorClipboard } from "./page-editor-clipboard-events";
import { usePageEditorController } from "./page-editor-controller";
import { usePageEditorSelection } from "./page-editor-selection";
import { PageEditorStatus } from "./page-editor-status";

const plugins = [
  ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
  {
    plugin: Accessibility,
    options: {
      screenReaderInstructions: {
        draggable: "Para mover o bloco, pressione Espaço. Use as setas; Espaço confirma e Escape cancela.",
      },
      announcements: {
        dragstart: () => "Bloco selecionado para mover.",
        dragover: () => "Destino do bloco atualizado.",
        dragend: (event: DragEndEvent) => (event.canceled ? "Movimento cancelado." : "Bloco movido."),
      },
    },
  },
];
export type PageEditorProps = { userId: string; workspaceId: string; pageId: string; editable: boolean };
class ReferenceLifetime {
  private generation = 0;
  acquire(references: DocumentReferences): () => void {
    const lease = ++this.generation;
    return () =>
      queueMicrotask(() => {
        if (this.generation === lease) references.dispose();
      });
  }
}

const PageEditorBody = memo(function PageEditorBody({
  session,
  references,
  editable,
  onCursor,
}: {
  session: EditorSession;
  references: DocumentReferences;
  editable: boolean;
  onCursor: (cursor: SharedCursor | null) => void;
}) {
  useSyncExternalStore(session.subscribeStructure, session.getStructureVersion, () => 0);
  const state = session.getStatus();
  const canEdit = editable && session.isEditable() && !["loading", "denied", "unsupported"].includes(state);
  const controller = usePageEditorController(session, references, canEdit, onCursor);
  const root = useRef<HTMLDivElement>(null);
  const dragRestore = useRef<(() => void) | null>(null);
  const selectionHandlers = usePageEditorSelection(controller, root, canEdit);
  const clipboardHandlers = usePageEditorClipboard(controller, root, canEdit);
  const [draggingId, setDraggingId] = useState("");
  const clearBlockSelection = controller.setSelected;
  const commentRegistry = controller.registry;
  const closeComment = controller.setComment;
  const commentError = controller.setError;
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const reveal = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        !("pageId" in detail) ||
        detail.pageId !== session.pageId ||
        !("blockId" in detail) ||
        typeof detail.blockId !== "string" ||
        !("anchor" in detail)
      )
        return;
      const parsed = commentAnchorSchema.nullable().safeParse(detail.anchor);
      if (!parsed.success || !parsed.data) return;
      const base64 = (value: string) =>
        value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
      const cursor = validCursor({
        blockId: detail.blockId,
        anchor: base64(parsed.data.start),
        head: base64(parsed.data.end),
      });
      if (!cursor) {
        commentError("O trecho deste comentário não está disponível.");
        return;
      }
      flushSync(() => closeComment(null));
      const timer = setTimeout(() => {
        timers.delete(timer);
        const editor = commentRegistry.current.get(cursor.blockId);
        const binding = editor ? ySyncPluginKey.getState(editor.state)?.binding : undefined;
        const anchor = decodePosition(cursor.anchor, cursor.blockId),
          head = decodePosition(cursor.head, cursor.blockId);
        if (!editor || !binding || !anchor || !head) {
          commentError("O trecho deste comentário não está disponível.");
          return;
        }
        const fragment = session.page.fragment(cursor.blockId);
        const from = relativePositionToAbsolutePosition(session.document, fragment, anchor, binding.mapping);
        const to = relativePositionToAbsolutePosition(session.document, fragment, head, binding.mapping);
        if (
          from === null ||
          to === null ||
          from < 1 ||
          to < 1 ||
          from >= editor.state.doc.content.size ||
          to >= editor.state.doc.content.size
        ) {
          commentError("O trecho deste comentário não está disponível.");
          return;
        }
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)).scrollIntoView(),
        );
        editor.view.focus();
      }, 0);
      timers.add(timer);
    };
    document.addEventListener("bloco:comment-anchor", reveal);
    return () => {
      document.removeEventListener("bloco:comment-anchor", reveal);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [session, commentRegistry, closeComment, commentError]);
  const hasBody =
    !["loading", "denied", "unsupported"].includes(state) &&
    session.document.getMap("meta").get("schemaVersion") === 1;
  useEffect(() => {
    if (!hasBody) return;
    const element = root.current;
    const clear = () => clearBlockSelection([]);
    element?.addEventListener("bloco:table-cell-selection", clear);
    return () => element?.removeEventListener("bloco:table-cell-selection", clear);
  }, [clearBlockSelection, hasBody]);
  if (state === "loading")
    return (
      <p className="editor-loading" role="status">
        Carregando documento…
      </p>
    );
  if (state === "denied" || state === "unsupported") return null;
  if (
    !canEdit &&
    state === "saved" &&
    session.provider.revision === 0 &&
    session.document.getMap("meta").get("schemaVersion") === undefined
  )
    return <p>Esta página ainda não tem conteúdo.</p>;
  if (session.document.getMap("meta").get("schemaVersion") !== 1)
    return <p role="alert">Não foi possível carregar o documento. Tente novamente.</p>;
  const blocks = orderedBlocks(session.page);
  const anchorElement = controller.menu
    ? controller.registry.current.get(controller.menu.id)?.view.dom
    : undefined;
  const finish = (event: DragEndEvent) => {
    setDraggingId("");
    const source = event.operation.source;
    if (event.canceled || !canEdit || !isSortable(source)) {
      if (source) (dragRestore.current ?? (() => controller.focus(String(source.id))))();
      return;
    }
    const id = String(source.id);
    const target = String(event.operation.target?.id ?? "");
    const current = session.page.getBlock(id);
    if (!current) {
      controller.focus(id);
      return;
    }
    const ids = controller.selected.includes(id) ? controller.selected : [id];
    if (target.startsWith("inside:"))
      controller.preserveFocus(() => moveBlockSelection(session.page, ids, target.slice(7), null), id);
    else {
      if (source.initialGroup === source.group && source.initialIndex === source.index) return;
      const group = String(source.group ?? "");
      const parentId =
        group === "page-root" ? null : group.startsWith("parent:") ? group.slice(7) : current.parentId;
      const siblings = blocks.filter((block) => block.parentId === parentId);
      const after = source.initialGroup === source.group && source.initialIndex < source.index;
      const before =
        siblings.slice(source.index + (after ? 1 : 0)).find((block) => !ids.includes(block.id))?.id ?? null;
      controller.preserveFocus(() => moveBlockSelection(session.page, ids, parentId, before), id);
    }
  };
  return (
    <div
      ref={root}
      {...selectionHandlers}
      {...clipboardHandlers}
      onPointerDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("table")) controller.setSelected([]);
      }}
      className="editor-body"
      onBlurCapture={(event) => {
        if ((event.target as HTMLElement).isContentEditable) {
          void session.provider.flush();
          onCursor(null);
        }
      }}
    >
      <div className="editor-actions">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() =>
            controller.preserveFocus(() => {
              session.page.undo();
            })
          }
        >
          Desfazer
        </button>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() =>
            controller.preserveFocus(() => {
              session.page.redo();
            })
          }
        >
          Refazer
        </button>
        {!canEdit && <span>Somente leitura</span>}
        <FormattingToolbar
          editor={controller.active?.editor ?? null}
          disabled={!canEdit || session.page.getBlock(controller.active?.id ?? "")?.type === "code"}
          onLink={() => controller.setLink(controller.active?.editor ?? null)}
        />
      </div>
      {controller.error && (
        <p role="alert" className="editor-error">
          {controller.error}
        </p>
      )}
      <DragDropProvider
        plugins={plugins}
        onDragStart={(event) => {
          const id = String(event.operation.source?.id ?? "");
          dragRestore.current = controller.captureFocus(id);
          setDraggingId(id);
        }}
        onDragEnd={finish}
      >
        <PageEditorBlocks
          blocks={blocks}
          controller={controller}
          editable={canEdit}
          draggingId={draggingId}
        />
      </DragDropProvider>
      {canEdit && (
        <button
          type="button"
          className="editor-add-block"
          onClick={() => {
            const id = controller.run(() => insertBlock(session.page, { type: "paragraph", parentId: null }));
            if (id) controller.focus(id);
          }}
        >
          Adicionar bloco de texto
        </button>
      )}
      {controller.menu?.kind === "slash" && canEdit && (
        <CommandMenu
          query={controller.menu.query}
          anchor={controller.menu.anchor}
          {...(anchorElement ? { anchorElement } : {})}
          onChoose={controller.choose}
          onClose={() => controller.setMenu(null)}
        />
      )}
      {controller.menu?.kind === "mention" && canEdit && (
        <MentionMenu
          workspaceId={session.workspaceId}
          query={controller.menu.query}
          anchor={controller.menu.anchor}
          {...(anchorElement ? { anchorElement } : {})}
          onChoose={controller.chooseMention}
          onClose={() => controller.setMenu(null)}
        />
      )}
      <LinkDialog
        editor={controller.link}
        open={Boolean(controller.link && canEdit)}
        onClose={() => controller.setLink(null)}
      />
      {controller.comment && (
        <BlockCommentsDialog
          pageId={session.pageId}
          blockId={controller.comment.blockId}
          {...(controller.comment.anchor ? { anchor: controller.comment.anchor } : {})}
          onClose={() => controller.setComment(null)}
        />
      )}
    </div>
  );
});

export function PageEditor(props: PageEditorProps) {
  const [session] = useState(() => getEditorSession(props));
  const [references] = useState(
    () =>
      new DocumentReferences({
        workspaceId: props.workspaceId,
        pageId: props.pageId,
        onUnavailable: () => {
          void session.provider.synchronize();
        },
      }),
  );
  const [lifecycle] = useState(() => new ReferenceLifetime());
  useEffect(() => {
    clearOtherEditorSessions(props.userId);
    const release = session.mount();
    const releaseReferences = lifecycle.acquire(references);
    return () => {
      release();
      releaseReferences();
    };
  }, [session, references, props.userId, lifecycle]);
  useEffect(() => session.setEditable(props.editable), [session, props.editable]);
  useEditorNavigation(session, references);
  const collaboration = usePageCollaboration(session, props.editable);
  return (
    <section className="page-editor" aria-label="Conteúdo da página">
      <PageEditorStatus session={session} />
      <Collaborators collaboration={collaboration} />
      <PageEditorBody
        session={session}
        references={references}
        editable={props.editable}
        onCursor={collaboration.publishCursor}
      />
    </section>
  );
}
