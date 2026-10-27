import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  BLOCK_COMMANDS,
  type BlockCommand,
  filterBlockCommands,
} from "../../src/features/editor/ui/command-catalog";
import { CommandMenu, getCommandMenuPosition } from "../../src/features/editor/ui/command-menu";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function renderMenu(query = "") {
  const input = document.createElement("input");
  const host = document.createElement("div");
  document.body.append(input, host);
  input.focus();
  const root = createRoot(host);
  const chosen: BlockCommand[] = [];
  let closed = 0;
  const render = (
    nextQuery: string,
    choose: (command: BlockCommand) => void = (command) => {
      chosen.push(command);
    },
  ) =>
    flushSync(() =>
      root.render(
        createElement(CommandMenu, {
          query: nextQuery,
          anchor: { left: 20, top: 30 },
          id: "commands",
          anchorElement: input,
          onChoose: choose,
          onClose: () => {
            closed += 1;
          },
        }),
      ),
    );
  render(query);
  cleanups.push(() => {
    flushSync(() => root.unmount());
    input.remove();
    host.remove();
  });
  const key = (value: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init });
    flushSync(() => input.dispatchEvent(event));
    return event;
  };
  return {
    input,
    host,
    chosen,
    key,
    render,
    get closed() {
      return closed;
    },
  };
}

describe("block command catalog", () => {
  it("exposes the active option on the writing control that keeps keyboard focus", () => {
    const view = renderMenu();
    expect(document.activeElement).toBe(view.input);
    expect(view.input.getAttribute("aria-controls")).toBe("commands");
    expect(view.input.getAttribute("aria-activedescendant")).toBe("commands-option-paragraph");
    view.key("ArrowDown");
    expect(view.input.getAttribute("aria-activedescendant")).toBe("commands-option-h1");
  });
  it("covers all M3 commands with heading levels and excludes the M4 database reference", () => {
    expect(
      BLOCK_COMMANDS.filter((command) => command.type === "heading").map(
        (command) => command.attributes?.level,
      ),
    ).toEqual([1, 2, 3]);
    expect(new Set(BLOCK_COMMANDS.map((command) => command.id)).size).toBe(BLOCK_COMMANDS.length);
    expect(BLOCK_COMMANDS.some((command) => command.type === "databaseRef")).toBe(false);
  });
  it("matches accent-insensitive pt-BR and English aliases with stable ranking", () => {
    expect(filterBlockCommands("  CODIGO ")[0]?.type).toBe("code");
    expect(filterBlockCommands("heading 2")[0]?.attributes?.level).toBe(2);
    expect(filterBlockCommands("bullet")[0]?.type).toBe("bulletListItem");
    expect(filterBlockCommands("citacao")[0]?.type).toBe("quote");
    expect(filterBlockCommands("texto")[0]?.id).toBe("paragraph");
    expect(filterBlockCommands("to")[0]?.id).toBe("task");
    expect(filterBlockCommands("")).toEqual(BLOCK_COMMANDS);
    expect(filterBlockCommands("no-such-command")).toEqual([]);
  });
});

describe("command menu", () => {
  it("moves the active option and chooses with Enter while keeping editor focus", () => {
    const menu = renderMenu("heading");
    expect(document.activeElement).toBe(menu.input);
    expect(menu.host.querySelector('[aria-selected="true"]')?.textContent).toContain("Título 1");
    expect(menu.key("ArrowDown").defaultPrevented).toBe(true);
    expect(menu.host.querySelector('[aria-selected="true"]')?.textContent).toContain("Título 2");
    menu.key("Enter");
    expect(menu.chosen[0]?.attributes?.level).toBe(2);
    expect(document.activeElement).toBe(menu.input);
  });
  it("does not choose from an empty result or during IME and closes on Escape", () => {
    const menu = renderMenu("no-such-command");
    expect(menu.host.textContent).toContain("Nenhum bloco encontrado");
    menu.key("Enter");
    expect(menu.chosen).toEqual([]);
    expect(menu.key("Escape", { isComposing: true }).defaultPrevented).toBe(false);
    expect(menu.closed).toBe(0);
    menu.key("Escape");
    expect(menu.closed).toBe(1);
    expect(menu.input.value).toBe("");
  });
  it("uses current callbacks after rerender and preserves focus on pointer interaction", () => {
    const menu = renderMenu("image");
    let current = "";
    menu.render("file", (command) => {
      current = command.id;
    });
    expect(menu.key("Enter", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(current).toBe("");
    menu.key("Enter");
    expect(current).toBe("file");
    current = "";
    const option = menu.host.querySelector('[role="option"]');
    if (!(option instanceof HTMLElement)) throw new Error("Missing command option");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(menu.input);
    option.click();
    expect(current).toBe("file");
    expect(menu.chosen).toEqual([]);
  });
  it("bounds menu geometry on a narrow viewport and near its bottom edge", () => {
    expect(
      getCommandMenuPosition(
        { left: 390, top: 790 },
        { width: 390, height: 800 },
        { width: 336, height: 360 },
      ),
    ).toEqual({ left: 46, top: 432 });
    expect(
      getCommandMenuPosition(
        { left: -50, top: -10 },
        { width: 280, height: 320 },
        { width: 336, height: 360 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });
});
