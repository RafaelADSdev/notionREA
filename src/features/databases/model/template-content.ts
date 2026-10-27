import * as Y from "yjs";
import { z } from "zod";
import { blockTypeSchema, validateBlockAttributes } from "@/features/editor/model/block-schema";
import { MAX_UPDATE_BYTES } from "@/features/editor/model/content-limits";
import {
  initializeContentDocument,
  validateContentDocument,
  validateRichTextContent,
} from "@/features/editor/model/content-schema";
import { StablePage } from "@/features/editor/model/stable-page";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const projectionSchema = z.object({
  schemaVersion: z.literal(1),
  blocks: z
    .array(
      z.object({
        id: identifier,
        type: blockTypeSchema,
        parentId: identifier.nullable(),
        position: z.string().regex(/^[0-9A-Za-z]{1,128}$/),
        attributes: z.record(z.string(), z.unknown()),
        content: z.unknown(),
      }),
    )
    .max(10000),
});

/** Fresh CRDT identities, bounded causal batches, and intentional page references. */
export function templateContentUpdates(
  projection: unknown,
  files: ReadonlyMap<string, string>,
): Uint8Array[] {
  const source = projectionSchema.parse(projection);
  const document = new Y.Doc();
  const page = new StablePage(document, "template-copy");
  const ids = new Map(source.blocks.map((block) => [block.id, crypto.randomUUID()]));
  if (ids.size !== source.blocks.length) throw new Error("Duplicate template identity");
  const updates: Uint8Array[] = [];
  let vector = Y.encodeStateVector(document);
  const flush = (force = false) => {
    const delta = Y.encodeStateAsUpdate(document, vector);
    if (delta.length > MAX_UPDATE_BYTES) throw new Error("Template batch exceeds content limit");
    if (delta.length > 2 && (force || delta.length >= 96 * 1024)) {
      updates.push(delta);
      vector = Y.encodeStateVector(document);
    }
  };
  try {
    initializeContentDocument(document);
    const pending = [...source.blocks];
    const created = new Set<string>();
    while (pending.length) {
      const index = pending.findIndex((block) => block.parentId === null || created.has(block.parentId));
      if (index < 0) throw new Error("Invalid template hierarchy");
      const block = pending.splice(index, 1)[0];
      if (!block) throw new Error("Missing template block");
      const id = ids.get(block.id);
      const parentId = block.parentId === null ? null : ids.get(block.parentId);
      if (!id || parentId === undefined) throw new Error("Missing template identity");
      page.createBlock({ id, parentId, type: block.type, position: block.position });
      const attributes = { ...validateBlockAttributes(block.type, block.attributes) };
      // Column origins are set after their independent identities exist.
      delete attributes.columnId;
      if (typeof attributes.fileId === "string") {
        const fileId = files.get(attributes.fileId);
        if (!fileId) throw new Error("Template attachment unavailable");
        attributes.fileId = fileId;
      }
      page.setBlockAttributes(id, attributes);
      created.add(block.id);
      flush();
    }
    flush(true);
    for (const block of source.blocks) {
      const id = ids.get(block.id);
      if (!id) throw new Error("Missing template identity");
      if (typeof block.attributes.columnId === "string") {
        const columnId = ids.get(block.attributes.columnId);
        if (!columnId) throw new Error("Missing template column origin");
        page.setBlockAttributes(id, { columnId });
      }
      const richText = validateRichTextContent(block.content);
      if (richText.content.length) {
        const paragraph = new Y.XmlElement("paragraph");
        page.fragment(id).insert(0, [paragraph]);
        for (const inline of richText.content[0]?.content ?? []) {
          if (inline.type === "text") {
            const text = new Y.XmlText();
            paragraph.insert(paragraph.length, [text]);
            const attributes = Object.fromEntries(
              (inline.marks ?? []).map((mark) => [mark.type, "attrs" in mark ? mark.attrs : {}]),
            );
            for (let start = 0; start < inline.text.length; ) {
              let end = Math.min(start + 16384, inline.text.length);
              const boundary = inline.text.charCodeAt(end - 1);
              if (end < inline.text.length && boundary >= 0xd800 && boundary <= 0xdbff) end--;
              text.insert(text.length, inline.text.slice(start, end), attributes);
              flush();
              start = end;
            }
          } else {
            const node = new Y.XmlElement(inline.type);
            if (inline.type === "pageMention") node.setAttribute("pageId", inline.attrs.pageId);
            paragraph.insert(paragraph.length, [node]);
          }
        }
      }
      flush();
    }
    flush(true);
    validateContentDocument(document);
    return updates;
  } finally {
    page.destroy();
    document.destroy();
  }
}
