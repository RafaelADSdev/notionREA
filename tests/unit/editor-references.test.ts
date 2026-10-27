import { Editor } from "@tiptap/core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentReferences } from "../../src/features/editor/client/reference-resolver";
import { MentionMenu } from "../../src/features/editor/ui/mention-menu";
import { createTextExtensions } from "../../src/features/editor/ui/text-extensions";
import type { PageFileInfo } from "../../src/features/files/types";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (index: number) => `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const cleanups: (() => void)[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const file: PageFileInfo = {
  fileId: id(900),
  name: "<b>Arquivo</b>.pdf",
  mimeType: "application/pdf",
  size: 100,
  width: null,
  height: null,
};
function references(onUnavailable?: () => void) {
  const result = new DocumentReferences({ workspaceId, pageId, ...(onUnavailable ? { onUnavailable } : {}) });
  cleanups.push(() => result.dispose());
  return result;
}
function requested(init?: RequestInit) {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON reference request");
  return JSON.parse(init.body) as { workspaceId: string; mentions: string[]; files: string[] };
}
async function microtasks() {
  for (let step = 0; step < 20; step++) await Promise.resolve();
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("authorized document reference batches", () => {
  it("updates mounted mention NodeViews on rename and revocation using plain text labels only", async () => {
    let title = "<img src=x onerror=alert(1)>";
    let visible = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ mentions: visible ? [{ id: id(1), title, icon: "" }] : [], files: [] })),
    );
    const resolver = references();
    const editor = new Editor({
      element: document.createElement("div"),
      injectCSS: false,
      extensions: createTextExtensions({ mentionResolver: resolver.mentions }),
    });
    cleanups.push(() => editor.destroy());
    editor.commands.insertContent({ type: "pageMention", attrs: { pageId: id(1) } });
    expect(editor.view.dom.textContent).toBe("Referência indisponível");
    resolver.ensureMention(id(1));
    await vi.waitFor(() => expect(editor.view.dom.textContent).toBe(title));
    expect(editor.view.dom.querySelector(".page-mention img")).toBeNull();
    title = "Nome atualizado";
    resolver.refresh();
    await vi.waitFor(() => expect(editor.view.dom.textContent).toBe(title));
    visible = false;
    resolver.refresh();
    await vi.waitFor(() => expect(editor.view.dom.textContent).toBe("Referência indisponível"));
    expect(editor.view.dom.innerHTML).not.toContain("Nome atualizado");
    expect(JSON.stringify(editor.getJSON())).not.toContain("title");
  });

  it("coalesces 250 ensured mentions into three bounded POST requests", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const input = requested(init);
      return json({
        mentions: input.mentions.map((value) => ({ id: value, title: value, icon: "" })),
        files: [],
      });
    });
    vi.stubGlobal("fetch", fetch);
    const resolver = references();
    for (let index = 1; index <= 250; index++) resolver.ensureMention(id(index));
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(250))).not.toBeNull());
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [path, init] of fetch.mock.calls) {
      expect(path).toBe(`/api/documents/${pageId}/references`);
      expect(init?.method).toBe("POST");
      expect(init?.cache).toBe("no-store");
      expect(requested(init).mentions.length).toBeLessThanOrEqual(100);
      expect(requested(init).workspaceId).toBe(workspaceId);
    }
  });

  it("runs at most two network requests while queueing remaining batches", async () => {
    const pending: {
      input: ReturnType<typeof requested>;
      response: ReturnType<typeof Promise.withResolvers<Response>>;
    }[] = [];
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const response = Promise.withResolvers<Response>();
      pending.push({ input: requested(init), response });
      return response.promise;
    });
    vi.stubGlobal("fetch", fetch);
    const resolver = references();
    for (let index = 1; index <= 250; index++) resolver.ensureMention(id(index));
    await microtasks();
    expect(fetch).toHaveBeenCalledTimes(2);
    pending[0]?.response.resolve(json({ mentions: [], files: [] }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    pending[1]?.response.resolve(json({ mentions: [], files: [] }));
    pending[2]?.response.resolve(json({ mentions: [], files: [] }));
    await microtasks();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("notifies renamed labels and removes both mention and file metadata omitted by an authorized refresh", async () => {
    let title = "Título anterior";
    let available = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ mentions: available ? [{ id: id(1), title, icon: "" }] : [], files: available ? [file] : [] }),
      ),
    );
    const resolver = references();
    const listener = vi.fn();
    resolver.mentions.subscribe(listener);
    resolver.ensureMention(id(1));
    resolver.files.ensure(file.fileId);
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(1))?.title).toBe(title));
    expect(resolver.files.resolve(file.fileId)?.name).toBe(file.name);
    const calls = listener.mock.calls.length;
    title = "Título atualizado";
    resolver.refresh();
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(1))?.title).toBe(title));
    expect(listener.mock.calls.length).toBeGreaterThan(calls);
    available = false;
    resolver.refresh();
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(1))).toBeNull());
    expect(resolver.files.resolve(file.fileId)).toBeNull();
  });

  it("normalizes UUID case, deduplicates ensures and supplies only an authorized local page href", async () => {
    const uuid = id(0xabcd);
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(requested(init).mentions).toEqual([uuid]);
      return json({ mentions: [{ id: uuid.toUpperCase(), title: "", icon: "" }], files: [] });
    });
    vi.stubGlobal("fetch", fetch);
    const resolver = references();
    resolver.ensureMention(uuid.toUpperCase());
    resolver.ensureMention(uuid);
    resolver.ensureMention("not-a-uuid");
    await vi.waitFor(() => expect(resolver.mentions.resolve(uuid)).not.toBeNull());
    expect(resolver.mentions.resolve(uuid.toUpperCase())).toEqual({
      title: "Página sem título",
      href: `/w/${workspaceId}/p/${uuid}`,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(resolver.mentions.resolve(id(2))).toBeNull();
  });

  it("clears all labels and notifies source-page revocation on a 403", async () => {
    let allowed = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        allowed
          ? json({ mentions: [{ id: id(1), title: "Privado", icon: "" }], files: [file] })
          : json({}, 403),
      ),
    );
    const unavailable = vi.fn();
    const resolver = references(unavailable);
    const listener = vi.fn();
    resolver.mentions.subscribe(listener);
    resolver.ensureMention(id(1));
    resolver.files.ensure(file.fileId);
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(1))).not.toBeNull());
    const calls = listener.mock.calls.length;
    allowed = false;
    resolver.refresh();
    await vi.waitFor(() => expect(unavailable).toHaveBeenCalledTimes(1));
    expect(resolver.mentions.resolve(id(1))).toBeNull();
    expect(resolver.files.resolve(file.fileId)).toBeNull();
    expect(listener.mock.calls.length).toBeGreaterThan(calls);
  });

  it("keeps authorized metadata on transient errors and refreshes only when explicitly requested", async () => {
    let failed = false;
    const fetch = vi.fn(async () =>
      failed ? json({}, 503) : json({ mentions: [{ id: id(1), title: "Autorizado", icon: "" }], files: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    const resolver = references();
    resolver.ensureMention(id(1));
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(1))).not.toBeNull());
    failed = true;
    resolver.refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await microtasks();
    expect(resolver.mentions.resolve(id(1))?.title).toBe("Autorizado");
    resolver.ensureMention(id(1));
    await microtasks();
    expect(fetch).toHaveBeenCalledTimes(2);
    failed = false;
    resolver.refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });

  it("primes upload metadata, aborts in-flight fetches on disposal and ignores late responses", async () => {
    const response = Promise.withResolvers<Response>();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return response.promise;
      }),
    );
    const resolver = references();
    resolver.files.prime(file);
    expect(resolver.files.resolve(file.fileId)).toEqual(file);
    resolver.ensureMention(id(1));
    await microtasks();
    resolver.dispose();
    expect(signal?.aborted).toBe(true);
    expect(resolver.files.resolve(file.fileId)).toBeNull();
    response.resolve(json({ mentions: [{ id: id(1), title: "Late label", icon: "" }], files: [] }));
    await microtasks();
    expect(resolver.mentions.resolve(id(1))).toBeNull();
  });

  it("does not erase a newly finalized upload with an earlier missing-file response", async () => {
    const response = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    const resolver = references();
    resolver.files.ensure(file.fileId);
    await microtasks();
    resolver.files.prime(file);
    response.resolve(json({ mentions: [], files: [] }));
    await microtasks();
    expect(resolver.files.resolve(file.fileId)).toEqual(file);
  });

  it("returns stable immutable file snapshots for useSyncExternalStore consumers", () => {
    const resolver = references();
    resolver.files.prime(file);
    const snapshot = resolver.files.resolve(file.fileId);
    expect(resolver.files.resolve(file.fileId)).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("aborts peer batches on revocation and does not restore labels from a stale successful response", async () => {
    const pending: {
      input: ReturnType<typeof requested>;
      signal: AbortSignal | null | undefined;
      response: ReturnType<typeof Promise.withResolvers<Response>>;
    }[] = [];
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const response = Promise.withResolvers<Response>();
      pending.push({ input: requested(init), signal: init?.signal, response });
      return response.promise;
    });
    vi.stubGlobal("fetch", fetch);
    const unavailable = vi.fn();
    const resolver = references(unavailable);
    resolver.files.prime(file);
    for (let index = 1; index <= 250; index++) resolver.ensureMention(id(index));
    await microtasks();
    expect(fetch).toHaveBeenCalledTimes(2);
    pending[0]?.response.resolve(json({}, 403));
    await vi.waitFor(() => expect(unavailable).toHaveBeenCalledTimes(1));
    expect(pending[1]?.signal?.aborted).toBe(true);
    const staleId = pending[1]?.input.mentions[0];
    pending[1]?.response.resolve(
      json({ mentions: [{ id: staleId, title: "Never restore this private label", icon: "" }], files: [] }),
    );
    await microtasks();
    expect(fetch).toHaveBeenCalledTimes(2);
    if (!staleId) throw new Error("Missing queued reference");
    expect(resolver.mentions.resolve(staleId)).toBeNull();
    expect(resolver.files.resolve(file.fileId)).toBeNull();
  });

  it("counts actual response bytes despite a misleading declared length", async () => {
    let oversized = false;
    const fetch = vi.fn(async () =>
      oversized
        ? new Response(`${" ".repeat(512 * 1024)}${JSON.stringify({ mentions: [], files: [] })}`, {
            headers: { "Content-Length": "1" },
          })
        : json({ mentions: [{ id: id(1), title: "Retain authorized label", icon: "" }], files: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    const resolver = references();
    resolver.ensureMention(id(1));
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(1))).not.toBeNull());
    oversized = true;
    resolver.refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await microtasks();
    expect(resolver.mentions.resolve(id(1))?.title).toBe("Retain authorized label");
  });

  it("rejects unrequested identities and unknown response fields without poisoning authorized metadata", async () => {
    let invalid = false;
    const fetch = vi.fn(async () =>
      json({
        mentions: [
          {
            id: invalid ? id(2) : id(1),
            title: "Authorized",
            icon: "",
            ...(invalid ? { html: "<script>untrusted</script>" } : {}),
          },
        ],
        files: [],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const resolver = references();
    resolver.ensureMention(id(1));
    await vi.waitFor(() => expect(resolver.mentions.resolve(id(1))).not.toBeNull());
    invalid = true;
    resolver.refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await microtasks();
    expect(resolver.mentions.resolve(id(1))?.title).toBe("Authorized");
    expect(resolver.mentions.resolve(id(2))).toBeNull();
  });
});

function renderMenu(query = "") {
  const editor = document.createElement("input");
  editor.value = `@${query}`;
  const host = document.createElement("div");
  document.body.append(editor, host);
  editor.focus();
  const root = createRoot(host);
  const chosen: { id: string; title: string; icon: string | null }[] = [];
  let closed = 0;
  const render = (next: string) =>
    flushSync(() =>
      root.render(
        createElement(MentionMenu, {
          workspaceId,
          query: next,
          anchor: { left: 20, top: 30 },
          onChoose: (item) => {
            chosen.push(item);
          },
          onClose: () => {
            closed++;
          },
        }),
      ),
    );
  render(query);
  cleanups.push(() => {
    flushSync(() => root.unmount());
    editor.remove();
    host.remove();
  });
  return {
    editor,
    host,
    chosen,
    render,
    key(value: string, options: KeyboardEventInit = {}) {
      const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
      flushSync(() => editor.dispatchEvent(event));
      return event;
    },
    get closed() {
      return closed;
    },
  };
}

describe("inline page mention menu", () => {
  it("debounces searches, navigates authorized options and preserves editor focus", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () =>
      json({
        items: [
          { id: id(1), title: "Primeira", rank: 1, updated_at: "2026-10-26T12:00:00Z" },
          { id: id(2), title: "Segunda", rank: 0, updated_at: "2026-10-26T12:00:00Z" },
        ],
        more: false,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const menu = renderMenu("plano");
    await vi.advanceTimersByTimeAsync(179);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(menu.host.querySelectorAll('[role="option"]')).toHaveLength(2));
    expect(menu.key("ArrowDown").defaultPrevented).toBe(true);
    menu.key("Enter");
    expect(menu.chosen).toEqual([{ id: id(2), title: "Segunda", icon: null }]);
    expect(document.activeElement).toBe(menu.editor);
    const option = menu.host.querySelector('[role="option"]');
    if (!(option instanceof HTMLButtonElement)) throw new Error("Missing mention option");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(menu.editor.value).toBe("@plano");
  });

  it("aborts stale query searches and closes with Escape without changing literal mention text", async () => {
    vi.useFakeTimers();
    const requests: {
      signal?: AbortSignal | null;
      response: ReturnType<typeof Promise.withResolvers<Response>>;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const response = Promise.withResolvers<Response>();
        requests.push({ signal: init?.signal ?? null, response });
        return response.promise;
      }),
    );
    const menu = renderMenu("old");
    await vi.advanceTimersByTimeAsync(180);
    menu.render("new");
    expect(requests[0]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(180);
    requests[1]?.response.resolve(json({ items: [], more: false }));
    await microtasks();
    flushSync(() => {});
    expect(menu.key("Enter").defaultPrevented).toBe(true);
    expect(menu.chosen).toEqual([]);
    expect(menu.key("Escape", { isComposing: true }).defaultPrevented).toBe(false);
    expect(menu.key("Enter", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(menu.closed).toBe(0);
    menu.key("Escape");
    expect(menu.closed).toBe(1);
    expect(menu.editor.value).toBe("@old");
  });
});
