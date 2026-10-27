import * as Y from "yjs";
import { z } from "zod";
import { between, rebalancePositions } from "@/features/editor/model/block-order";
import { MAX_CONTENT_BYTES, MAX_UPDATE_BYTES } from "@/features/editor/model/content-limits";
import { validateContentDocument } from "@/features/editor/model/content-schema";

export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
export const localPageSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().max(500),
  icon: z.string().max(16),
  parentId: z.uuid().nullable(),
  position: z.string().regex(/^[0-9A-Za-z]{1,128}$/),
  favorite: z.boolean(),
  trashed: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type LocalPage = z.infer<typeof localPageSchema>;
export type LocalDocument = { pageId: string; revision: number; snapshot: Uint8Array; text: string };
export const localOrder = (a: LocalPage, b: LocalPage) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id.localeCompare(b.id);

export function assertLocalTree(pages: readonly LocalPage[]): void {
  const map = new Map(pages.map((page) => [page.id, page]));
  if (map.size !== pages.length) throw new Error("Duplicate local page identity");
  for (const page of pages) {
    const visited = new Set([page.id]);
    let parent = page.parentId;
    while (parent) {
      if (visited.has(parent) || !map.has(parent)) throw new Error("Invalid local page hierarchy");
      visited.add(parent);
      parent = map.get(parent)?.parentId ?? null;
    }
  }
}
export function appendLocalPage(
  pages: readonly LocalPage[],
  parentId: string | null,
): { page: LocalPage; reordered: LocalPage[] } {
  if (parentId && !pages.some((page) => page.id === parentId && !page.trashed))
    throw new Error("Parent unavailable");
  const siblings = pages.filter((page) => page.parentId === parentId).sort(localOrder);
  let position = between(siblings.at(-1)?.position ?? null, null);
  const reordered: LocalPage[] = [];
  if (!position) {
    const positions = rebalancePositions(siblings.length + 1);
    for (const [index, page] of siblings.entries())
      reordered.push({ ...page, position: positions[index] ?? "V" });
    position = positions.at(-1) ?? "V";
  }
  const now = Date.now();
  return {
    page: localPageSchema.parse({
      id: crypto.randomUUID(),
      title: "",
      icon: "",
      parentId,
      position,
      favorite: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    }),
    reordered,
  };
}
export function mergeLocalDocument(
  current: LocalDocument | undefined,
  payload: Uint8Array,
  pageId: string,
): LocalDocument {
  if (!payload.length || payload.length > MAX_UPDATE_BYTES) throw new Error("Invalid local update size");
  const doc = new Y.Doc();
  try {
    if (current?.snapshot.length) Y.applyUpdate(doc, current.snapshot);
    Y.applyUpdate(doc, payload);
    const snapshot = Y.encodeStateAsUpdate(doc);
    if (snapshot.length > MAX_CONTENT_BYTES) throw new Error("Local document too large");
    const projection = validateContentDocument(doc);
    if (new TextEncoder().encode(JSON.stringify(projection)).length > MAX_CONTENT_BYTES)
      throw new Error("Local projection too large");
    return { pageId, snapshot, revision: (current?.revision ?? 0) + 1, text: projection.text };
  } finally {
    doc.destroy();
  }
}

const backupSchema = z.strictObject({
  format: z.literal("bloco-local"),
  version: z.literal(1),
  exportedAt: z.string().max(50),
  pages: z.array(localPageSchema).max(2500),
  documents: z
    .array(z.strictObject({ pageId: z.uuid(), snapshot: z.string().max(12 * 1024 * 1024) }))
    .max(2500),
});
export type LocalBackup = z.infer<typeof backupSchema>;
export function encodeLocalBytes(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192)
    text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(text);
}
export function decodeLocalBackup(text: string): { pages: LocalPage[]; documents: LocalDocument[] } {
  if (new TextEncoder().encode(text).length > 32 * 1024 * 1024) throw new Error("Backup too large");
  const value = backupSchema.parse(JSON.parse(text));
  assertLocalTree(value.pages);
  const ids = new Set(value.pages.map((page) => page.id));
  const seen = new Set<string>();
  const documents = value.documents.map((item) => {
    if (!ids.has(item.pageId) || seen.has(item.pageId) || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.snapshot))
      throw new Error("Invalid backup document identity");
    seen.add(item.pageId);
    const bytes = Uint8Array.from(atob(item.snapshot), (character) => character.charCodeAt(0));
    if (bytes.length > MAX_CONTENT_BYTES) throw new Error("Backup document too large");
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, bytes);
      const projection = validateContentDocument(doc);
      if (new TextEncoder().encode(JSON.stringify(projection)).length > MAX_CONTENT_BYTES)
        throw new Error("Backup projection too large");
      return { pageId: item.pageId, revision: 1, snapshot: bytes, text: projection.text };
    } finally {
      doc.destroy();
    }
  });
  return { pages: value.pages, documents };
}
