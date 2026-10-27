"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { addColumn, columnLayout, removeColumn, setColumnWeight } from "../model/column-layout";
import type { StablePage } from "../model/stable-page";

export type ColumnsBlockProps = {
  page: StablePage;
  groupId: string;
  editable: boolean;
  children?: ReactNode;
};
type Removal = { id: string; trigger: HTMLButtonElement };
function ColumnRemovalDialog({
  onCancel,
  onConfirm,
  error,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  error: string;
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
      className="editor-columns-dialog"
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
      <h2 id={`${id}-title`}>Remover coluna?</h2>
      <p>
        Todos os blocos serão movidos para a coluna vizinha, mantendo seu conteúdo e ordem. Você poderá
        desfazer esta ação.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="editor-columns-dialog-actions">
        <button ref={cancel} type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" onClick={onConfirm}>
          Remover coluna
        </button>
      </div>
    </dialog>
  );
}

export function ColumnsBlock({ page, groupId, editable, children }: ColumnsBlockProps) {
  const [error, setError] = useState("");
  const [removal, setRemoval] = useState<Removal | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const subscribe = useCallback(
    (listener: () => void) => {
      page.document.on("afterTransaction", listener);
      return () => page.document.off("afterTransaction", listener);
    },
    [page],
  );
  const snapshot = useCallback(() => {
    try {
      return JSON.stringify(columnLayout(page, groupId));
    } catch {
      return "removed";
    }
  }, [page, groupId]);
  const state = useSyncExternalStore(subscribe, snapshot, () => "removed");
  if (!editable && removal) setRemoval(null);
  if (state === "removed") return null;
  const layout = columnLayout(page, groupId);
  const close = () => {
    const trigger = removal?.trigger;
    flushSync(() => {
      setRemoval(null);
      setError("");
    });
    if (trigger?.isConnected) trigger.focus();
    else add.current?.focus();
  };
  const fail = () =>
    setError("Não foi possível alterar as colunas. Verifique a composição atual e tente novamente.");
  return (
    <div className="editor-columns-block">
      {editable && (
        <fieldset className="editor-columns-controls">
          <legend>Organizar colunas</legend>
          {layout.columns.map((column, index) => (
            <div className="editor-columns-column-controls" key={column.id}>
              <label>
                Coluna {index + 1}
                <input
                  key={`${column.id}:${layout.weights[index]}`}
                  className="editor-column-weight"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  aria-label={`Largura relativa da coluna ${index + 1}`}
                  defaultValue={layout.weights[index]}
                  disabled={layout.columns.length < 2 || layout.columns.length > 12}
                  onBlur={(event) => {
                    try {
                      if (!event.currentTarget.validity.valid) throw new Error("Invalid weight");
                      const weight = event.currentTarget.valueAsNumber;
                      if (weight !== layout.weights[index]) setColumnWeight(page, groupId, column.id, weight);
                      setError("");
                    } catch {
                      fail();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                aria-label={`Remover coluna ${index + 1}`}
                disabled={layout.columns.length <= 2}
                onClick={(event) => {
                  setError("");
                  setRemoval({ id: column.id, trigger: event.currentTarget });
                }}
              >
                Remover
              </button>
            </div>
          ))}
          <button
            ref={add}
            type="button"
            disabled={layout.columns.length >= 12}
            onClick={() => {
              try {
                addColumn(page, groupId);
                setError("");
              } catch {
                fail();
              }
            }}
          >
            Adicionar coluna
          </button>
        </fieldset>
      )}
      {error && !removal && (
        <p className="editor-columns-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="editor-columns"
        style={
          {
            "--column-layout": layout.weights.map((weight) => `${weight}fr`).join(" "),
          } as CSSProperties
        }
      >
        {children}
      </div>
      {editable && removal && (
        <ColumnRemovalDialog
          error={error}
          onCancel={close}
          onConfirm={() => {
            try {
              removeColumn(page, groupId, removal.id);
              flushSync(() => {
                setRemoval(null);
                setError("");
              });
              add.current?.focus();
            } catch {
              fail();
            }
          }}
        />
      )}
    </div>
  );
}
