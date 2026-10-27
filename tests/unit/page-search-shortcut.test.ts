import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PageSearch } from "../../src/features/pages/search";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

it("respects an editor-handled Ctrl+K and keeps global search for an unhandled shortcut", () => {
  vi.useFakeTimers();
  const previous = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(createElement(PageSearch, { workspaceId: "10000000-0000-4000-8000-000000000001" })),
    );
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Buscar páginas"]');
    if (!dialog) throw new Error("Expected page search dialog");
    const handled = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    handled.preventDefault();
    flushSync(() => window.dispatchEvent(handled));
    expect(dialog.open).toBe(false);
    flushSync(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true })),
    );
    expect(dialog.open).toBe(true);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    if (previous) Object.defineProperty(HTMLDialogElement.prototype, "showModal", previous);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    vi.useRealTimers();
  }
});
