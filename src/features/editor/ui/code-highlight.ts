import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { codeLanguageSchema } from "../model/block-schema";

export type CodeHighlightOptions = { isCode: () => boolean; language: () => string };
type Language = (typeof codeLanguageSchema.options)[number];
type TokenKind = "keyword" | "string" | "number" | "comment" | "property" | "tag";
type Token = { from: number; to: number; kind: TokenKind };
type HighlightState = { document: Node; language: Language; enabled: boolean; decorations: DecorationSet };
const words = (value: string) => new Set(value.split(" "));
const javascript =
  "const let var function return if else for while do class new true false null undefined async await import export from default throw try catch finally break continue switch case typeof instanceof this extends super yield delete void of in";
const keywords: Partial<Record<Language, ReadonlySet<string>>> = {
  javascript: words(javascript),
  typescript: words(
    `${javascript} interface type enum implements public private protected readonly as satisfies never unknown number string boolean abstract declare namespace keyof infer`,
  ),
  json: words("true false null"),
  python: words(
    "def class return if elif else for while in is not and or True False None import from as try except finally raise with lambda yield pass break continue async await global nonlocal del assert",
  ),
  sql: words(
    "select from where join inner left right outer full on as and or not null true false insert into values update set delete create table alter drop index group by order having limit offset union distinct asc desc case when then else end exists like in is primary key references constraint default begin commit rollback",
  ),
  bash: words(
    "if then else elif fi for while until do done in case esac function local export return source readonly declare true false",
  ),
};
function digit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}
function nameStart(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || character === "_" || character === "$";
}
function space(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\n";
}
function nextNonSpace(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && space(text[index])) index++;
  return index;
}
function until(text: string, offset: number, delimiter: string): number {
  let index = offset;
  while (index < text.length && !text.startsWith(delimiter, index)) index++;
  return Math.min(text.length, index + delimiter.length);
}
function lineEnd(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && text[index] !== "\n") index++;
  return index;
}
function stringEnd(text: string, offset: number, delimiter: string): number {
  let index = offset + delimiter.length;
  while (index < text.length) {
    if (text[index] === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (text.startsWith(delimiter, index)) return index + delimiter.length;
    index++;
  }
  return index;
}
function numberEnd(text: string, offset: number): number {
  let index = offset;
  if (text[index] === "-") index++;
  if (text[index] === "0" && ["x", "X", "b", "B", "o", "O"].includes(text[index + 1] ?? "")) {
    index += 2;
    while (
      index < text.length &&
      (digit(text[index]) ||
        ["a", "b", "c", "d", "e", "f", "A", "B", "C", "D", "E", "F", "_"].includes(text[index] ?? ""))
    )
      index++;
    return index;
  }
  while (digit(text[index]) || text[index] === "_") index++;
  if (text[index] === "." && digit(text[index + 1])) {
    index++;
    while (digit(text[index]) || text[index] === "_") index++;
  }
  if (
    (text[index] === "e" || text[index] === "E") &&
    (digit(text[index + 1]) || (["+", "-"].includes(text[index + 1] ?? "") && digit(text[index + 2])))
  ) {
    index++;
    if (text[index] === "+" || text[index] === "-") index++;
    while (digit(text[index])) index++;
  }
  return index;
}

/** Forward-only lexical classification. Every loop consumes characters; delimiters have fixed length. */
function tokenize(text: string, language: Language): Token[] {
  const result: Token[] = [];
  let index = 0;
  const emit = (to: number, kind: TokenKind) => {
    result.push({ from: index, to, kind });
    index = to;
  };
  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (language === "html" && text.startsWith("<!--", index)) {
      emit(until(text, index + 4, "-->"), "comment");
      continue;
    }
    if (["javascript", "typescript", "css", "sql"].includes(language) && character === "/" && next === "*") {
      emit(until(text, index + 2, "*/"), "comment");
      continue;
    }
    if (
      ((language === "javascript" || language === "typescript") && character === "/" && next === "/") ||
      (language === "sql" && character === "-" && next === "-") ||
      ((language === "python" || language === "bash") && character === "#")
    ) {
      emit(lineEnd(text, index), "comment");
      continue;
    }
    if (language === "markdown" && character === "#" && (index === 0 || text[index - 1] === "\n")) {
      emit(lineEnd(text, index), "keyword");
      continue;
    }
    if (
      character === '"' ||
      character === "'" ||
      (character === "`" && ["javascript", "typescript", "bash", "sql", "markdown"].includes(language))
    ) {
      const triple =
        (language === "python" || language === "markdown") &&
        text.startsWith((character ?? "").repeat(3), index);
      const end = stringEnd(text, index, triple ? (character ?? "").repeat(3) : character);
      const property =
        ["json", "javascript", "typescript"].includes(language) && text[nextNonSpace(text, end)] === ":";
      emit(end, property ? "property" : "string");
      continue;
    }
    if (language === "html" && character === "<") {
      let end = index + 1;
      if (text[end] === "/" || text[end] === "!") end++;
      if (nameStart(text[end])) {
        while (nameStart(text[end]) || digit(text[end]) || text[end] === "-" || text[end] === ":") end++;
        emit(end, "tag");
        continue;
      }
    }
    if (digit(character) || (character === "-" && digit(next))) {
      emit(numberEnd(text, index), "number");
      continue;
    }
    if (nameStart(character)) {
      let end = index + 1;
      while (
        nameStart(text[end]) ||
        digit(text[end]) ||
        ((language === "css" || language === "html") && text[end] === "-")
      )
        end++;
      const value = text.slice(index, end);
      const separator = text[nextNonSpace(text, end)];
      if (keywords[language]?.has(language === "sql" ? value.toLowerCase() : value)) emit(end, "keyword");
      else if (
        (["css", "json", "javascript", "typescript"].includes(language) && separator === ":") ||
        (language === "html" && separator === "=")
      )
        emit(end, "property");
      else if (language === "css" && index > 0 && text[index - 1] === "@") emit(end, "keyword");
      else index = end;
      continue;
    }
    index++;
  }
  return result;
}

