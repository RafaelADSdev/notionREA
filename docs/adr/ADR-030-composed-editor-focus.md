# ADR-030 — Foco e entrada no editor composto
Status: decisão reversível de interação do M3; data: 26/10/2026.
Decisão: comandos estruturais confirmam o DOM antes de focar a nova view; foco existente é síncrono e não recebe replay tardio da posição do caret.
Seleção: atalhos de formatação/link sincronizam o intervalo nativo por posições públicas do ProseMirror, sem ler HTML como conteúdo canônico.
Binding: transação neutra antes de disponibilizar a view conclui inicialização pública do y-tiptap, sem gerar atualização Yjs ou entrada de undo.
Popups: textbox mantém foco e aponta para listbox/opção ativa por aria-controls/aria-activedescendant, preservando escrita e seleção.
Histórico: recortes e colagens usam schema/preflight e uma ação; HTML é dado não confiável, nunca conteúdo executável.
Saída: logout aguarda flush de todas as sessões da identidade; rascunho restante exige confirmação explícita de descarte, com cancelamento preservando edição.
Fontes: [ARIA para foco em textbox/listbox](https://www.w3.org/TR/wai-aria-1.2/#aria-activedescendant) e APIs/tipos públicos dos pacotes fixados; regressões reais de teclado/composição são gates.
