import * as Y from "yjs";
import { z } from "zod";
import { contentToneSchema, type BlockAttributes } from "./block-schema";
import { StablePage, type BlockInput } from "./stable-page";
import { MAX_CONTENT_BYTES } from "./content-limits";
import {
  POSITION_MIGRATION_PREFIX,
  validatePositionMigrations,
  validateRootContainers,
} from "./position-migrations";

export const CONTENT_SCHEMA_VERSION = 1;
export { MAX_CONTENT_BYTES, MAX_UPDATE_BYTES } from "./content-limits";
export type ContentTone = z.infer<typeof contentToneSchema>;
type SimpleMark = "bold" | "italic" | "underline" | "strike" | "code";
export type ContentMark =
  | { type: SimpleMark }
  | { type: "link"; attrs: { href: string } }
  | { type: "textStyle"; attrs: { color?: ContentTone; background?: ContentTone } };
export type InlineContent =
  | { type: "text"; text: string; marks?: ContentMark[] }
  | { type: "hardBreak" }
  | { type: "pageMention"; attrs: { pageId: string } };
export type RichTextContent = { type: "doc"; content: { type: "paragraph"; content: InlineContent[] }[] };
export type ContentBlock = BlockInput & { attributes: BlockAttributes; content: RichTextContent };
export type ContentProjection = {
  schemaVersion: 1;
  text: string;
  references: string[];
  files: string[];
  blocks: ContentBlock[];
};

export function initializeContentDocument(document: Y.Doc): void {
  validateRootContainers(document);
  const metadata = document.getMap("meta");
  const current = metadata.get("schemaVersion");
  if (current !== undefined && current !== CONTENT_SCHEMA_VERSION)
    throw new Error("Unsupported content schema");
  if ([...metadata.keys()].some((key) => key !== "schemaVersion"))
    throw new Error("Unknown document metadata");
  if (current === undefined) metadata.set("schemaVersion", CONTENT_SCHEMA_VERSION);
}

const emptyAttributes = z.strictObject({});
const mentionAttributes = z.strictObject({ pageId: z.uuid() });
const colorAttributes = z.strictObject({
  color: contentToneSchema.optional(),
  background: contentToneSchema.optional(),
});
const simpleMarks = new Set<string>(["bold", "italic", "underline", "strike", "code"]);
const linkAttributes = z.strictObject({ href: z.string().min(1).max(4096) });
const reservedRoots = new Set(["meta", "blocks", "placements", "removed", "attrs", "identities"]);