export function codeHighlightExtension(options: CodeHighlightOptions): Extension<CodeHighlightOptions> {
  return Extension.create<CodeHighlightOptions>({
    name: "codeHighlight",
    addOptions: () => options,
    addProseMirrorPlugins() {
      const key = new PluginKey<HighlightState>("blocoCodeHighlight");
      const settings = this.options;
      const compute = (document: Node, previous?: HighlightState): HighlightState => {
        const enabled = settings.isCode();
        const parsed = codeLanguageSchema.safeParse(settings.language());
        const language = parsed.success ? parsed.data : "plaintext";
        if (previous?.document === document && previous.enabled === enabled && previous.language === language)
          return previous;
        const paragraph = document.firstChild;
        const tokens =
          enabled && language !== "plaintext" && paragraph
            ? tokenize(paragraph.textBetween(0, paragraph.content.size, "\n", "\n"), language)
            : [];
        const decorations = tokens.length
          ? DecorationSet.create(
              document,
              tokens.map((token) =>
                Decoration.inline(token.from + 1, token.to + 1, { class: `code-token code-${token.kind}` }),
              ),
            )
          : DecorationSet.empty;
        return { document, language, enabled, decorations };
      };
      return [
        new Plugin<HighlightState>({
          key,
          state: {
            init: (_configuration, state) => compute(state.doc),
            apply: (transaction, previous) => compute(transaction.doc, previous),
          },
          props: {
            decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty,
            nodeViews: {
              paragraph: (initial, view) => {
                const dom = view.dom.ownerDocument.createElement("p");
                let current = initial;
                return {
                  dom,
                  contentDOM: dom,
                  update(next) {
                    if (next.type !== current.type) return false;
                    // Recreate only presentation DOM when filling empty code. This
                    // lets PM append tokens into a fresh paragraph rather than
                    // inserting each one before the empty view's trailing BR.
                    // jsdom's reference-child index otherwise makes that quadratic.
                    // PM still owns content rendering and selection; Yjs is untouched.
                    if (
                      current.content.size === 0 &&
                      next.content.size > 0 &&
                      settings.isCode() &&
                      settings.language() !== "plaintext" &&
                      !view.composing
                    )
                      return false;
                    current = next;
                    return true;
                  },
                };
              },
            },
          },
        }),
      ];
    },
  });
}
