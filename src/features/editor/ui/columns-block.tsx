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
import { useTranslations } from "@/lib/i18n/client";
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
  const t = useTranslations();

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
      <h2 id={`${id}-title`}>{t("editor.removeColumnQuestion")}</h2>
      <p>{t("editor.removeColumnNotice")}</p>
      {error && <p role="alert">{error}</p>}
      <div className="editor-columns-dialog-actions">
        <button ref={cancel} type="button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={onConfirm}>
          {t("editor.removeColumn")}
        </button>
      </div>
    </dialog>
  );
}

export function ColumnsBlock({ page, groupId, editable, children }: ColumnsBlockProps) {
  const t = useTranslations();

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
  const fail = () => setError(t("editor.columnsFailed"));
  return (
    <div className="editor-columns-block">
      {editable && (
        <fieldset className="editor-columns-controls">
          <legend>{t("editor.organizeColumns")}</legend>
          {layout.columns.map((column, index) => (
            <div className="editor-columns-column-controls" key={column.id}>
              <label>
                {t("editor.column")} {index + 1}
                <input
                  key={`${column.id}:${layout.weights[index]}`}
                  className="editor-column-weight"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  aria-label={t("editor.columnWidthNumber", { number: index + 1 })}
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
                aria-label={t("editor.removeColumnNumber", { number: index + 1 })}
                disabled={layout.columns.length <= 2}
                onClick={(event) => {
                  setError("");
                  setRemoval({ id: column.id, trigger: event.currentTarget });
                }}
              >
                {t("common.remove")}
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
            {t("editor.addColumn")}
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
