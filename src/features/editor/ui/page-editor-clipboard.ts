import { type Editor, getSchema } from "@tiptap/core";
import { DOMParser as SchemaParser } from "@tiptap/pm/model";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { z } from "zod";
import { insertBlock, orderedBlocks, removeBlockSelection } from "../model/block-commands";
import { blockTypeSchema, validateBlockAttributes } from "../model/block-schema";
import { MAX_CONTENT_BYTES } from "../model/content-limits";
import {
  type ContentBlock,
  type RichTextContent,
  validateContentDocument,
  validateRichTextContent,
} from "../model/content-schema";
import type { StablePage } from "../model/stable-page";
import { runEditorPlan } from "./page-editor-plan";
import { createTextExtensions } from "./text-extensions";

export const BLOCKS_CLIPBOARD_MIME = "application/x-bloco-blocks+json";
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const envelopeSchema = z.strictObject({
  version: z.literal(1),
  sourcePageId: z.uuid(),
  blocks: z
    .array(
      z.strictObject({
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
export type BlockClipboard = { version: 1; sourcePageId: string; blocks: ContentBlock[] };
export class CrossPageFilePasteError extends Error {}

export function readBlockClipboard(value: string): BlockClipboard {
  if (new TextEncoder().encode(value).byteLength > MAX_CONTENT_BYTES)
    throw new Error("Clipboard content is too large");
  const parsed = envelopeSchema.parse(JSON.parse(value));
  const ids = new Set(parsed.blocks.map((block) => block.id));
  if (ids.size !== parsed.blocks.length) throw new Error("Duplicate clipboard identity");
  const blocks = parsed.blocks.map((block) => ({
    ...block,
    attributes: validateBlockAttributes(block.type, block.attributes),
    content: validateRichTextContent(block.content),
  }));
  const byId = new Map(blocks.map((block) => [block.id, block]));
  for (const block of blocks) {
    let current: string | null = block.id;
    const visited = new Set<string>();
    while (current && byId.has(current)) {
      if (visited.has(current)) throw new Error("Clipboard ancestry cycle");
      visited.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  return { version: 1, sourcePageId: parsed.sourcePageId.toLowerCase(), blocks };
}

export function selectedClipboard(
  page: StablePage,
  ids: readonly string[],
  sourcePageId: string,
): BlockClipboard {
  const projection = validateContentDocument(page.document);
  const selected = new Set(ids);
  const byId = new Map(projection.blocks.map((block) => [block.id, block]));
  const blocks = projection.blocks.filter((block) => {
    let current: string | null = block.id;
    while (current) {
      if (selected.has(current)) return true;
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  });
  return { version: 1, sourcePageId, blocks };
}

export function clipboardPlainText(value: BlockClipboard): string {
  return value.blocks
    .filter((block) => !["table", "tableRow", "columns", "column"].includes(block.type))
    .map((block) =>
      block.type === "image"
        ? "[Imagem]"
        : block.type === "file"
          ? "[Arquivo]"
          : block.content.content
              .flatMap((paragraph) =>
                paragraph.content.map((inline) =>
                  inline.type === "text"
                    ? inline.text
                    : inline.type === "hardBreak"
                      ? "\n"
                      : "Referência de página",
                ),
              )
              .join(""),
    )
    .join("\n");
}

export function pasteBlocks(
  page: StablePage,
  editors: ReadonlyMap<string, Editor>,
  value: BlockClipboard,
  pageId: string,
  activeId: string | undefined,
  selected: string[],
): { id: string; position: number } | null {
  if (!value.blocks.length) return null;
  if (
    value.sourcePageId.toLowerCase() !== pageId.toLowerCase() &&
    value.blocks.some((block) => typeof block.attributes.fileId === "string")
  )
    throw new CrossPageFilePasteError();
  const schema = getSchema(createTextExtensions());
  return runEditorPlan(page, editors, (plan) => {
    const ordered = orderedBlocks(plan.page);
    const incoming = new Set(value.blocks.map((block) => block.id));
    const selectedSet = new Set(selected);
    const roots = ordered.filter(
      (block) => selectedSet.has(block.id) && !selectedSet.has(block.parentId ?? ""),
    );
    const current = roots[0] ?? (activeId ? plan.page.getBlock(activeId) : undefined);
    const parentId = current?.parentId ?? null;
    const siblings = ordered.filter((block) => block.parentId === parentId);
    const at = current ? siblings.findIndex((block) => block.id === current.id) : siblings.length - 1;
    const beforeId = siblings.slice(at + 1).find((block) => !selectedSet.has(block.id))?.id ?? null;
    if (selected.length) removeBlockSelection(plan.page, selected);
    else if (
      current?.type === "paragraph" &&
      editors.get(current.id)?.state.doc.firstChild?.content.size === 0
    )
      plan.page.removeBlock(current.id);
    const mapped = new Map<string, string>();
    const pending = [...value.blocks];
    while (pending.length) {
      const index = pending.findIndex(
        (block) => block.parentId === null || !incoming.has(block.parentId) || mapped.has(block.parentId),
      );
      if (index < 0) throw new Error("Missing clipboard parent");
      const [block] = pending.splice(index, 1);
      if (!block) throw new Error("Missing clipboard block");
      const copiedParent = block.parentId === null ? undefined : mapped.get(block.parentId);
      const attributes = { ...block.attributes };
      delete attributes.columnId;
      const id = insertBlock(plan.page, {
        type: block.type,
        parentId: copiedParent ?? parentId,
        ...(copiedParent ? {} : { beforeId }),
        attributes,
      });
      mapped.set(block.id, id);
      if (block.content.content.length)
        prosemirrorJSONToYXmlFragment(schema, block.content, plan.page.fragment(id));
    }
    for (const block of value.blocks) {
      if (typeof block.attributes.columnId !== "string") continue;
      const id = mapped.get(block.id);
      const columnId = mapped.get(block.attributes.columnId);
      if (!id || !columnId) throw new Error("A copied table column origin is missing");
      plan.page.setBlockAttributes(id, { columnId });
    }
    const last =
      [...value.blocks]
        .reverse()
        .find(
          (block) =>
            !["table", "tableRow", "columns", "column", "divider", "image", "file", "databaseRef"].includes(
              block.type,
            ),
        ) ?? value.blocks[0];
    const id = last ? mapped.get(last.id) : undefined;
    if (!last || !id) throw new Error("Missing pasted focus target");
    return {
      id,
      position:
        1 +
        (last.content.content[0]?.content.reduce(
          (size, node) => size + (node.type === "text" ? node.text.length : 1),
          0,
        ) ?? 0),
    };
  });
}

function paragraph(content: unknown): RichTextContent {
  return validateRichTextContent({ type: "doc", content: [{ type: "paragraph", content }] });
}
export function pastePlainLines(
  page: StablePage,
  editors: ReadonlyMap<string, Editor>,
  id: string,
  value: string,
): { id: string; position: number } {
  const editor = editors.get(id);
  const source = page.getBlock(id);
  if (!editor || !source) throw new Error("Missing paste target");
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const marks = (editor.state.storedMarks ?? editor.state.selection.$from.marks()).map((mark) =>
    mark.toJSON(),
  );
  const inline = (text: string) => (text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : []);
  return runEditorPlan(page, editors, (plan) => {
    const selection = editor.state.selection;
    if (lines.length === 1) {
      plan.edit(id, selection.from, selection.to, inline(lines[0] ?? ""));
      return { id, position: selection.from + (lines[0]?.length ?? 0) };
    }
    if (source.type === "tableCell") {
      const content = lines.flatMap((line, index) => [
        ...(index ? [{ type: "hardBreak" }] : []),
        ...inline(line),
      ]);
      paragraph(content);
      plan.edit(id, selection.from, selection.to, content);
      return { id, position: selection.from + value.length };
    }
    const original = editor.state.doc.firstChild;
    if (!original) throw new Error("Missing source paragraph");
    const tail = original.content.cut(selection.to - 1).toJSON() ?? [];
    plan.edit(id, selection.from, original.content.size + 1, inline(lines[0] ?? ""));
    const siblings = orderedBlocks(plan.page).filter((block) => block.parentId === source.parentId);
    const beforeId = siblings[siblings.findIndex((block) => block.id === id) + 1]?.id ?? null;
    let focused = id;
    for (const [index, line] of lines.slice(1).entries()) {
      focused = insertBlock(plan.page, { type: "paragraph", parentId: source.parentId, beforeId });
      const content = paragraph([...inline(line), ...(index === lines.length - 2 ? tail : [])]);
      prosemirrorJSONToYXmlFragment(editor.schema, content, plan.page.fragment(focused));
    }
    return { id: focused, position: (lines.at(-1)?.length ?? 0) + 1 };
  });
}

export function htmlClipboard(html: string, editor: Editor, sourcePageId: string): BlockClipboard {
  if (new TextEncoder().encode(html).byteLength > MAX_CONTENT_BYTES)
    throw new Error("HTML clipboard is too large");
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of document.querySelectorAll("script,style,iframe,object,embed,svg,math,link,meta"))
    element.remove();
  const slice = SchemaParser.fromSchema(editor.schema).parseSlice(document.body);
  const blocks: ContentBlock[] = [];
  const append = (content: unknown) =>
    blocks.push({
      id: crypto.randomUUID(),
      type: "paragraph",
      parentId: null,
      position: "U",
      attributes: {},
      content: paragraph(content),
    });
  let inline: unknown[] = [];
  slice.content.forEach((node) => {
    if (node.isInline) inline.push(node.toJSON());
    else {
      if (inline.length) {
        append(inline);
        inline = [];
      }
      append(node.content.toJSON() ?? []);
    }
  });
  if (inline.length) append(inline);
  return { version: 1, sourcePageId, blocks };
}