export function isSafeContentLink(href: string): boolean {
  if (
    href !== href.trim() ||
    [...href].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    return false;
  try {
    return ["https:", "http:", "mailto:", "tel:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function parseMarks(value: Record<string, unknown>): ContentMark[] {
  if (Object.keys(value).length > 7) throw new Error("Too many inline marks");
  return Object.entries(value).map(([type, attributes]): ContentMark => {
    if (simpleMarks.has(type)) {
      emptyAttributes.parse(attributes);
      return { type: type as SimpleMark };
    }
    if (type === "link") {
      const attrs = linkAttributes.parse(attributes);
      if (!isSafeContentLink(attrs.href)) throw new Error("Unsafe content link");
      return { type, attrs };
    }
    if (type === "textStyle") {
      const parsed = colorAttributes.parse(attributes);
      const attrs: { color?: ContentTone; background?: ContentTone } = {};
      if (parsed.color !== undefined) attrs.color = parsed.color;
      if (parsed.background !== undefined) attrs.background = parsed.background;
      return { type, attrs };
    }
    throw new Error("Unknown inline mark");
  });
}

/** The clipboard uses the same inline contract as canonical Yjs content, without trusting HTML. */
export function validateRichTextContent(value: unknown): RichTextContent {
  const root = z
    .strictObject({ type: z.literal("doc"), content: z.array(z.unknown()).max(1).default([]) })
    .parse(value);
  const content = root.content.map((paragraph) => {
    const node = z
      .strictObject({ type: z.literal("paragraph"), content: z.array(z.unknown()).max(100000).default([]) })
      .parse(paragraph);
    const inline = node.content.map((value): InlineContent => {
      const kind = z.object({ type: z.string() }).parse(value).type;
      if (kind === "hardBreak") return z.strictObject({ type: z.literal("hardBreak") }).parse(value);
      if (kind === "pageMention")
        return z.strictObject({ type: z.literal("pageMention"), attrs: mentionAttributes }).parse(value);
      const text = z
        .strictObject({
          type: z.literal("text"),
          text: z.string().min(1).max(MAX_CONTENT_BYTES),
          marks: z
            .array(z.strictObject({ type: z.string(), attrs: z.unknown().optional() }))
            .max(7)
            .optional(),
        })
        .parse(value);
      const seen = new Set<string>();
      const marks = (text.marks ?? []).map((mark) => {
        if (seen.has(mark.type)) throw new Error("Duplicate inline mark");
        seen.add(mark.type);
        const parsed = parseMarks({ [mark.type]: mark.attrs === undefined ? {} : mark.attrs })[0];
        if (!parsed) throw new Error("Invalid inline mark");
        return parsed;
      });
      return { type: "text", text: text.text, ...(marks.length ? { marks } : {}) };
    });
    return { type: "paragraph" as const, content: inline };
  });
  return { type: "doc", content };
}

function readFragment(fragment: Y.XmlFragment): {
  content: RichTextContent;
  text: string;
  references: string[];
} {
  const roots = fragment.toArray();
  if (roots.length > 1) throw new Error("A block has one stable text paragraph");
  const paragraph = roots[0];
  if (paragraph === undefined) return { content: { type: "doc", content: [] }, text: "", references: [] };
  if (!(paragraph instanceof Y.XmlElement) || paragraph.nodeName !== "paragraph")
    throw new Error("Invalid text paragraph");
  emptyAttributes.parse(paragraph.getAttributes());
  const content: InlineContent[] = [];
  const text: string[] = [];
  const references: string[] = [];
  for (const child of paragraph.toArray()) {
    if (child instanceof Y.XmlText) {
      emptyAttributes.parse(child.getAttributes());
      for (const delta of child.toDelta()) {
        if (typeof delta.insert !== "string") throw new Error("Text embeds are not supported");
        const marks = parseMarks(delta.attributes ?? {});
        if (delta.insert)
          content.push({ type: "text", text: delta.insert, ...(marks.length ? { marks } : {}) });
        text.push(delta.insert);
      }
    } else if (child instanceof Y.XmlElement && child.length === 0) {
      if (child.nodeName === "hardBreak") {
        emptyAttributes.parse(child.getAttributes());
        content.push({ type: "hardBreak" });
        text.push("\n");
      } else if (child.nodeName === "pageMention") {
        const attrs = mentionAttributes.parse(child.getAttributes());
        content.push({ type: "pageMention", attrs });
        references.push(attrs.pageId);
        text.push(" ");
      } else throw new Error("Unknown inline node");
    } else throw new Error("Invalid inline content");
    if (content.length > 100000) throw new Error("Inline content limit exceeded");
  }
  return {
    content: { type: "doc", content: [{ type: "paragraph", content }] },
    text: text.join(""),
    references,
  };
}

export function validateContentDocument(document: Y.Doc): ContentProjection {
  validateRootContainers(document);
  for (const name of document.share.keys())
    if (
      !reservedRoots.has(name) &&
      !/^block-content:[a-zA-Z0-9_-]{1,80}$/.test(name) &&
      !name.startsWith(POSITION_MIGRATION_PREFIX)
    )
      throw new Error("Unknown document root");
  const metadata = document.getMap("meta");
  if (metadata.get("schemaVersion") !== CONTENT_SCHEMA_VERSION || metadata.size !== 1)
    throw new Error("Unsupported content schema");
  if (Y.encodeStateAsUpdate(document).byteLength > MAX_CONTENT_BYTES)
    throw new Error("Content size limit exceeded");
  const page = new StablePage(document, "validation");
  try {
    page.validate();
    const ids = new Set(document.getMap("blocks").keys());
    const identities = new Set(document.getMap("identities").keys());
    validatePositionMigrations(document, identities);
    for (const name of document.share.keys())
      if (name.startsWith("block-content:") && !ids.has(name.slice("block-content:".length))) {
        const id = name.slice("block-content:".length);
        if (!identities.has(id) || document.getXmlFragment(name).length !== 0)
          throw new Error("Orphan text fragment");
      }
    const groups = new Map<string | null, ContentBlock[]>();
    const fragments = new Map<string, ReturnType<typeof readFragment>>();
    for (const id of ids) {
      const block = page.getBlock(id);
      if (!block) throw new Error("Invalid block placement");
      const fragment = readFragment(page.fragment(id));
      const attributes = page.getBlockAttributes(id);
      if (block.type === "tableCell" && typeof attributes.columnId === "string") {
        const origin = page.getBlock(attributes.columnId);
        const row = block.parentId === null ? undefined : page.getBlock(block.parentId);
        const originRow = origin?.parentId ? page.getBlock(origin.parentId) : undefined;
        if (
          origin?.type !== "tableCell" ||
          row?.type !== "tableRow" ||
          originRow?.type !== "tableRow" ||
          row.parentId !== originRow.parentId
        )
          throw new Error("Invalid table column reference");
      }
      if (
        ["divider", "image", "file", "table", "tableRow", "columns", "column", "databaseRef"].includes(
          block.type,
        ) &&
        fragment.text
      )
        throw new Error("Structural block cannot conceal rich text");
      fragments.set(id, fragment);
      const siblings = groups.get(block.parentId) ?? [];
      siblings.push({ ...block, attributes, content: fragment.content });
      groups.set(block.parentId, siblings);
    }
    for (const group of groups.values())
      group.sort((a, b) =>
        a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
    const blocks: ContentBlock[] = [];
    const text: string[] = [];
    const references = new Set<string>();
    const files = new Set<string>();
    const removed = document.getMap<boolean>("removed");
    const stack = [...(groups.get(null) ?? [])].reverse();
    while (stack.length) {
      const block = stack.pop();
      if (!block || removed.get(block.id)) continue;
      blocks.push(block);
      const fragment = fragments.get(block.id);
      if (fragment?.text) text.push(fragment.text);
      for (const reference of fragment?.references ?? []) references.add(reference);
      if (typeof block.attributes.fileId === "string") files.add(block.attributes.fileId);
      for (const key of ["alt", "caption", "displayName"])
        if (typeof block.attributes[key] === "string" && block.attributes[key])
          text.push(block.attributes[key]);
      for (const child of [...(groups.get(block.id) ?? [])].reverse()) stack.push(child);
    }
    return {
      schemaVersion: 1,
      text: text.join("\n"),
      references: [...references].sort(),
      files: [...files].sort(),
      blocks,
    };
  } finally {
    page.destroy();
  }
}
