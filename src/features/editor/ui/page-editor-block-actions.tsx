"use client";
import { useState } from "react";
import { Icon } from "@/components/icon";
import {
  duplicateBlockSelection,
  insertBlock,
  moveBlockSelection,
  orderedBlocks,
  removeBlockSelection,
} from "../model/block-commands";
import { canContainBlock } from "../model/block-schema";
import { BLOCK_COMMANDS } from "./command-catalog";
import type { PageEditorController } from "./page-editor-controller";

export function PageEditorBlockActions({ id, controller }: { id: string; controller: PageEditorController }) {
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
      <summary aria-label="Ações do bloco">
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
          Duplicar bloco
        </button>
        <button
          type="button"
          onClick={() => {
            controller.run(() => removeBlockSelection(page, selected));
            controller.setSelected([]);
          }}
        >
          Remover bloco
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
          Adicionar texto abaixo
        </button>
        <label>
          Transformar em
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
          Preservar filhos como blocos irmãos
        </label>
        <button
          type="button"
          onClick={() => {
            const item = BLOCK_COMMANDS.find((item) => item.id === command);
            if (item) controller.choose(item, id, promote);
          }}
        >
          Transformar bloco
        </button>
        <label>
          Mover para
          <select value={parent} onChange={(event) => setParent(event.currentTarget.value)}>
            <option value="">Raiz da página</option>
            {all
              .filter((block) => block.id !== id && canContainBlock(block.type, source.type))
              .map((block, index) => (
                <option key={block.id} value={block.id}>
                  Bloco {index + 1} ·{" "}
                  {BLOCK_COMMANDS.find((item) => item.type === block.type)?.label ?? "Grupo"}
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
          Mover blocos
        </button>
      </div>
    </details>
  );
}
