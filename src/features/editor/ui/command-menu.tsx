"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type BlockCommand, filterBlockCommands } from "./command-catalog";
import { useInlineMenuAria } from "./use-inline-menu-aria";

type Point = { left: number; top: number };
type Size = { width: number; height: number };
export type CommandMenuProps = {
  query: string;
  anchor: Point;
  onChoose: (command: BlockCommand) => void;
  onClose: () => void;
  label?: string;
  id?: string;
  anchorElement?: HTMLElement;
};

/** CSS limits the menu size; this helper positions that bounded box inside the viewport. */
export function getCommandMenuPosition(anchor: Point, viewport: Size, menu: Size): Point {
  const width = Math.min(menu.width, Math.max(0, viewport.width - 16));
  const height = Math.min(menu.height, Math.max(0, viewport.height - 16));
  return {
    left: Math.max(8, Math.min(anchor.left, viewport.width - width - 8)),
    top: Math.max(8, Math.min(anchor.top, viewport.height - height - 8)),
  };
}

export function CommandMenu({
  query,
  anchor,
  onChoose,
  onClose,
  label = "Adicionar bloco",
  id,
  anchorElement,
}: CommandMenuProps) {
  const generatedId = useId();
  const { left, top } = anchor;
  const listId = id ?? `block-commands-${generatedId}`;
  const commands = useMemo(() => filterBlockCommands(query), [query]);
  const [selection, setSelection] = useState({ query, id: commands[0]?.id });
  const selectedIndex =
    selection.query === query ? commands.findIndex((command) => command.id === selection.id) : 0;
  const activeIndex = Math.max(0, selectedIndex);
  const active = commands[activeIndex];
  const menu = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState(anchor);
  const current = useRef({ commands, activeIndex, query, onChoose, onClose });
  useInlineMenuAria(anchorElement, listId, active ? `${listId}-option-${active.id}` : undefined);

  useLayoutEffect(() => {
    current.current = { commands, activeIndex, query, onChoose, onClose };
  });

  useLayoutEffect(() => {
    const measure = () => {
      const rect = menu.current?.getBoundingClientRect();
      const next = getCommandMenuPosition(
        { left, top },
        { width: window.innerWidth, height: window.innerHeight },
        { width: rect?.width || 336, height: rect?.height || 360 },
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
        const command = state.commands[state.activeIndex];
        if (command) state.onChoose(command);
        return;
      }
      if (!state.commands.length) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const index = (state.activeIndex + direction + state.commands.length) % state.commands.length;
      setSelection({ query: state.query, id: state.commands[index]?.id });
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  useEffect(() => {
    if (active) activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const groups: { section: string; commands: BlockCommand[] }[] = [];
  for (const command of commands) {
    const previous = groups.at(-1);
    if (previous?.section === command.section) previous.commands.push(command);
    else groups.push({ section: command.section, commands: [command] });
  }

  return (
    <div ref={menu} className="editor-command-menu" style={{ left: position.left, top: position.top }}>
      <div className="editor-command-menu-title">{label}</div>
      <div
        id={listId}
        role="listbox"
        tabIndex={-1}
        aria-label={label}
        aria-activedescendant={active ? `${listId}-option-${active.id}` : undefined}
      >
        {groups.map((group) => (
          <fieldset aria-label={group.section} className="editor-command-group" key={group.commands[0]?.id}>
            <legend className="editor-command-section" aria-hidden="true">
              {group.section}
            </legend>
            {group.commands.map((command) => (
              <button
                key={command.id}
                type="button"
                role="option"
                tabIndex={-1}
                id={`${listId}-option-${command.id}`}
                aria-selected={command.id === active?.id}
                ref={command.id === active?.id ? activeOption : undefined}
                className="editor-command-option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelection({ query, id: command.id })}
                onClick={() => onChoose(command)}
              >
                <span className="editor-command-label">{command.label}</span>
                <span className="editor-command-description">{command.description}</span>
              </button>
            ))}
          </fieldset>
        ))}
      </div>
      {!commands.length && (
        <p className="editor-command-empty" role="status">
          Nenhum bloco encontrado. Continue escrevendo ou pressione Esc.
        </p>
      )}
      <div className="editor-command-hint" aria-hidden="true">
        ↑↓ navegar · Enter inserir · Esc fechar
      </div>
    </div>
  );
}
