"use client";

import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { type ReactNode, type RefCallback, useCallback } from "react";
import { Icon } from "@/components/icon";
import { InlineDatabase } from "@/features/databases/inline-database";
import { useTranslations } from "@/lib/i18n/client";
import { insertBlock } from "../model/block-commands";
import { codeLanguageSchema, contentToneSchema } from "../model/block-schema";
import type { BlockInput } from "../model/stable-page";
import { BlockMedia } from "./block-media";
import { BlockText } from "./block-text";
import { ColumnsBlock } from "./columns-block";
import { contentToneLabels } from "./content-labels";
import { PageEditorBlockActions } from "./page-editor-block-actions";
import type { PageEditorController } from "./page-editor-controller";
import { TableBlock } from "./table-block";
import { useVirtualBlockCollapse, VirtualPageBlocks } from "./virtual-page-blocks";

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
  const groups: { first: number; items: BlockInput[] }[] = [];
  for (const [index, block] of siblings.entries()) {
    const previous = groups.at(-1);
    if (previous?.items[0]?.type === block.type && lists.has(block.type)) previous.items.push(block);
    else groups.push({ first: index, items: [block] });
  }
  return (
    <VirtualPageBlocks
      items={siblings}
      className="editor-block-children"
      {...(parentId ? { id: `children-${parentId}` } : {})}
      disabled={parentId !== null && controller.session.page.getBlock(parentId)?.type === "columns"}
      measureRenderedElement
      renderItem={(block, context) => (
        <PageEditorBlock
          key={block.id}
          {...{ blocks, controller, editable, draggingId }}
          block={block}
          index={context.index}
          listIndex={context.listIndex}
          measureRef={context.measureRef}
        />
      )}
      renderSegments={(segments, item, { heightFor }) => {
        const visible = new Set(
          segments.filter((segment) => segment.kind === "item").map((segment) => segment.index),
        );
        const output: ReactNode[] = [];
        let gap: { first: string; last: string; height: number } | null = null;
        const appendGap = (block: BlockInput) => {
          if (gap) {
            gap.last = block.id;
            gap.height += heightFor(block.id);
          } else gap = { first: block.id, last: block.id, height: heightFor(block.id) };
        };
        const flushGap = () => {
          if (!gap) return;
          output.push(
            <div
              key={`gap:${gap.first}:${gap.last}`}
              data-virtual-gap=""
              aria-hidden="true"
              style={{ height: gap.height, pointerEvents: "none", userSelect: "none" }}
            />,
          );
          gap = null;
        };
        for (const group of groups) {
          const first = group.items[0];
          if (!first) continue;
          if (!group.items.some((_block, offset) => visible.has(group.first + offset))) {
            for (const block of group.items) appendGap(block);
            continue;
          }
          flushGap();
          if (!lists.has(first.type)) {
            output.push(item(group.first));
            continue;
          }
          const children: ReactNode[] = [];
          let listGap: { first: string; last: string; height: number } | null = null;
          const flushListGap = () => {
            if (!listGap) return;
            children.push(
              <li
                key={`gap:${listGap.first}:${listGap.last}`}
                data-virtual-gap=""
                role="presentation"
                aria-hidden="true"
                style={{ height: listGap.height, pointerEvents: "none", userSelect: "none" }}
              />,
            );
            listGap = null;
          };
          for (const [offset, block] of group.items.entries()) {
            if (!visible.has(group.first + offset)) {
              if (listGap) {
                listGap.last = block.id;
                listGap.height += heightFor(block.id);
              } else listGap = { first: block.id, last: block.id, height: heightFor(block.id) };
              continue;
            }
            flushListGap();
            children.push(
              <li key={block.id} aria-posinset={offset + 1} aria-setsize={group.items.length}>
                {item(group.first + offset)}
              </li>,
            );
          }
          flushListGap();
          output.push(
            first.type === "numberListItem" ? (
              <ol key={first.id} className="editor-block-list" data-list-type={first.type}>
                {children}
              </ol>
            ) : (
              <ul key={first.id} className="editor-block-list" data-list-type={first.type}>
                {children}
              </ul>
            ),
          );
        }
        flushGap();
        return output;
      }}
    />
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
  measureRef,
}: Omit<Props, "parentId"> & {
  block: BlockInput;
  index: number;
  listIndex: number;
  measureRef?: RefCallback<HTMLElement>;
}) {
  const t = useTranslations();

  const CONTENT_TONE_LABELS = contentToneLabels(t);
  const { page } = controller.session;
  const attrs = page.getBlockAttributes(block.id);
  const [collapsed, setCollapsed] = useVirtualBlockCollapse(block.id);
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
  const frameRef = useCallback(
    (element: HTMLFieldSetElement | null) => {
      ref(element);
      measureRef?.(element);
    },
    [ref, measureRef],
  );
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
  if (block.type === "divider") body = <hr aria-label={t("editor.divider")} />;
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
        {t("editor.writeColumn")}
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
      ref={frameRef}
      data-editor-block={block.id}
      data-block-type={block.type}
      data-selected={selected}
      className={`editor-block editor-block-${block.type}`}
      aria-label={t("editor.blockNumber", { number: index + 1 })}
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
      <button
        type="button"
        className="editor-block-comment"
        aria-label={t("editor.blockCommentsNumber", { number: index + 1 })}
        onClick={() => controller.openComments(block.id)}
      >
        {t("comments.title")}
      </button>
      {editable && (
        <div className="editor-block-controls">
          <button
            type="button"
            ref={handleRef}
            className="editor-block-handle"
            aria-label={t("editor.moveBlockNumber", { number: index + 1 })}
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
              {t("editor.completeTask")}
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
            aria-label={collapsed ? t("editor.expandContent") : t("editor.collapseContent")}
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
            {t("editor.calloutColor")}
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
            {t("editor.codeLanguage")}
            <select
              aria-label={t("editor.codeLanguage")}
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
                  {language === "plaintext" ? t("editor.plainText") : language}
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
          {t("editor.insideBlock")}
        </span>
      )}
    </fieldset>
  );
}
