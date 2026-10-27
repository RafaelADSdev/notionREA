import * as Y from "yjs";
import type { StablePage } from "./stable-page";
import type { TableGrid } from "./table-grid";

export type TableCellAddress = { row: string; column: string };
export type TableCellInterval = { anchor: TableCellAddress; focus: TableCellAddress };
export type TableCellBounds = { top: number; bottom: number; left: number; right: number };

export function tableSelectionBounds(grid: TableGrid, interval: TableCellInterval): TableCellBounds | null {
  const aRow = grid.rows.findIndex((row) => row.id === interval.anchor.row);
  const bRow = grid.rows.findIndex((row) => row.id === interval.focus.row);
  const aColumn = grid.columns.findIndex((column) => column.id === interval.anchor.column);
  const bColumn = grid.columns.findIndex((column) => column.id === interval.focus.column);
  return [aRow, bRow, aColumn, bColumn].some((index) => index < 0)
    ? null
    : {
        top: Math.min(aRow, bRow),
        bottom: Math.max(aRow, bRow),
        left: Math.min(aColumn, bColumn),
        right: Math.max(aColumn, bColumn),
      };
}

function paragraphFor(page: StablePage, id: string): Y.XmlElement | undefined {
  const fragment = page.fragment(id);
  const paragraph = fragment.get(0);
  if (fragment.length === 0) return undefined;
  if (fragment.length !== 1 || !(paragraph instanceof Y.XmlElement) || paragraph.nodeName !== "paragraph")
    throw new Error("Invalid selected cell paragraph");
  return paragraph;
}
function cellText(page: StablePage, id: string): string {
  const paragraph = paragraphFor(page, id);
  if (!paragraph) return "";
  return paragraph
    .toArray()
    .map((inline) => {
      if (inline instanceof Y.XmlText)
        return inline
          .toDelta()
          .map((part: { insert: unknown }) => {
            if (typeof part.insert !== "string") throw new Error("Invalid selected cell text");
            return part.insert;
          })
          .join("");
      if (inline instanceof Y.XmlElement && inline.nodeName === "hardBreak") return "\n";
      if (inline instanceof Y.XmlElement && inline.nodeName === "pageMention") return "Referência de página";
      throw new Error("Invalid selected cell inline node");
    })
    .join("");
}
function tsvField(value: string): string {
  return /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function tableSelectionText(page: StablePage, grid: TableGrid, bounds: TableCellBounds): string {
  return grid.rows
    .slice(bounds.top, bounds.bottom + 1)
    .map((row) =>
      row.cells
        .slice(bounds.left, bounds.right + 1)
        .map((bucket) => tsvField(bucket.map((cell) => cellText(page, cell.id)).join("\n")))
        .join("\t"),
    )
    .join("\n");
}

/** Clear known characters/atoms only; stable paragraph and text wrappers remain integrated. */
export function clearTableSelection(page: StablePage, grid: TableGrid, bounds: TableCellBounds): void {
  const operations: (() => void)[] = [];
  for (const row of grid.rows.slice(bounds.top, bounds.bottom + 1))
    for (const bucket of row.cells.slice(bounds.left, bounds.right + 1))
      for (const cell of bucket) {
        const paragraph = paragraphFor(page, cell.id);
        if (!paragraph) continue;
        const inline = paragraph.toArray();
        for (let index = inline.length - 1; index >= 0; index--) {
          const node = inline[index];
          if (node instanceof Y.XmlText) {
            const length = node.length;
            if (length) operations.push(() => node.delete(0, length));
          } else if (
            node instanceof Y.XmlElement &&
            node.length === 0 &&
            ["hardBreak", "pageMention"].includes(node.nodeName)
          ) {
            const at = index;
            operations.push(() => paragraph.delete(at, 1));
          } else throw new Error("Invalid selected cell inline node");
        }
      }
  if (operations.length)
    page.runAction(() => {
      for (const operation of operations) operation();
    });
}
