"use client";
import { useCallback } from "react";
import { useLocale } from "@/lib/i18n/client";
import type { InterchangeJobState } from "../model/contracts";
export function useInterchangeText() {
  const locale = useLocale();
  return useCallback((pt: string, en: string) => (locale === "en" ? en : pt), [locale]);
}
export const phases: Record<InterchangeJobState, [string, string]> = {
  uploading: ["Aguardando envio", "Awaiting upload"],
  scanning: ["Validando arquivo", "Validating archive"],
  preview: ["Prévia para revisão", "Preview for review"],
  running: ["Processando lotes", "Processing batches"],
  complete: ["Concluído", "Completed"],
  cancelled: ["Cancelado", "Cancelled"],
  error: ["Precisa de atenção", "Needs attention"],
};
export const columnTypes = {
  title: ["Título", "Title"],
  text: ["Texto", "Text"],
  number: ["Número", "Number"],
  select: ["Seleção", "Select"],
  multiSelect: ["Seleção múltipla", "Multi-select"],
  date: ["Data", "Date"],
  checkbox: ["Checkbox", "Checkbox"],
  url: ["URL", "URL"],
  person: ["Pessoa", "Person"],
  relation: ["Relação", "Relation"],
  createdTime: ["Criado em (texto informativo)", "Created time (informational text)"],
  editedTime: ["Editado em (texto informativo)", "Edited time (informational text)"],
} satisfies Record<string, [string, string]>;
const warnings: Record<string, [string, string]> = {
  "report-paths-in-item-inventory": [
    "Os caminhos detalhados deste aviso estão no inventário de itens.",
    "Detailed paths for this notice are listed in the item inventory.",
  ],
  "additional-reports-in-item-inventory": [
    "Consulte o inventário de itens para ver os avisos adicionais.",
    "See the item inventory for additional notices.",
  ],
  "unresolved-local-link": [
    "Link local sem destino correspondente.",
    "A local link has no matching destination.",
  ],
  "html-preserved-as-text": ["HTML preservado como texto seguro.", "HTML preserved as safe text."],
  "inline-image-separated": [
    "Imagem inline representada separadamente.",
    "An inline image is represented separately.",
  ],
  "code-language-normalized": [
    "Linguagem de código normalizada para texto simples.",
    "Code language normalized to plain text.",
  ],
  "remote-image-kept-as-link": [
    "Imagem remota mantida como link; nenhum download externo.",
    "Remote image retained as a link; no external download.",
  ],
  "inline-style-not-representable": [
    "Parte da formatação inline não existe em Markdown.",
    "Some inline formatting cannot be represented in Markdown.",
  ],
  "image-layout-not-representable": [
    "O tamanho visual da imagem não é preservado em Markdown.",
    "Image layout size is not preserved in Markdown.",
  ],
  "callout-toggle-convention": [
    "Callouts e toggles usam uma convenção textual.",
    "Callouts and toggles use a text convention.",
  ],
  "columns-linearized": ["Colunas convertidas para ordem de leitura.", "Columns converted to reading order."],
  "database-view-not-representable": [
    "A configuração visual da base não é representada no arquivo.",
    "Database view configuration is not represented in the archive.",
  ],
};
export function warningDescription(code: string, text: (pt: string, en: string) => string) {
  const value = warnings[code];
  return value ? text(...value) : text(`Aviso: ${code}`, `Notice: ${code}`);
}
