"use client";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { useTranslations } from "@/lib/i18n/client";
import {
  duplicateBlockSelection,
  insertBlock,
  moveBlockSelection,
  orderedBlocks,
  removeBlockSelection,
} from "../model/block-commands";
import { canContainBlock } from "../model/block-schema";
import { blockCommands } from "./command-catalog";
import type { PageEditorController } from "./page-editor-controller";

export function PageEditorBlockActions({ id, controller }: { id: string; controller: PageEditorController }) {
  const t = useTranslations();
  const BLOCK_COMMANDS = blockCommands(t);
  const { page } = controller.session;
  const [command, setCommand] = useState("paragraph");
  const [promote, setPromote] = useState(false);
  const [parent, setParent] = useState("");
  const selected = controller.selected.includes(id) ? controller.selected : [id];
  const all = orderedBlocks(page);
  const source = page.getBlock(id);
  if (!source) return null;
  return (
    <details className="editor-block-actions">
      <summary aria-label={t("editor.blockActions")}>
        <Icon name="more" />
      </summary>
      <div className="editor-block-actions-panel">
        <button
          type="button"
          onClick={() => {
            const ids = controller.run(() => duplicateBlockSelection(page, selected));
            if (ids?.[0]) {
              controller.setSelected(ids);
              controller.focus(ids[0]);
            }
          }}
        >
          {t("editor.duplicateBlock")}
        </button>
        <button
          type="button"
          onClick={() => {
            controller.run(() => removeBlockSelection(page, selected));
            controller.setSelected([]);
          }}
        >
          {t("editor.removeBlock")}
        </button>
        <button
          type="button"
          onClick={() => {
            const siblings = all.filter((block) => block.parentId === source.parentId);
            const before = siblings[siblings.findIndex((block) => block.id === id) + 1]?.id ?? null;
            const added = controller.run(() =>
              insertBlock(page, { type: "paragraph", parentId: source.parentId, beforeId: before }),
            );
            if (added) controller.focus(added);
          }}
        >
          {t("editor.addTextBelow")}
        </button>
        <label>
          {t("editor.transformInto")}
          <select value={command} onChange={(event) => setCommand(event.currentTarget.value)}>
            {BLOCK_COMMANDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={promote}
            onChange={(event) => setPromote(event.currentTarget.checked)}
          />
          {t("editor.preserveChildren")}
        </label>
        <button
          type="button"
          onClick={() => {
            const item = BLOCK_COMMANDS.find((item) => item.id === command);
            if (item) controller.choose(item, id, promote);
          }}
        >
          {t("editor.transformBlock")}
        </button>
        <label>
          {t("common.moveTo")}
          <select value={parent} onChange={(event) => setParent(event.currentTarget.value)}>
            <option value="">{t("editor.pageRoot")}</option>
            {all
              .filter((block) => block.id !== id && canContainBlock(block.type, source.type))
              .map((block, index) => (
                <option key={block.id} value={block.id}>
                  {t("editor.block")} {index + 1} ·{" "}
                  {BLOCK_COMMANDS.find((item) => item.type === block.type)?.label ?? t("editor.group")}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            controller.preserveFocus(() => moveBlockSelection(page, selected, parent || null, null), id)
          }
        >
          {t("editor.moveBlocks")}
        </button>
      </div>
    </details>
  );
}
