"use client";
import { z } from "zod";
import { decodeBackupInWorker } from "./backup-client";
import {
  DocumentTransportError,
  type DocumentOperation,
  type DocumentTransport,
} from "@/features/editor/model/durable-document-provider";
import {
  appendLocalPage,
  assertLocalTree,
  encodeLocalBytes,
  localPageSchema,
  mergeLocalDocument,
  type LocalBackup,
  type LocalDocument,
  type LocalPage,
} from "./model";

const DATABASE = "bloco-local-v1";
let opening: Promise<IDBDatabase> | undefined;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
function notify(remote = false) {
  for (const listener of listeners) listener();
  if (!remote) channel?.postMessage({ type: "changed" });
}
export function subscribeLocal(listener: () => void): () => void {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("bloco-local-changes");
    channel.onmessage = (event) => {
      if (event.data?.type === "changed") notify(true);
    };
  }
  return () => listeners.delete(listener);
}
async function database(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("pages", { keyPath: "id" });
      request.result.createObjectStore("documents", { keyPath: "pageId" });
      request.result.createObjectStore("operations", { keyPath: "key" });
    };
    request.onerror = () => reject(new Error("Local storage unavailable"));
    request.onblocked = () => reject(new Error("Close another old Bloco tab"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
  }).catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local transaction failed"));
  });
}
export async function listLocalPages(): Promise<LocalPage[]> {
  const db = await database();
  const tx = db.transaction("pages", "readonly"),
    done = completed(tx);
  const [values] = await Promise.all([request(tx.objectStore("pages").getAll()) as Promise<unknown[]>, done]);
  return values.map((value) => localPageSchema.parse(value));
}
/** All metadata changes read and write in one IndexedDB transaction, across tabs. */
export async function changeLocalPages(change: (pages: LocalPage[]) => LocalPage[]): Promise<LocalPage[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pages", "readwrite"),
      store = tx.objectStore("pages");
    let next: LocalPage[] = [],
      failure: unknown;
    const read = store.getAll();
    read.onsuccess = () => {
      try {
        next = change((read.result as unknown[]).map((value) => localPageSchema.parse(value))).map((value) =>
          localPageSchema.parse(value),
        );
        if (next.length > 2500) throw new Error("Local page limit");
        assertLocalTree(next);
        for (const page of next) store.put(page);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      notify();
      resolve(next);
    };
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error("Local change failed"));
  });
}
export async function createLocalPage(parentId: string | null): Promise<LocalPage> {
  let created: LocalPage | undefined;
  await changeLocalPages((pages) => {
    const { page, reordered } = appendLocalPage(pages, parentId);
    created = page;
    const positions = new Map(reordered.map((item) => [item.id, item]));
    return [...pages.map((item) => positions.get(item.id) ?? item), page];
  });
  if (!created) throw new Error("Page was not created");
  return created;
}
export async function patchLocalPage(
  id: string,
  patch: Partial<Pick<LocalPage, "title" | "icon" | "parentId" | "position" | "favorite" | "trashed">>,
): Promise<void> {
  z.uuid().parse(id);
  await changeLocalPages((pages) => {
    if (!pages.some((page) => page.id === id)) throw new Error("Page unavailable");
    return pages.map((page) => (page.id === id ? { ...page, ...patch, updatedAt: Date.now() } : page));
  });
}

export class LocalDocumentTransport implements DocumentTransport {
  constructor(private readonly pageId: string) {
    z.uuid().parse(pageId);
  }
  async read() {
    const db = await database();
    const tx = db.transaction(["pages", "documents"], "readonly"),
      done = completed(tx);
    const [page, value] = await Promise.all([
      request(tx.objectStore("pages").get(this.pageId)),
      request(tx.objectStore("documents").get(this.pageId)),
      done,
    ]);
    if (!page || localPageSchema.parse(page).trashed) throw new DocumentTransportError("denied");
    const document = value as LocalDocument | undefined;
    return {
      revision: document?.revision ?? 0,
      schemaVersion: 1,
      snapshot: document?.snapshot.slice() ?? new Uint8Array(),
    };
  }
  async write(operation: DocumentOperation): Promise<{ revision: number }> {
    z.uuid().parse(operation.id);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(operation.payload).buffer)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pages", "documents", "operations"], "readwrite");
      const pages = tx.objectStore("pages"),
        documents = tx.objectStore("documents"),
        receipts = tx.objectStore("operations");
      const key = `${this.pageId}:${operation.id}`;
      const pageRequest = pages.get(this.pageId),
        headRequest = documents.get(this.pageId),
        receiptRequest = receipts.get(key);
      let revision = 0,
        failure: unknown;
      receiptRequest.onsuccess = () => {
        try {
          const page = pageRequest.result ? localPageSchema.parse(pageRequest.result) : undefined;
          if (!page || page.trashed) throw new DocumentTransportError("denied");
          const receipt = receiptRequest.result as { hash: string; revision: number } | undefined;
          if (receipt) {
            if (receipt.hash !== hash) throw new DocumentTransportError("invalid");
            revision = receipt.revision;
            return;
          }
          const document = mergeLocalDocument(
            headRequest.result as LocalDocument | undefined,
            operation.payload,
            this.pageId,
          );
          revision = document.revision;
          documents.put(document);
          receipts.put({ key, hash, revision });
          pages.put({ ...page, updatedAt: Date.now() });
        } catch (error) {
          failure = error instanceof DocumentTransportError ? error : new DocumentTransportError("invalid");
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        notify();
        resolve({ revision });
      };
      tx.onabort = tx.onerror = () => reject(failure ?? new DocumentTransportError("transient"));
    });
  }
}

export async function exportLocalBackup(): Promise<string> {
  const db = await database(),
    tx = db.transaction(["pages", "documents"], "readonly"),
    done = completed(tx);
  const [rawPages, rawDocuments] = await Promise.all([
    request(tx.objectStore("pages").getAll()),
    request(tx.objectStore("documents").getAll()),
    done,
  ]);
  const pages = (rawPages as unknown[]).map((value) => localPageSchema.parse(value));
  const documents = (rawDocuments as LocalDocument[]).map((doc) => ({
    pageId: doc.pageId,
    snapshot: encodeLocalBytes(doc.snapshot),
  }));
  const value: LocalBackup = {
    format: "bloco-local",
    version: 1,
    exportedAt: new Date().toISOString(),
    pages,
    documents,
  };
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > 32 * 1024 * 1024) throw new Error("Backup exceeds 32 MiB");
  return text;
}
/** Add missing pages only; restoring a backup never overwrites a current note. */
export async function importLocalBackup(text: string): Promise<number> {
  const value = await decodeBackupInWorker(text),
    db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["pages", "documents"], "readwrite"),
      pages = tx.objectStore("pages"),
      documents = tx.objectStore("documents");
    let count = 0,
      failure: unknown;
    const read = pages.getAll();
    read.onsuccess = () => {
      try {
        const existing = (read.result as unknown[]).map((item) => localPageSchema.parse(item)),
          ids = new Set(existing.map((item) => item.id));
        const missing = value.pages.filter((page) => !ids.has(page.id));
        if (existing.length + missing.length > 2500) throw new Error("Local page limit");
        assertLocalTree([...existing, ...missing]);
        for (const page of missing) {
          pages.add(page);
          count++;
        }
        for (const doc of value.documents) if (!ids.has(doc.pageId)) documents.add(doc);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      notify();
      resolve(count);
    };
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error("Restore failed"));
  });
}
