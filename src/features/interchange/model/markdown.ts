import { Lexer } from "marked";
import { z } from "zod";
import { blockTypeSchema, validateBlockAttributes } from "@/features/editor/model/block-schema";
import {
  type ContentBlock,
  type ContentMark,
  type ContentProjection,
  type InlineContent,
  isSafeContentLink,
  validateRichTextContent,
} from "@/features/editor/model/content-schema";
import { INTERCHANGE_LIMITS, type InterchangeWarning } from "./contracts";
import { resolveArchiveLink } from "./paths";

type Token = {
  type: string;
  raw: string;
  text?: string;
  tokens?: Token[];
  depth?: number;
  href?: string;
  title?: string | null;
  lang?: string;
  ordered?: boolean;
  start?: number;
  items?: { tokens: Token[]; task?: boolean; checked?: boolean }[];
  header?: { tokens: Token[] }[];
  rows?: { tokens: Token[] }[][];
};
export type MediaBinding = { blockId: string; path: string; kind: "image" | "file" };
export type ImportedPage = {
  projection: ContentProjection;
  media: MediaBinding[];
  warnings: InterchangeWarning[];
};
const blockInput = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  type: blockTypeSchema,
  parentId: z.string().nullable(),
  position: z.string().regex(/^[A-Za-z0-9]{1,128}$/),
  attributes: z.record(z.string(), z.unknown()),
  content: z.unknown(),
});
export function normalizeImportProjection(input: unknown): ContentProjection {
  const value = z
    .strictObject({ schemaVersion: z.literal(1), blocks: z.array(blockInput).max(10000) })
    .parse(input);
  const ids = new Set(value.blocks.map((block) => block.id));
  if (ids.size !== value.blocks.length) throw Error("Duplicate imported identity");
  const blocks: ContentBlock[] = value.blocks.map((block) => ({
    ...block,
    attributes: validateBlockAttributes(block.type, block.attributes),
    content: validateRichTextContent(block.content),
  }));
  for (const block of blocks)
    if (block.parentId !== null && !ids.has(block.parentId)) throw Error("Missing imported parent");
  const text = blocks
    .map((block) =>
      block.content.content
        .flatMap((paragraph) =>
          paragraph.content.map((inline) =>
            inline.type === "text" ? inline.text : inline.type === "hardBreak" ? "\n" : " ",
          ),
        )
        .join(""),
    )
    .join("\n");
  const references = [
    ...new Set(
      blocks.flatMap((block) =>
        block.content.content.flatMap((p) =>
          p.content.flatMap((i) => (i.type === "pageMention" ? [i.attrs.pageId] : [])),
        ),
      ),
    ),
  ];
  const files = [
    ...new Set(
      blocks.flatMap((block) =>
        typeof block.attributes.fileId === "string" ? [block.attributes.fileId] : [],
      ),
    ),
  ];
  const projection: ContentProjection = { schemaVersion: 1, blocks, text, references, files };
  if (new TextEncoder().encode(JSON.stringify(projection)).byteLength > INTERCHANGE_LIMITS.pageBytes)
    throw Error("Imported page exceeds content budget");
  return projection;
}
export function importMarkdown(
  source: string,
  path: string,
  pages: ReadonlyMap<string, string> = new Map(),
): ImportedPage {
  if (new TextEncoder().encode(source).byteLength > INTERCHANGE_LIMITS.pageBytes)
    throw Error("Markdown exceeds page budget");
  const warnings: InterchangeWarning[] = [];
  const media: MediaBinding[] = [];
  const blocks: ContentBlock[] = [];
  let position = 0;
  const warn = (code: string) => {
    if (!warnings.some((value) => value.code === code)) warnings.push({ code, path });
  };
  const rich = (tokens: Token[] | undefined, marks: ContentMark[] = []): InlineContent[] => {
    const result: InlineContent[] = [];
    for (const token of tokens ?? []) {
      if (token.type === "br") {
        result.push({ type: "hardBreak" });
        continue;
      }
      if (token.type === "strong" || token.type === "em" || token.type === "del") {
        result.push(
          ...rich(token.tokens, [
            ...marks,
            { type: token.type === "strong" ? "bold" : token.type === "em" ? "italic" : "strike" },
          ]),
        );
        continue;
      }
      if (token.type === "link") {
        const target = resolveArchiveLink(path, token.href ?? "");
        const pageId = target ? pages.get(target) : undefined;
        if (pageId) {
          result.push({ type: "pageMention", attrs: { pageId } });
          continue;
        }
        if (token.href && isSafeContentLink(token.href))
          result.push(...rich(token.tokens, [...marks, { type: "link", attrs: { href: token.href } }]));
        else {
          warn("unresolved-local-link");
          result.push(...rich(token.tokens, marks));
        }
        continue;
      }
      if (token.type === "image") {
        const value = token.text || token.href || "Imagem";
        if (value) result.push({ type: "text", text: value, marks });
        warn("inline-image-separated");
        continue;
      }
      if (token.type === "html") warn("html-preserved-as-text");
      const value = token.text ?? token.raw;
      if (value)
        result.push({
          type: "text",
          text: value,
          ...(token.type === "codespan" || marks.length
            ? { marks: token.type === "codespan" ? [...marks, { type: "code" as const }] : marks }
            : {}),
        });
    }
    return result;
  };
  const add = (
    type: ContentBlock["type"],
    parentId: string | null,
    content: InlineContent[] = [],
    attributes: ContentBlock["attributes"] = {},
  ) => {
    const block: ContentBlock = {
      id: crypto.randomUUID(),
      type,
      parentId,
      position: `a${String(position++).padStart(8, "0")}V`,
      attributes,
      content: { type: "doc", content: content.length ? [{ type: "paragraph", content }] : [] },
    };
    blocks.push(block);
    if (blocks.length > 10000) throw Error("Too many Markdown blocks");
    return block;
  };
  const walk = (tokens: Token[], parent: string | null) => {
    for (const token of tokens) {
      if (token.type === "space") continue;
      if (token.type === "heading") {
        add("heading", parent, rich(token.tokens), { level: Math.min(3, token.depth ?? 1) });
        continue;
      }
      if (token.type === "code") {
        add("code", parent, token.text ? [{ type: "text", text: token.text }] : [], {
          language: "plaintext",
        });
        if (token.lang && token.lang !== "plaintext") warn("code-language-normalized");
        continue;
      }
      if (token.type === "hr") {
        add("divider", parent);
        continue;
      }
      if (token.type === "blockquote") {
        const first = token.tokens?.find((value) => value.type !== "space");
        const convention = first?.text?.match(/^\[Bloco:(callout|toggle)\] ?/);
        if (first && convention) {
          const kind = convention[1] === "toggle" ? "toggle" : "callout";
          const text = (first.text ?? "").slice(convention[0].length);
          const quote = add(kind, parent, rich(Lexer.lexInline(text) as unknown as Token[]));
          walk(
            (token.tokens ?? []).filter((value) => value !== first),
            quote.id,
          );
        } else {
          const quote = add("quote", parent);
          walk(token.tokens ?? [], quote.id);
        }
        continue;
      }
      if (token.type === "list") {
        for (const [index, item] of (token.items ?? []).entries()) {
          const first = item.tokens.find((value) => value.type !== "space");
          const block = add(
            item.task ? "task" : token.ordered ? "numberListItem" : "bulletListItem",
            parent,
            rich(first?.tokens ?? (first ? [{ ...first, type: "text" }] : [])),
            item.task
              ? { checked: !!item.checked }
              : token.ordered
                ? { start: (token.start ?? 1) + index }
                : {},
          );
          walk(
            item.tokens.filter((value) => value !== first),
            block.id,
          );
        }
        continue;
      }
      if (token.type === "table") {
        const table = add("table", parent, [], { header: true });
        for (const row of [token.header ?? [], ...(token.rows ?? [])]) {
          const tr = add("tableRow", table.id);
          for (const cell of row) add("tableCell", tr.id, rich(cell.tokens));
        }
        continue;
      }
      const inlineTokens = token.tokens ?? [token];
      const image = inlineTokens.length === 1 && inlineTokens[0]?.type === "image" ? inlineTokens[0] : null;
      if (image?.href) {
        const local = resolveArchiveLink(path, image.href);
        if (local) {
          const block = add("image", parent, [], { alt: image.text ?? "", caption: image.title ?? "" });
          media.push({ blockId: block.id, path: local, kind: "image" });
          continue;
        }
        warn("remote-image-kept-as-link");
      }
      if (inlineTokens.length === 1 && inlineTokens[0]?.type === "link") {
        const link = inlineTokens[0];
        const local = resolveArchiveLink(path, link.href ?? "");
        if (local && !/\.(md|markdown)$/i.test(local) && !pages.has(local)) {
          const block = add("file", parent, [], {
            displayName: link.text ?? local.split("/").at(-1) ?? "Arquivo",
          });
          media.push({ blockId: block.id, path: local, kind: "file" });
          continue;
        }
      }
      add("paragraph", parent, rich(inlineTokens));
    }
  };
  walk(Lexer.lex(source, { gfm: true }) as unknown as Token[], null);
  return { projection: normalizeImportProjection({ schemaVersion: 1, blocks }), media, warnings };
}
const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}[\]<>]/g, "\\$&");
export function exportMarkdown(
  projection: ContentProjection,
  options: {
    pages: ReadonlyMap<string, { href: string; label: string }>;
    files: ReadonlyMap<string, { href: string; name: string }>;
  },
): { text: string; warnings: InterchangeWarning[] } {
  const warnings: InterchangeWarning[] = [];
  const warn = (code: string) => {
    if (!warnings.some((value) => value.code === code)) warnings.push({ code });
  };
  const inline = (block: ContentBlock) =>
    block.content.content
      .flatMap((p) =>
        p.content.map((value) => {
          if (value.type === "hardBreak") return "  \n";
          if (value.type === "pageMention") {
            const page = options.pages.get(value.attrs.pageId);
            return page
              ? `[${escapeMarkdown(page.label)}](${encodeURI(page.href).replaceAll("#", "%23").replaceAll("?", "%3F").replaceAll("(", "%28").replaceAll(")", "%29")})`
              : "Referência indisponível";
          }
          let text = escapeMarkdown(value.text);
          for (const mark of value.marks ?? []) {
            if (mark.type === "bold") text = `**${text}**`;
            else if (mark.type === "italic") text = `*${text}*`;
            else if (mark.type === "strike") text = `~~${text}~~`;
            else if (mark.type === "code") text = `\`${text.replaceAll("`", "\\`")}\``;
            else if (mark.type === "link") text = `[${text}](${mark.attrs.href.replaceAll(")", "%29")})`;
            else warn("inline-style-not-representable");
          }
          return text;
        }),
      )
      .join("");
  const groups = new Map<string | null, ContentBlock[]>();
  for (const block of projection.blocks) {
    const list = groups.get(block.parentId) ?? [];
    list.push(block);
    groups.set(block.parentId, list);
  }
  for (const list of groups.values())
    list.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1));
  const output: string[] = [];
  const emit = (parent: string | null, indent: string) => {
    for (const block of groups.get(parent) ?? []) {
      let text = inline(block);
      const attrs = block.attributes;
      if (block.type === "heading") text = `${"#".repeat(Number(attrs.level) || 1)} ${text}`;
      else if (block.type === "bulletListItem") text = `- ${text}`;
      else if (block.type === "numberListItem") text = `${Number(attrs.start) || 1}. ${text}`;
      else if (block.type === "task") text = `- [${attrs.checked ? "x" : " "}] ${text}`;
      else if (block.type === "divider") text = "---";
      else if (block.type === "code") {
        const literal = block.content.content
          .flatMap((p) =>
            p.content.map((value) =>
              value.type === "text" ? value.text : value.type === "hardBreak" ? "\n" : " ",
            ),
          )
          .join("");
        let fence = "```";
        while (literal.includes(fence)) fence += "`";
        text = `${fence}${String(attrs.language ?? "")}\n${literal}\n${fence}`;
      } else if (block.type === "image" || block.type === "file") {
        const file = typeof attrs.fileId === "string" ? options.files.get(attrs.fileId) : undefined;
        text = file
          ? `${block.type === "image" ? "!" : ""}[${escapeMarkdown(String(block.type === "image" ? (attrs.alt ?? "") : (attrs.displayName ?? file.name)))}](${encodeURI(file.href).replaceAll("#", "%23").replaceAll("?", "%3F").replaceAll("(", "%28").replaceAll(")", "%29")})${attrs.caption ? `\n${escapeMarkdown(String(attrs.caption))}` : ""}`
          : "Arquivo indisponível";
        if (attrs.width) warn("image-layout-not-representable");
      } else if (block.type === "quote" || block.type === "callout" || block.type === "toggle") {
        if (block.type !== "quote") {
          text = `[Bloco:${block.type}] ${text}`;
          warn("callout-toggle-convention");
        }
        if (text) output.push(`${indent}> ${text}`);
        emit(block.id, `${indent}> `);
        continue;
      } else if (block.type === "columns" || block.type === "column") {
        warn("columns-linearized");
        emit(block.id, indent);
        continue;
      } else if (block.type === "table") {
        const rows = (groups.get(block.id) ?? []).map((row) =>
          (groups.get(row.id) ?? []).map((cell) => inline(cell).replaceAll("|", "\\|").replaceAll("\n", " ")),
        );
        if (rows.length) {
          const columns = Math.max(...rows.map((row) => row.length));
          output.push(
            `${indent}| ${rows[0]?.join(" | ")} |`,
            `${indent}| ${Array(columns).fill("---").join(" | ")} |`,
            ...rows.slice(1).map((row) => `${indent}| ${row.join(" | ")} |`),
          );
        }
        continue;
      } else if (block.type === "databaseRef") {
        text = "Base de dados: consulte o CSV incluído quando autorizado.";
        warn("database-view-not-representable");
      }
      output.push(`${indent}${text}`);
      emit(
        block.id,
        ["bulletListItem", "numberListItem", "task"].includes(block.type) ? `${indent}  ` : indent,
      );
      output.push("");
    }
  };
  emit(null, "");
  return { text: output.join("\n"), warnings };
}
