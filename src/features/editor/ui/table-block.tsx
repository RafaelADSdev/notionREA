"use client";

import {
  type ClipboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import * as Y from "yjs";
import type { StablePage } from "../model/stable-page";
import {
  ensureTableCell,
  insertTableColumn,
  insertTableRow,
  removeTableColumn,
  removeTableRow,
  tableGrid,
} from "../model/table-grid";
import {
  clearTableSelection,
  type TableCellAddress,
  type TableCellInterval,
  tableSelectionBounds,
  tableSelectionText,
} from "../model/table-selection";

export type TableBlockProps = {
  page: StablePage;
  tableId: string;
  editable: boolean;
  renderCell: (cellId: string) => ReactNode;
  onFocusCell: (cellId: string, position?: number) => void;
  onRemove?: () => void;
};
type Removal = { kind: "row" | "column"; id: string; last: boolean; trigger: HTMLButtonElement };

function RemovalDialog({
  removal,
  error,
  onConfirm,
  onCancel,
}: {
  removal: Removal;
  error: string;
  onConfirm: () => boolean;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    cancel.current?.focus();
    return () => {
      if (element?.open) {
        if (typeof element.close === "function") element.close();
        else element.removeAttribute("open");
      }
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="editor-table-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h2 id={`${id}-title`}>
        {removal.last ? "Remover tabela?" : removal.kind === "row" ? "Remover linha?" : "Remover coluna?"}
      </h2>
      <p>
        {removal.last
          ? "Esta é a última linha ou coluna. A tabela inteira será removida."
          : "O conteúdo desta linha ou coluna também será removido."}{" "}
        Você poderá recuperá-lo com Desfazer.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="editor-table-dialog-actions">
        <button ref={cancel} type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => {
            const element = dialog.current;
            if (element?.open) {
              if (typeof element.close === "function") element.close();
              else element.removeAttribute("open");
            }
            if (!onConfirm() && element) {
              if (typeof element.showModal === "function") element.showModal();
              else element.setAttribute("open", "");
              cancel.current?.focus();
            }
          }}
        >
          {removal.last ? "Remover tabela" : removal.kind === "row" ? "Remover linha" : "Remover coluna"}
        </button>
      </div>
    </dialog>
  );
}

function cellEnd(page: StablePage, id: string): number {
  const paragraph = page.fragment(id).get(0);
  return paragraph instanceof Y.XmlElement
    ? 1 +
        paragraph
          .toArray()
          .reduce((size, inline) => size + (inline instanceof Y.XmlText ? inline.length : 1), 0)
    : 1;
}

export function TableBlock({ page, tableId, editable, renderCell, onFocusCell, onRemove }: TableBlockProps) {
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [error, setError] = useState("");
  const [cellSelection, setCellSelection] = useState<TableCellInterval | null>(null);
  const lastCell = useRef<TableCellAddress | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const selectionId = useId();
  const subscribe = useCallback(
    (notify: () => void) => {
      page.document.on("update", notify);
      return () => page.document.off("update", notify);
    },
    [page],
  );
  const snapshot = useCallback(() => {
    const table = page.getBlock(tableId);
    if (!table || !page.visibleChildren(table.parentId).some((block) => block.id === tableId))
      return "removed";
    return JSON.stringify({
      grid: tableGrid(page, tableId),
      header: page.getBlockAttributes(tableId).header,
    });
  }, [page, tableId]);
  const state = useSyncExternalStore(subscribe, snapshot, () => "removed");
  if (state === "removed") return null;
  const grid = tableGrid(page, tableId);
  const header = page.getBlockAttributes(tableId).header === true;
  const bounds = cellSelection ? tableSelectionBounds(grid, cellSelection) : null;
  const addressFor = (target: Element): TableCellAddress | null => {
    const slot = target.closest<HTMLElement>("[data-table-slot]");
    if (
      slot?.closest("table")?.dataset.tableId !== tableId ||
      !slot.dataset.tableRow ||
      !slot.dataset.tableColumn
    )
      return null;
    return { row: slot.dataset.tableRow, column: slot.dataset.tableColumn };
  };
  const slotFor = (address: TableCellAddress) =>
    container.current?.querySelector<HTMLElement>(
      `[data-table-row="${address.row}"][data-table-column="${address.column}"]`,
    );
  const activate = (anchor: TableCellAddress, focus: TableCellAddress) => {
    lastCell.current = anchor;
    setCellSelection({ anchor, focus });
    container.current?.dispatchEvent(
      new CustomEvent("bloco:table-cell-selection", { bubbles: true, detail: { tableId } }),
    );
    slotFor(focus)?.focus();
    window.getSelection()?.removeAllRanges();
  };
  const run = (action: () => void) => {
    try {
      flushSync(action);
      setError("");
    } catch {
      setError("Não foi possível alterar a tabela. Tente novamente.");
    }
  };
  const focus = (rowIndex: number, columnIndex: number, backwards = false) => {
    const row = grid.rows[rowIndex];
    const column = grid.columns[columnIndex];
    if (!row || !column) return;
    const bucket = row.cells[columnIndex] ?? [];
    const id =
      (backwards ? bucket.at(-1) : bucket[0])?.id ?? ensureTableCell(page, tableId, row.id, column.id);
    onFocusCell(id, backwards ? cellEnd(page, id) : 1);
  };
  const cancelRemoval = () => {
    const trigger = removal?.trigger;
    setRemoval(null);
    setError("");
    if (trigger?.isConnected) trigger.focus();
  };
  const copySelection = (event: ClipboardEvent<HTMLDivElement>, cut = false) => {
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    run(() => {
      event.clipboardData.setData("text/plain", tableSelectionText(page, grid, bounds));
      if (cut && editable) clearTableSelection(page, grid, bounds);
    });
  };
  return (
    <div
      ref={container}
      className="editor-table-block"
      data-table-cell-selection={bounds ? "active" : undefined}
      onCopyCapture={(event) => copySelection(event)}
      onCutCapture={(event) => copySelection(event, true)}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setCellSelection(null);
          lastCell.current = null;
        }
      }}
      onFocusCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-table-cell-content]")) {
          setCellSelection(null);
          lastCell.current = addressFor(event.target);
        }
      }}
      onMouseDownCapture={(event) => {
        if (
          event.button !== 0 ||
          !(event.target instanceof Element) ||
          event.target.closest("button,input,select,textarea")
        )
          return;
        const address = addressFor(event.target);
        if (!address) return;
        if (event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          activate(cellSelection?.anchor ?? lastCell.current ?? address, address);
        } else {
          lastCell.current = address;
          setCellSelection(null);
        }
      }}
    >
      <div className="editor-table-controls">
        <label className="editor-table-header-toggle">
          <input
            type="checkbox"
            checked={header}
            disabled={!editable}
            onChange={(event) =>
              run(() =>
                page.runAction(() =>
                  page.setBlockAttributes(tableId, { header: event.currentTarget.checked }),
                ),
              )
            }
          />
          Títulos na primeira linha
        </label>
        <button
          type="button"
          disabled={!editable}
          onClick={() =>
            run(() => {
              const rowId = insertTableRow(page, tableId);
              const next = tableGrid(page, tableId).rows.find((row) => row.id === rowId)?.cells[0]?.[0];
              if (next) onFocusCell(next.id, 1);
            })
          }
        >
          Adicionar linha
        </button>
        <button
          type="button"
          disabled={!editable}
          onClick={() =>
            run(() => {
              const column = insertTableColumn(page, tableId);
              const next = tableGrid(page, tableId);
              const index = next.columns.findIndex((entry) => entry.id === column);
              const cell = next.rows[0]?.cells[index]?.[0];
              if (cell) onFocusCell(cell.id, 1);
            })
          }
        >
          Adicionar coluna
        </button>
      </div>
      <div className="editor-table-scroll">
        <table
          aria-label="Tabela simples"
          aria-describedby={selectionId}
          data-table-id={tableId}
          className="editor-table-grid"
          onKeyDownCapture={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              event.altKey ||
              !(event.target instanceof Element)
            )
              return;
            const address = addressFor(event.target);
            if (!address || event.target.closest("button,input,select,textarea")) return;
            if (bounds && cellSelection) {
              const key = event.key.toLowerCase();
              if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) {
                event.preventDefault();
                event.stopPropagation();
                if (editable)
                  run(() => {
                    if (key === "y" || event.shiftKey) page.redo();
                    else page.undo();
                  });
                return;
              }
              if (!event.ctrlKey && !event.metaKey && event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setCellSelection(null);
                const row = grid.rows.find((entry) => entry.id === cellSelection.focus.row);
                const index = grid.columns.findIndex((entry) => entry.id === cellSelection.focus.column);
                const cell = row?.cells[index]?.[0];
                if (cell) onFocusCell(cell.id, 1);
                else container.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
                return;
              }
              if (!event.ctrlKey && !event.metaKey && ["Delete", "Backspace"].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                if (editable) run(() => clearTableSelection(page, grid, bounds));
                return;
              }
              if (
                !event.ctrlKey &&
                !event.metaKey &&
                ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
              ) {
                event.preventDefault();
                event.stopPropagation();
                const row = grid.rows.findIndex((entry) => entry.id === cellSelection.focus.row);
                const column = grid.columns.findIndex((entry) => entry.id === cellSelection.focus.column);
                const nextRow =
                  grid.rows[
                    Math.max(
                      0,
                      Math.min(
                        grid.rows.length - 1,
                        row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0),
                      ),
                    )
                  ];
                const nextColumn =
                  grid.columns[
                    Math.max(
                      0,
                      Math.min(
                        grid.columns.length - 1,
                        column + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0),
                      ),
                    )
                  ];
                if (nextRow && nextColumn) {
                  const next = { row: nextRow.id, column: nextColumn.id };
                  activate(event.shiftKey ? cellSelection.anchor : next, next);
                }
                return;
              }
              if (!event.ctrlKey && !event.metaKey && event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                setCellSelection(null);
                run(() =>
                  focus(
                    grid.rows.findIndex((row) => row.id === address.row),
                    grid.columns.findIndex((column) => column.id === address.column),
                  ),
                );
                return;
              }
            }
            if (
              !editable ||
              event.key !== "Tab" ||
              event.nativeEvent.isComposing ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              !(event.target instanceof Element)
            )
              return;
            const slot = event.target.closest<HTMLElement>("[data-table-slot]");
            if (!slot || event.target.closest("button,input,select,textarea")) return;
            const rowIndex = grid.rows.findIndex((row) => row.id === slot.dataset.tableRow);
            const columnIndex = grid.columns.findIndex((column) => column.id === slot.dataset.tableColumn);
            if (rowIndex < 0 || columnIndex < 0) return;
            setCellSelection(null);
            const ordinal = rowIndex * grid.columns.length + columnIndex;
            const next = ordinal + (event.shiftKey ? -1 : 1);
            if (next < 0) return;
            event.preventDefault();
            event.stopPropagation();
            run(() => {
              if (next >= grid.rows.length * grid.columns.length) {
                const row = insertTableRow(page, tableId, grid.rows.at(-1)?.id);
                const cell = tableGrid(page, tableId).rows.find((entry) => entry.id === row)?.cells[0]?.[0];
                if (cell) onFocusCell(cell.id, 1);
              } else
                focus(Math.floor(next / grid.columns.length), next % grid.columns.length, event.shiftKey);
            });
          }}
        >
          <tbody>
            {grid.rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {grid.columns.map((column, columnIndex) => {
                  const Tag = header && rowIndex === 0 ? "th" : "td";
                  const bucket = row.cells[columnIndex] ?? [];
                  return (
                    <Tag
                      key={column.id}
                      scope={Tag === "th" ? "col" : undefined}
                      tabIndex={-1}
                      data-table-selected={Boolean(
                        bounds &&
                          rowIndex >= bounds.top &&
                          rowIndex <= bounds.bottom &&
                          columnIndex >= bounds.left &&
                          columnIndex <= bounds.right,
                      )}
                      className={`editor-table-cell${bounds && rowIndex >= bounds.top && rowIndex <= bounds.bottom && columnIndex >= bounds.left && columnIndex <= bounds.right ? " editor-table-cell-selected" : ""}`}
                      data-table-slot=""
                      data-table-row={row.id}
                      data-table-column={column.id}
                    >
                      {bucket.map((cell) => (
                        <div key={cell.id} className="editor-table-cell-content" data-table-cell-id={cell.id}>
                          {renderCell(cell.id)}
                        </div>
                      ))}
                      {!bucket.length &&
                        (editable ? (
                          <button
                            type="button"
                            className="editor-table-empty"
                            aria-label={`Editar célula vazia, linha ${rowIndex + 1}, coluna ${columnIndex + 1}`}
                            onClick={() => run(() => focus(rowIndex, columnIndex))}
                          >
                            Adicionar conteúdo
                          </button>
                        ) : (
                          <span className="editor-table-empty">Célula vazia</span>
                        ))}
                      <div className="editor-table-cell-actions">
                        <button
                          type="button"
                          className="editor-table-select-cell"
                          aria-pressed={Boolean(
                            bounds &&
                              rowIndex >= bounds.top &&
                              rowIndex <= bounds.bottom &&
                              columnIndex >= bounds.left &&
                              columnIndex <= bounds.right,
                          )}
                          aria-label={`Selecionar célula, linha ${rowIndex + 1}, coluna ${columnIndex + 1}`}
                          onClick={() => {
                            const address = { row: row.id, column: column.id };
                            activate(address, address);
                          }}
                        >
                          Selecionar célula
                        </button>
                        {editable && rowIndex === 0 && (
                          <button
                            type="button"
                            aria-label={`Remover coluna ${columnIndex + 1}`}
                            onClick={(event) => {
                              setError("");
                              setRemoval({
                                kind: "column",
                                id: column.id,
                                last: grid.columns.length === 1,
                                trigger: event.currentTarget,
                              });
                            }}
                          >
                            Remover coluna
                          </button>
                        )}
                        {editable && columnIndex === grid.columns.length - 1 && (
                          <button
                            type="button"
                            aria-label={`Remover linha ${rowIndex + 1}`}
                            onClick={(event) => {
                              setError("");
                              setRemoval({
                                kind: "row",
                                id: row.id,
                                last: grid.rows.length === 1,
                                trigger: event.currentTarget,
                              });
                            }}
                          >
                            Remover linha
                          </button>
                        )}
                      </div>
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p id={selectionId} className="editor-table-selection-status" role="status">
        {bounds
          ? `${(bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1)} células selecionadas. Shift + setas amplia; Ctrl ou Cmd + C copia; Delete limpa; Esc volta ao texto.`
          : "Use Selecionar célula e Shift + setas, ou Shift + clique, para selecionar um intervalo."}
      </p>
      {error && !removal && (
        <p className="editor-table-error" role="alert">
          {error}
        </p>
      )}
      {removal && (
        <RemovalDialog
          removal={removal}
          error={error}
          onCancel={cancelRemoval}
          onConfirm={() => {
            try {
              const current = tableGrid(page, tableId);
              const last = removal.kind === "row" ? current.rows.length === 1 : current.columns.length === 1;
              if (last !== removal.last) {
                setRemoval({ ...removal, last });
                setError("A tabela mudou. Confira a remoção antes de continuar.");
                return false;
              }
              if (removal.kind === "row") removeTableRow(page, tableId, removal.id);
              else removeTableColumn(page, tableId, removal.id);
              setRemoval(null);
              setError("");
              if (removal.last) onRemove?.();
              else {
                const next = tableGrid(page, tableId).rows.flatMap((row) => row.cells.flat())[0];
                if (next) onFocusCell(next.id, 1);
              }
              return true;
            } catch {
              setError("Não foi possível alterar a tabela. Tente novamente.");
              return false;
            }
          }}
        />
      )}
    </div>
  );
}
