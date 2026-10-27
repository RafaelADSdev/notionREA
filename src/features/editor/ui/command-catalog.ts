import { createTranslator, DEFAULT_LOCALE, type Translator } from "@/lib/i18n/core";
import type { BlockAttributes, BlockType } from "../model/block-schema";

export type BlockCommand = {
  readonly id: string;
  readonly type: BlockType;
  readonly attributes?: BlockAttributes;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly section: string;
  readonly description: string;
};

export function blockCommands(t: Translator = createTranslator(DEFAULT_LOCALE)): readonly BlockCommand[] {
  return [
    {
      id: "paragraph",
      type: "paragraph",
      label: t("editor.text"),
      aliases: ["parágrafo", "paragraph", "text", "normal"],
      section: t("editor.text"),
      description: t("editor.paragraphDescription"),
    },
    {
      id: "h1",
      type: "heading",
      attributes: { level: 1 },
      label: t("editor.headingOne"),
      aliases: ["h1", "heading 1", "heading1", "título grande"],
      section: t("editor.text"),
      description: t("editor.headingOneDescription"),
    },
    {
      id: "h2",
      type: "heading",
      attributes: { level: 2 },
      label: t("editor.headingTwo"),
      aliases: ["h2", "heading 2", "heading2", "subtítulo"],
      section: t("editor.text"),
      description: t("editor.headingTwoDescription"),
    },
    {
      id: "h3",
      type: "heading",
      attributes: { level: 3 },
      label: t("editor.headingThree"),
      aliases: ["h3", "heading 3", "heading3", "título pequeno"],
      section: t("editor.text"),
      description: t("editor.headingThreeDescription"),
    },
    {
      id: "quote",
      type: "quote",
      label: t("editor.quote"),
      aliases: ["quote", "blockquote", "citar"],
      section: t("editor.text"),
      description: t("editor.quoteDescription"),
    },
    {
      id: "code",
      type: "code",
      attributes: { language: "plaintext" },
      label: t("editor.code"),
      aliases: ["code", "code block", "código fonte", "snippet"],
      section: t("editor.text"),
      description: t("editor.codeDescription"),
    },
    {
      id: "bulletListItem",
      type: "bulletListItem",
      label: t("editor.bulletList"),
      aliases: ["bullet", "bullet list", "unordered", "lista não ordenada", "marcadores"],
      section: t("editor.lists"),
      description: t("editor.bulletListDescription"),
    },
    {
      id: "numberListItem",
      type: "numberListItem",
      label: t("editor.numberedList"),
      aliases: ["numbered", "numbered list", "ordered", "lista ordenada", "números"],
      section: t("editor.lists"),
      description: t("editor.numberedListDescription"),
    },
    {
      id: "task",
      type: "task",
      attributes: { checked: false },
      label: t("editor.task"),
      aliases: ["task", "todo", "to-do", "checkbox", "checklist", "lista de tarefas"],
      section: t("editor.lists"),
      description: t("editor.taskDescription"),
    },
    {
      id: "toggle",
      type: "toggle",
      label: t("editor.toggle"),
      aliases: ["toggle", "details", "expandir", "recolher", "lista recolhível"],
      section: t("navigation.organization"),
      description: t("editor.toggleDescription"),
    },
    {
      id: "callout",
      type: "callout",
      attributes: { tone: "indigo" },
      label: t("editor.callout"),
      aliases: ["callout", "aviso", "nota", "chamada"],
      section: t("navigation.organization"),
      description: t("editor.calloutDescription"),
    },
    {
      id: "divider",
      type: "divider",
      label: t("editor.divider"),
      aliases: ["divider", "separator", "separador", "linha horizontal"],
      section: t("navigation.organization"),
      description: t("editor.dividerDescription"),
    },
    {
      id: "table",
      type: "table",
      attributes: { header: false },
      label: t("editor.simpleTable"),
      aliases: ["table", "tabela", "linhas", "células"],
      section: t("navigation.organization"),
      description: t("editor.tableDescription"),
    },
    {
      id: "columns",
      type: "columns",
      label: t("editor.columns"),
      aliases: ["columns", "column", "lado a lado", "duas colunas"],
      section: t("navigation.organization"),
      description: t("editor.columnsDescription"),
    },
    {
      id: "image",
      type: "image",
      attributes: { alt: "" },
      label: t("editor.image"),
      aliases: ["image", "photo", "picture", "foto", "fotografia"],
      section: t("editor.media"),
      description: t("editor.imageDescription"),
    },
    {
      id: "file",
      type: "file",
      label: t("editor.file"),
      aliases: ["file", "attachment", "upload", "anexo", "documento"],
      section: t("editor.media"),
      description: t("editor.fileDescription"),
    },
    {
      id: "database",
      type: "databaseRef",
      label: t("editor.inlineDatabase"),
      aliases: ["database", "base", "banco de dados"],
      section: t("editor.data"),
      description: t("editor.databaseDescription"),
    },
  ];
}
export const BLOCK_COMMANDS = blockCommands();

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");
}

/** Exact labels lead; prefix and substring matches retain the catalog's order. */
export function filterBlockCommands(
  query: string,
  t: Translator = createTranslator(DEFAULT_LOCALE),
): BlockCommand[] {
  const commands = blockCommands(t);
  const normalized = normalize(query);
  if (!normalized) return [...commands];
  return commands
    .map((command, index) => {
      const label = normalize(command.label);
      const terms = [
        label,
        normalize(BLOCK_COMMANDS[index]?.label ?? ""),
        normalize(command.id),
        ...command.aliases.map(normalize),
      ];
      const rank =
        label === normalized
          ? 0
          : terms.some((term) => term.startsWith(normalized))
            ? 1
            : terms.some((term) => term.includes(normalized))
              ? 2
              : 3;
      return { command, index, rank };
    })
    .filter(({ rank }) => rank < 3)
    .sort((first, second) => first.rank - second.rank || first.index - second.index)
    .map(({ command }) => command);
}
