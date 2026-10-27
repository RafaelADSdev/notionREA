# ADR-024 — Composição estável do editor
Status: detalhamento reversível da ADR-012; data: 26/10/2026.
Decisão: tipos/atributos/parentesco ficam no modelo Yjs; cada bloco textual mantém um fragmento com parágrafo inline, marks e quebras permitidas.
Transformar altera o tipo/atributos sem recriar o texto; títulos, listas e código recebem apresentação/semântica conforme o tipo externo.
Estruturas: linhas/células de tabela e grupos/colunas são blocos identificados; seus textos usam o mesmo fragmento estável.
Referências: menção armazena só ID de página; rótulo depende de consulta autorizada atual, sem título privado embutido no documento.
Histórico: uma página possui o undo manager; seleção entre fragmentos, colagem e IME pertencem ao adaptador e exigem regressões reais.
Alternativa recusada: trocar o nó XML do texto a cada transformação ou movimento, arriscando excluir contribuições concorrentes.
Fontes: [schema TipTap](https://tiptap.dev/docs/editor/core-concepts/schema) e [updates Yjs](https://docs.yjs.dev/api/document-updates); prova pequena não substitui o gate completo M3.
