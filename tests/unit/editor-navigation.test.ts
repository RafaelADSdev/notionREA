import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../src/features/editor/client/editor-session";
import type { DocumentReferences } from "../../src/features/editor/client/reference-resolver";
import { useEditorNavigation } from "../../src/features/editor/client/use-editor-navigation";

let view: Root | undefined;
let host: HTMLDivElement | undefined;
const flush = vi.fn<() => Promise<void>>();
const session = {
  provider: { flush, hasPendingChanges: () => true, synchronize: async () => undefined },
  getStatus: () => "error",
} as unknown as EditorSession;
const references = { refresh: () => undefined } as unknown as DocumentReferences;
function NavigationGuard() {
  useEditorNavigation(session, references);
  return null;
}
function mount() {
  host = document.createElement("div");
  document.body.append(host);
  view = createRoot(host);
  flushSync(() => view?.render(createElement(NavigationGuard)));
}
beforeEach(() => {
  vi.useFakeTimers();
  flush.mockResolvedValue(undefined);
});
afterEach(() => {
  flushSync(() => view?.unmount());
  view = undefined;
  host?.remove();
  for (const element of document.querySelectorAll("form, a")) element.remove();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("native navigation replay", () => {
  it("lets an editor-owned local form handle submit immediately while writes are pending", () => {
    mount();
    const form = document.createElement("form");
    form.setAttribute("data-editor-local-form", "");
    document.body.append(form);
    const handler = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", handler);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(handler).toHaveBeenCalledOnce();
    expect(flush).not.toHaveBeenCalled();
  });

  it("waits for the next browser task before resubmitting a form after an immediate flush", async () => {
    mount();
    const form = document.createElement("form");
    document.body.append(form);
    const submit = vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);
    expect(form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))).toBe(false);
    // A resolved flush still runs in the original browser submit task. Native
    // requestSubmit ignores reentry until that task's submission flag clears.
    await Promise.resolve();
    await Promise.resolve();
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("cancels delayed navigation if its editor lease closes before flushing finishes", async () => {
    mount();
    const completion = Promise.withResolvers<void>();
    flush.mockReturnValue(completion.promise);
    const anchor = document.createElement("a");
    anchor.href = "/destination";
    document.body.append(anchor);
    const click = vi.spyOn(anchor, "click").mockImplementation(() => undefined);
    anchor.dispatchEvent(new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }));
    flushSync(() => view?.unmount());
    view = undefined;
    completion.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
