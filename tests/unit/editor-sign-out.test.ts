import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  clearOtherEditorSessions,
  flushAllEditorSessions,
  getEditorSession,
  hasUnconfirmedEditorSessions,
} from "../../src/features/editor/client/editor-session";
import { DocumentTransportError } from "../../src/features/editor/model/durable-document-provider";
import { initialContentUpdate } from "../../src/features/editor/model/initial-content";
import { SafeSignOut } from "../../src/features/editor/ui/safe-sign-out";

const transport = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("../../src/features/auth/actions", () => auth);
vi.mock("../../src/features/editor/client/http-transport", () => ({
  HttpDocumentTransport: class {
    read = transport.read;
    write = transport.write;
  },
}));

const releases: (() => void)[] = [];
let view: Root | undefined;
let host: HTMLDivElement | undefined;
const workspaceId = "20000000-0000-4000-8000-000000000001";
async function draft(userId: string, pageId: string) {
  transport.read.mockResolvedValue({ revision: 1, schemaVersion: 1, snapshot: initialContentUpdate() });
  const session = getEditorSession({ userId, workspaceId, pageId, editable: true });
  releases.push(session.mount());
  await session.connect();
  const paragraph = session.page.fragment("initial").get(0);
  if (!(paragraph instanceof Y.XmlElement)) throw new Error("Expected a paragraph");
  paragraph.insert(0, [new Y.XmlText("Unconfirmed draft")]);
  return session;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  host?.remove();
  host = undefined;
  clearOtherEditorSessions("cleanup");
  for (const release of releases.splice(0)) release();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function render(userId: string) {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    view = createRoot(host);
  }
  await act(async () => view?.render(createElement(SafeSignOut, { userId })));
  const form = host.querySelector("form");
  if (!form) throw new Error("Expected sign-out form");
  return form;
}

describe("sign-out document safety", () => {
  it("waits for every current-user ACK, including retained sessions, without flushing another user", async () => {
    const first = await draft("first-user", "first-page");
    const retained = await draft("first-user", "second-page");
    await draft("second-user", "first-page");
    const ack = Promise.withResolvers<{ revision: number }>();
    transport.write.mockReturnValue(ack.promise);
    releases[1]?.();
    expect(hasUnconfirmedEditorSessions("first-user")).toBe(true);
    let finished = false;
    const flush = flushAllEditorSessions("first-user").then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(transport.write).toHaveBeenCalledTimes(2));
    expect(finished).toBe(false);
    expect(first.provider.hasPendingChanges()).toBe(true);
    expect(retained.provider.hasPendingChanges()).toBe(true);
    ack.resolve({ revision: 2 });
    await flush;
    expect(hasUnconfirmedEditorSessions("first-user")).toBe(false);
    expect(hasUnconfirmedEditorSessions("second-user")).toBe(true);
    expect(transport.write).toHaveBeenCalledTimes(2);
  });

  it("retains a failed mounted draft for the explicit discard decision and later retry", async () => {
    const session = await draft("first-user", "first-page");
    transport.write.mockRejectedValue(new DocumentTransportError("transient"));
    await flushAllEditorSessions("first-user");
    expect(hasUnconfirmedEditorSessions("first-user")).toBe(true);
    expect(session.draftText()).toBe("Unconfirmed draft");
    expect(session.isMounted()).toBe(true);
    transport.write.mockResolvedValue({ revision: 2 });
    await session.provider.retry();
    expect(hasUnconfirmedEditorSessions("first-user")).toBe(false);
  });

  it("cancels the auth action after an explicit refusal and keeps the draft available", async () => {
    const session = await draft("first-user", "first-page");
    transport.write.mockRejectedValue(new DocumentTransportError("transient"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const form = await render("first-user");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(confirm).toHaveBeenCalledOnce();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(session.draftText()).toBe("Unconfirmed draft");
    expect(hasUnconfirmedEditorSessions("first-user")).toBe(true);
    expect(host?.querySelector("button")?.disabled).toBe(false);
  });

  it("does not sign out a new identity when an older user's flush finishes late", async () => {
    await draft("first-user", "first-page");
    const ack = Promise.withResolvers<{ revision: number }>();
    transport.write.mockReturnValue(ack.promise);
    const confirm = vi.spyOn(window, "confirm");
    const form = await render("first-user");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await render("second-user");
    await act(async () => ack.resolve({ revision: 2 }));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("allows the existing auth action after an explicit discard choice", async () => {
    await draft("first-user", "first-page");
    transport.write.mockRejectedValue(new DocumentTransportError("transient"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const form = await render("first-user");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
