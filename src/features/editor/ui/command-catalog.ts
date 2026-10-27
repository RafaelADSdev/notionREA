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

export const BLOCK_COMMANDS: readonly BlockCommand[] = [
  {
    id: "paragraph",
    type: "paragraph",
    label: "Texto",
    aliases: ["parágrafo", "paragraph", "text", "normal"],
    section: "Texto",
    description: "Um parágrafo para começar a escrever.",
  },
  {
    id: "h1",
    type: "heading",
    attributes: { level: 1 },
    label: "Título 1",
    aliases: ["h1", "heading 1", "heading1", "título grande"],
    section: "Texto",
    description: "Título principal de uma seção.",
  },
  {
    id: "h2",
    type: "heading",
    attributes: { level: 2 },
    label: "Título 2",
    aliases: ["h2", "heading 2", "heading2", "subtítulo"],
    section: "Texto",
    description: "Organize uma seção em partes.",
  },
  {
    id: "h3",
    type: "heading",
    attributes: { level: 3 },
    label: "Título 3",
    aliases: ["h3", "heading 3", "heading3", "título pequeno"],
    section: "Texto",
    description: "Um título menor para os detalhes.",
  },
  {
    id: "quote",
    type: "quote",
    label: "Citação",
    aliases: ["quote", "blockquote", "citar"],
    section: "Texto",
    description: "Dê destaque a um trecho citado.",
  },
  {
    id: "code",
    type: "code",
    attributes: { language: "plaintext" },
    label: "Código",
    aliases: ["code", "code block", "código fonte", "snippet"],
    section: "Texto",
    description: "Texto literal com linguagem selecionável.",
  },
  {
    id: "bulletListItem",
    type: "bulletListItem",
    label: "Lista com marcadores",
    aliases: ["bullet", "bullet list", "unordered", "lista não ordenada", "marcadores"],
    section: "Listas",
    description: "Reúna itens sem uma ordem definida.",
  },
  {
    id: "numberListItem",
    type: "numberListItem",
    label: "Lista numerada",
    aliases: ["numbered", "numbered list", "ordered", "lista ordenada", "números"],
    section: "Listas",
    description: "Organize uma sequência de passos.",
  },
  {
    id: "task",
    type: "task",
    attributes: { checked: false },
    label: "Tarefa",
    aliases: ["task", "todo", "to-do", "checkbox", "checklist", "lista de tarefas"],
    section: "Listas",
    description: "Acompanhe um item com uma caixa de seleção.",
  },
  {
    id: "toggle",
    type: "toggle",
    label: "Recolhível",
    aliases: ["toggle", "details", "expandir", "recolher", "lista recolhível"],
    section: "Organização",
    description: "Mostre ou recolha os blocos de um grupo.",
  },
  {
    id: "callout",
    type: "callout",
    attributes: { tone: "indigo" },
    label: "Destaque",
    aliases: ["callout", "aviso", "nota", "chamada"],
    section: "Organização",
    description: "Chame atenção para uma ideia ou um aviso.",
  },
  {
    id: "divider",
    type: "divider",
    label: "Divisor",
    aliases: ["divider", "separator", "separador", "linha horizontal"],
    section: "Organização",
    description: "Separe duas partes da página.",
  },
  {
    id: "table",
    type: "table",
    attributes: { header: false },
    label: "Tabela simples",
    aliases: ["table", "tabela", "linhas", "células"],
    section: "Organização",
    description: "Organize texto em linhas e colunas.",
  },
  {
    id: "columns",
    type: "columns",
    label: "Colunas",
    aliases: ["columns", "column", "lado a lado", "duas colunas"],
    section: "Organização",
    description: "Distribua blocos em duas colunas.",
  },
  {
    id: "image",
    type: "image",
    attributes: { alt: "" },
    label: "Imagem",
    aliases: ["image", "photo", "picture", "foto", "fotografia"],
    section: "Mídia",
    description: "Envie uma imagem e descreva seu conteúdo.",
  },
  {
    id: "file",
    type: "file",
    label: "Arquivo",
    aliases: ["file", "attachment", "upload", "anexo", "documento"],
    section: "Mídia",
    description: "Anexe um arquivo para download autorizado.",
  },
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");
}

/** Exact labels lead; prefix and substring matches retain the catalog's order. */
export function filterBlockCommands(query: string): BlockCommand[] {
  const normalized = normalize(query);
  if (!normalized) return [...BLOCK_COMMANDS];
  return BLOCK_COMMANDS.map((command, index) => {
    const label = normalize(command.label);
    const terms = [label, normalize(command.id), ...command.aliases.map(normalize)];
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
