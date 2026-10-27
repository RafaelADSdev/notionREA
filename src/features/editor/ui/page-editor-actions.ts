import type { Editor } from "@tiptap/core";
import { insertBlock, orderedBlocks, transformBlockSelection } from "../model/block-commands";
import { rebalancePositions } from "../model/block-order";
import type { StablePage } from "../model/stable-page";
import { createTable, tableGrid } from "../model/table-grid";
import type { BlockCommand } from "./command-catalog";
import { runEditorPlan } from "./page-editor-plan";

export type QueryRange = { id: string; from: number; to: number; literal: string };
const structural = new Set(["table", "columns", "image", "file", "divider", "databaseRef"]);

function fillStructure(page: StablePage, id: string, type: string): string {
  const existing = orderedBlocks(page).filter((block) => block.parentId === id);
  if (existing.length && type === "table") return tableGrid(page, id).rows[0]?.cells[0]?.[0]?.id ?? id;
  if (existing.length && type === "columns")
    return orderedBlocks(page).find((block) => block.parentId === existing[0]?.id)?.id ?? id;
  if (type === "table") {
    const block = page.getBlock(id);
    if (!block) throw new Error("Missing table target");
    const temporary = createTable(page, { parentId: block.parentId });
    for (const row of orderedBlocks(page).filter((entry) => entry.parentId === temporary))
      page.moveBlock(row.id, id, row.position);
    page.removeBlock(temporary);
    return tableGrid(page, id).rows[0]?.cells[0]?.[0]?.id ?? id;
  }
  if (type === "columns") {
    const positions = rebalancePositions(2);
    let first = id;
    for (const [index, position] of positions.entries()) {
      const column = crypto.randomUUID();
      const paragraph = crypto.randomUUID();
      page.createBlock({ id: column, type: "column", parentId: id, position });
      page.createBlock({ id: paragraph, type: "paragraph", parentId: column, position: "U" });
      if (index === 0) first = paragraph;
    }
    page.setBlockAttributes(id, { widths: [0.5, 0.5] });
    return first;
  }
  return id;
}

export function chooseBlockCommand(
  page: StablePage,
  editors: ReadonlyMap<string, Editor>,
  id: string,
  command: BlockCommand,
  range?: QueryRange,
  promoteChildren = false,
): string {
  const editor = editors.get(id);
  if (range && (!editor || editor.state.doc.textBetween(range.from, range.to) !== range.literal))
    throw new Error("The command query changed");
  return runEditorPlan(page, editors, (plan) => {
    const current = plan.page.getBlock(id);
    if (!current) throw new Error("Missing command target");
    if (range) plan.edit(id, range.from, range.to);
    const remaining = editor
      ? (editor.state.doc.firstChild?.content.size ?? 0) - (range ? range.to - range.from : 0)
      : 0;
    let target = id;
    if (structural.has(command.type) && remaining > 0) {
      const siblings = orderedBlocks(plan.page).filter((block) => block.parentId === current.parentId);
      const beforeId = siblings[siblings.findIndex((block) => block.id === id) + 1]?.id ?? null;
      target = insertBlock(plan.page, {
        type: command.type,
        parentId: current.parentId,
        beforeId,
        attributes: command.attributes ?? {},
      });
    } else {
      transformBlockSelection(plan.page, [id], command.type, { promoteChildren });
      if (command.attributes) plan.page.setBlockAttributes(id, command.attributes);
    }
    return fillStructure(plan.page, target, command.type);
  });
}
