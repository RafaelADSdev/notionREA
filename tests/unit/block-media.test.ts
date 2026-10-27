import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { BlockMedia } from "../../src/features/editor/ui/block-media";
import type { BlockFileResolver, PageFileInfo } from "../../src/features/files/types";

const actions = vi.hoisted(() => ({ prepare: vi.fn(), finish: vi.fn() }));
vi.mock("@/features/files/block-actions", () => ({
  prepareBlockUpload: actions.prepare,
  finishBlockUpload: actions.finish,
}));
const fileId = "20000000-0000-4000-8000-000000000001",
  pageId = "10000000-0000-4000-8000-000000000001";
const info: PageFileInfo = {
  fileId,
  name: "Synthetic.png",
  mimeType: "image/png",
  size: 68,
  width: 320,
  height: 240,
};
const cleanups: (() => void)[] = [];
class Resolver implements BlockFileResolver {
  values = new Map<string, PageFileInfo>();
  listeners = new Set<() => void>();
  ensure = vi.fn();
  resolve(id: string) {
    return this.values.get(id) ?? null;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  prime(value: PageFileInfo) {
    this.values.set(value.fileId, value);
    for (const listener of this.listeners) listener();
  }
}
class UploadRequest {
  static instances: UploadRequest[] = [];
  status = 200;
  body: FormData | null = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = (body: FormData) => {
    this.body = body;
  };
  abort = () => this.onabort?.();
  constructor() {
    UploadRequest.instances.push(this);
  }
}
function fixture(kind: "image" | "file" = "image", editable = true, ready = false) {
  const document = new Y.Doc(),
    page = new StablePage(document, "test");
  page.createBlock({ id: "media", type: kind, parentId: null, position: "m" });
  if (ready)
    page.setBlockAttributes("media", { fileId, ...(kind === "image" ? { alt: "Descrição segura" } : {}) });
  const resolver = new Resolver();
  if (ready) resolver.prime(info);
  const host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    flushSync(() =>
      root.render(createElement(BlockMedia, { page, blockId: "media", pageId, editable, kind, resolver })),
    );
  render();
  cleanups.push(() => {
    flushSync(() => root.unmount());
    host.remove();
    page.destroy();
    document.destroy();
  });
  return { page, resolver, host, render };
}
function selectFile(host: HTMLElement, file: File) {
  const input = host.querySelector('input[type="file"]');
  if (!input) throw new Error("Expected upload input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  flushSync(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}
beforeEach(() => {
  UploadRequest.instances = [];
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  vi.stubGlobal("fetch", vi.fn());
  actions.prepare.mockResolvedValue({
    ok: true,
    value: {
      fileId,
      path: "owned/path",
      token: "synthetic",
      signedUrl: "https://storage.example.test/upload",
    },
  });
  actions.finish.mockResolvedValue({ ok: true, value: info });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
describe("block media user actions", () => {
  it("renders verified lazy image dimensions and queues only resolver metadata in read-only mode", () => {
    const { host, resolver } = fixture("image", false, true);
    const image = host.querySelector("img");
    expect(image?.getAttribute("width")).toBe("320");
    expect(image?.getAttribute("height")).toBe("240");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("alt")).toBe("Descrição segura");
    expect(host.querySelector("button,input")).toBeNull();
    expect(resolver.ensure).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("commits alternate text on blur rather than each local field input", () => {
    const { host, page } = fixture("image", true, true);
    const input = Array.from(host.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Descrição"))
      ?.querySelector("input");
    if (!input) throw new Error("Expected description field");
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Expected native input setter");
    setter.call(input, "Nova descrição");
    flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    expect(page.getBlockAttributes("media").alt).toBe("Descrição segura");
    flushSync(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(page.getBlockAttributes("media").alt).toBe("Nova descrição");
  });
  it("does not overwrite a remote field update merely because the unedited input loses focus", () => {
    const { host, page, render } = fixture("image", true, true);
    const input = Array.from(host.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Descrição"))
      ?.querySelector("input");
    if (!input) throw new Error("Expected description field");
    input.focus();
    page.setBlockAttributes("media", { alt: "Descrição remota" });
    render();
    flushSync(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(page.getBlockAttributes("media").alt).toBe("Descrição remota");
  });
  it("uploads generic bytes with an opaque MIME, reports progress and binds only finalized file metadata", async () => {
    const { host, page, resolver } = fixture("file");
    selectFile(host, new File(["<script>opaque</script>"], "Synthetic.html", { type: "text/html" }));
    await vi.waitFor(() => expect(UploadRequest.instances).toHaveLength(1));
    const request = UploadRequest.instances[0];
    if (!request) throw new Error("Expected upload request");
    expect(request.setRequestHeader).toHaveBeenCalledWith("x-upsert", "false");
    const uploaded = request.body?.get("");
    if (!(uploaded instanceof Blob)) throw new Error("Expected file bytes");
    expect(uploaded.type).toBe("application/octet-stream");
    expect(page.getBlockAttributes("media").fileId).toBeUndefined();
    flushSync(() =>
      request.upload.onprogress?.(
        new ProgressEvent("progress", { lengthComputable: true, loaded: 5, total: 10 }),
      ),
    );
    expect(host.querySelector("progress")?.value).toBe(50);
    request.onload?.();
    await vi.waitFor(() => expect(page.getBlockAttributes("media").fileId).toBe(fileId));
    expect(resolver.resolve(fileId)).toEqual(info);
    expect(host.textContent).toContain("Arquivo adicionado.");
  });
  it("allows cancellation and an explicit retry without attaching a partial upload", async () => {
    const { host, page } = fixture("file");
    selectFile(host, new File(["opaque"], "Retry.bin"));
    await vi.waitFor(() => expect(UploadRequest.instances).toHaveLength(1));
    const cancel = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancelar envio",
    );
    if (!cancel) throw new Error("Expected cancellation");
    flushSync(() => cancel.click());
    await vi.waitFor(() => expect(host.textContent).toContain("Envio cancelado"));
    expect(page.getBlockAttributes("media").fileId).toBeUndefined();
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Tentar envio novamente",
    );
    if (!retry) throw new Error("Expected retry");
    flushSync(() => retry.click());
    await vi.waitFor(() => expect(UploadRequest.instances).toHaveLength(2));
    UploadRequest.instances[1]?.onload?.();
    await vi.waitFor(() => expect(page.getBlockAttributes("media").fileId).toBe(fileId));
  });
});
