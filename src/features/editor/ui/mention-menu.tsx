"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { findPages } from "@/features/pages/search";
import { useTranslations } from "@/lib/i18n/client";
import { getCommandMenuPosition } from "./command-menu";
import { useInlineMenuAria } from "./use-inline-menu-aria";

export type MentionMenuItem = { id: string; title: string; icon: string | null };
export type MentionMenuProps = {
  workspaceId: string;
  query: string;
  anchor: { left: number; top: number };
  onChoose: (item: MentionMenuItem) => void;
  onClose: () => void;
  anchorElement?: HTMLElement;
};
type Results = { key: string; items: MentionMenuItem[]; error: boolean };
const boundedSearchItems = z.array(z.object({ id: z.uuid(), title: z.string().max(500) })).max(50);

export function MentionMenu({
  workspaceId,
  query,
  anchor,
  onChoose,
  onClose,
  anchorElement,
}: MentionMenuProps) {
  const t = useTranslations();

  const key = JSON.stringify([workspaceId, query]);
  const [results, setResults] = useState<Results>({ key: "", items: [], error: false });
  const items = results.key === key ? results.items : [];
  const loading = results.key !== key;
  const [selection, setSelection] = useState({ key, id: "" });
  const selected = selection.key === key ? items.findIndex((item) => item.id === selection.id) : 0;
  const activeIndex = Math.max(0, selected);
  const active = items[activeIndex];
  const listId = `page-mentions-${useId()}`;
  const menu = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const current = useRef({ key, items, activeIndex, onChoose, onClose });
  const [position, setPosition] = useState(anchor);
  const { left, top } = anchor;
  useInlineMenuAria(anchorElement, listId, active ? `${listId}-${active.id}` : undefined);

  useLayoutEffect(() => {
    current.current = { key, items, activeIndex, onChoose, onClose };
  });

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void findPages(workspaceId, query, controller.signal, undefined, t.locale)
        .then((value) => {
          if (!controller.signal.aborted)
            setResults({
              key,
              items: boundedSearchItems.parse(value.items).map((item) => ({
                id: item.id.toLowerCase(),
                title: item.title || t("pages.untitled"),
                icon: null,
              })),
              error: false,
            });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults({ key, items: [], error: true });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workspaceId, query, key, t]);

  useLayoutEffect(() => {
    const measure = () => {
      const bounds = menu.current?.getBoundingClientRect();
      const next = getCommandMenuPosition(
        { left, top },
        { width: window.innerWidth, height: window.innerHeight },
        { width: bounds?.width || 336, height: bounds?.height || 360 },
      );
      setPosition((previous) => (previous.left === next.left && previous.top === next.top ? previous : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (menu.current) observer?.observe(menu.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [left, top]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.getModifierState("AltGraph")
      )
        return;
      if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const state = current.current;
      if (event.key === "Escape") {
        state.onClose();
        return;
      }
      if (event.key === "Enter") {
        const item = state.items[state.activeIndex];
        if (item) state.onChoose(item);
        return;
      }
      if (!state.items.length) return;
      const next =
        (state.activeIndex + (event.key === "ArrowDown" ? 1 : -1) + state.items.length) % state.items.length;
      setSelection({ key: state.key, id: state.items[next]?.id ?? "" });
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  useEffect(() => {
    if (active) activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={menu}
      className="editor-command-menu editor-mention-menu"
      style={{ left: position.left, top: position.top }}
    >
      <div className="editor-command-menu-title">{t("editor.referencePage")}</div>
      <div
        id={listId}
        role="listbox"
        tabIndex={-1}
        aria-label={t("editor.availablePages")}
        aria-busy={loading}
        aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
      >
        {items.map((item) => (
          <button
            key={item.id}
            id={`${listId}-${item.id}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={item.id === active?.id}
            ref={item.id === active?.id ? activeOption : undefined}
            className="editor-command-option editor-mention-option"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelection({ key, id: item.id })}
            onClick={() => onChoose(item)}
          >
            <span className="editor-command-label">{item.title}</span>
          </button>
        ))}
      </div>
      {!items.length && (
        <p className="editor-command-empty" role="status">
          {loading
            ? t("editor.searchingPages")
            : results.error
              ? t("editor.mentionFailed")
              : t("editor.mentionEmpty")}
        </p>
      )}
      <div className="editor-command-hint" aria-hidden="true">
        {t("editor.commandKeys")}
      </div>
    </div>
  );
}
