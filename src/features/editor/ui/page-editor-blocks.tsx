"use client";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { InlineDatabase } from "@/features/databases/inline-database";
import { insertBlock } from "../model/block-commands";
import { codeLanguageSchema, contentToneSchema } from "../model/block-schema";
import type { BlockInput } from "../model/stable-page";
import { BlockMedia } from "./block-media";
import { BlockText } from "./block-text";
import { ColumnsBlock } from "./columns-block";
import { CONTENT_TONE_LABELS } from "./content-labels";
import { PageEditorBlockActions } from "./page-editor-block-actions";
import type { PageEditorController } from "./page-editor-controller";
import { TableBlock } from "./table-block";

type Props = {
  blocks: readonly BlockInput[];
  controller: PageEditorController;
  editable: boolean;
  parentId?: string | null;
  draggingId?: string;
};
const lists = new Set(["bulletListItem", "numberListItem", "task"]);
const textTypes = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberListItem",
  "task",
  "toggle",
  "quote",
  "callout",
  "code",
]);
export function PageEditorText({
  id,
  controller,
  editable,
  cell = false,
}: {
  id: string;
  controller: PageEditorController;
  editable: boolean;
  cell?: boolean;
}) {
  return (
    <BlockText
      page={controller.session.page}
      blockId={id}
      editable={editable}
      mentionResolver={controller.references.mentions}
      {...controller.callbacks}
      {...(cell
        ? {
            onSplit: (_id: string, _position: number, editor: import("@tiptap/core").Editor) => {
              editor.commands.setHardBreak();
            },
            onMerge: () => false,
          }
        : {})}
    />
  );
}

export function PageEditorBlocks({ blocks, controller, editable, parentId = null, draggingId = "" }: Props) {
  const siblings = blocks.filter((block) => block.parentId === parentId);
  const groups: BlockInput[][] = [];
  for (const block of siblings) {
    const previous = groups.at(-1);
    if (previous?.[0]?.type === block.type && lists.has(block.type)) previous.push(block);
    else groups.push([block]);
  }
  return (
    <div className="editor-block-children" id={parentId ? `children-${parentId}` : undefined}>
      {groups.map((group) => {
        const first = group[0];
        if (!first) return null;
        const children = group.map((block, index) => {
          const frame = (
            <PageEditorBlock
              key={block.id}
              {...{ blocks, controller, editable, draggingId }}
              block={block}
              index={siblings.findIndex((item) => item.id === block.id)}
              listIndex={index}
            />
          );
          return lists.has(first.type) ? <li key={block.id}>{frame}</li> : frame;
        });
        if (first.type === "numberListItem")
          return (
            <ol key={first.id} className="editor-block-list" data-list-type={first.type}>
              {children}
            </ol>
          );
        return lists.has(first.type) ? (
          <ul key={first.id} className="editor-block-list" data-list-type={first.type}>
            {children}
          </ul>
        ) : (
          (children[0] ?? null)
        );
      })}
    </div>
  );
}

function PageEditorBlock({
  block,
  blocks,
  controller,
  editable,
  index,
  listIndex,
  draggingId = "",
}: Omit<Props, "parentId"> & { block: BlockInput; index: number; listIndex: number }) {
  const { page } = controller.session;
  const attrs = page.getBlockAttributes(block.id);
  const [collapsed, setCollapsed] = useState(false);
  const { ref, handleRef } = useSortable({
    id: block.id,
    index,
    group: block.parentId === null ? "page-root" : `parent:${block.parentId}`,
    disabled: !editable,
  });
  const { ref: insideRef, isDropTarget } = useDroppable({
    id: `inside:${block.id}`,
    disabled:
      !editable ||
      !draggingId ||
      draggingId === block.id ||
      !["toggle", "quote", "callout", "bulletListItem", "numberListItem", "task", "column"].includes(
        block.type,
      ),
  });
  const selected = controller.selected.includes(block.id);
  const nested = (
    <PageEditorBlocks
      blocks={blocks}
      controller={controller}
      editable={editable}
      parentId={block.id}
      draggingId={draggingId}
    />
  );
  let body = textTypes.has(block.type) ? (
    <PageEditorText id={block.id} controller={controller} editable={editable} />
  ) : null;
  if (block.type === "image" || block.type === "file")
    body = (
      <BlockMedia
        page={page}
        blockId={block.id}
        pageId={controller.session.pageId}
        editable={editable}
        kind={block.type}
        resolver={controller.references.files}
      />
    );
  if (block.type === "table")
    body = (
      <TableBlock
        page={page}
        tableId={block.id}
        editable={editable}
        renderCell={(id) => <PageEditorText id={id} cell controller={controller} editable={editable} />}
        onFocusCell={controller.focus}
        onRemove={() => controller.focus(block.id)}
      />
    );
  if (block.type === "divider") body = <hr aria-label="Divisor" />;
  if (block.type === "column" && editable && !blocks.some((child) => child.parentId === block.id))
    body = (
      <button
        type="button"
        className="editor-column-empty"
        onClick={() => {
          const id = controller.run(() => insertBlock(page, { type: "paragraph", parentId: block.id }));
          if (id) controller.focus(id);
        }}
      >
        Escrever nesta coluna
      </button>
    );
  if (block.type === "databaseRef")
    body = (
      <InlineDatabase
        workspaceId={controller.session.workspaceId}
        pageId={controller.session.pageId}
        {...(typeof attrs.databaseId === "string" ? { databaseId: attrs.databaseId } : {})}
        {...(typeof attrs.viewId === "string" ? { viewId: attrs.viewId } : {})}
        editable={editable}
        onSelect={(databaseId) => controller.run(() => page.setBlockAttributes(block.id, { databaseId }))}
      />
    );
  return (
    <fieldset
      ref={ref}
      data-editor-block={block.id}
      data-block-type={block.type}
      data-selected={selected}
      className={`editor-block editor-block-${block.type}`}
      aria-label={`Bloco ${index + 1}`}
      tabIndex={-1}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          controller.setSelected(
            controller.selectedRef.current.includes(block.id) ? controller.selectedRef.current : [block.id],
          );
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) controller.selectFrame(block.id);
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") {
          event.preventDefault();
          controller.focus(block.id);
        }
      }}
    >
      {editable && (
        <div className="editor-block-controls">
          <button
            type="button"
            ref={handleRef}
            className="editor-block-handle"
            aria-label={`Mover ou selecionar bloco ${index + 1}`}
            onClick={() => controller.selectFrame(block.id)}
          >
            <Icon name="drag" />
          </button>
          <PageEditorBlockActions id={block.id} controller={controller} />
        </div>
      )}
      <div
        className="editor-block-main"
        {...(block.type === "heading" ? { role: "heading", "aria-level": Number(attrs.level ?? 1) } : {})}
        data-tone={block.type === "callout" ? String(attrs.tone ?? "indigo") : undefined}
      >
        {block.type === "bulletListItem" && (
          <span className="editor-list-marker" aria-hidden="true">
            •
          </span>
        )}
        {block.type === "numberListItem" && (
          <span className="editor-list-marker" aria-hidden="true">
            {listIndex + Number(attrs.start ?? 1)}.
          </span>
        )}
        {block.type === "task" && (
          <label className="editor-task-check">
            <span id={`task-action-${block.id}`} className="sr-only">
              Concluir tarefa:
            </span>
            <input
              type="checkbox"
              aria-labelledby={`task-action-${block.id} editor-text-${block.id}`}
              checked={attrs.checked === true}
              disabled={!editable}
              onChange={(event) =>
                controller.run(() =>
                  page.runAction(() =>
                    page.setBlockAttributes(block.id, { checked: event.currentTarget.checked }),
                  ),
                )
              }
            />
          </label>
        )}
        {block.type === "toggle" && (
          <button
            type="button"
            className="editor-toggle"
            aria-label={collapsed ? "Expandir conteúdo" : "Recolher conteúdo"}
            aria-expanded={!collapsed}
            aria-controls={`children-${block.id}`}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon name="chevron" />
          </button>
        )}
        {block.type === "callout" && (
          <span className="editor-callout-symbol" aria-hidden="true">
            !
          </span>
        )}
        {block.type === "callout" && editable && (
          <label className="editor-code-language">
            Cor do destaque
            <select
              value={String(attrs.tone ?? "indigo")}
              onChange={(event) =>
                controller.run(() =>
                  page.setBlockAttributes(block.id, {
                    tone: contentToneSchema.parse(event.currentTarget.value),
                  }),
                )
              }
            >
              {contentToneSchema.options.map((tone) => (
                <option key={tone} value={tone}>
                  {CONTENT_TONE_LABELS[tone]}
                </option>
              ))}
            </select>
          </label>
        )}
        {block.type === "code" && (
          <label className="editor-code-language">
            Linguagem do código
            <select
              aria-label="Linguagem do código"
              value={String(attrs.language ?? "plaintext")}
              disabled={!editable}
              onChange={(event) =>
                controller.run(() =>
                  page.runAction(() =>
                    page.setBlockAttributes(block.id, {
                      language: codeLanguageSchema.parse(event.currentTarget.value),
                    }),
                  ),
                )
              }
            >
              {codeLanguageSchema.options.map((language) => (
                <option key={language} value={language}>
                  {language === "plaintext" ? "Texto simples" : language}
                </option>
              ))}
            </select>
          </label>
        )}
        {block.type === "quote" ? <blockquote>{body}</blockquote> : body}
      </div>
      {block.type === "columns" ? (
        <ColumnsBlock page={page} groupId={block.id} editable={editable}>
          {nested}
        </ColumnsBlock>
      ) : !["table", "image", "file", "divider", "databaseRef"].includes(block.type) &&
        (!collapsed || block.type !== "toggle") ? (
        nested
      ) : null}
      {editable && draggingId && (
        <span
          ref={insideRef}
          className="editor-block-inside"
          data-drop-target={isDropTarget}
          aria-hidden="true"
        >
          Dentro do bloco
        </span>
      )}
    </fieldset>
  );
}
