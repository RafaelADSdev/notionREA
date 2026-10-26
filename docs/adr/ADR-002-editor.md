# ADR-002 — Motor do editor

Status: aceita no Checkpoint 1; data: 26/10/2026.
Contexto: blocos e colunas extensíveis, identidade própria, TypeScript e colaboração sem servidor WebSocket próprio.
Comparação: TipTap/ProseMirror fornece extensibilidade/Yjs; BlockNote acelera blocos, mas colunas XL envolvem GPL/comercial; Lexical exige mais composição e documenta y-websocket como provider suportado.
Decisão: TipTap/ProseMirror com schema/UI próprios e Yjs desde a prova M1; fragmentos estáveis da [ADR-012](ADR-012-stable-block-content.md), sem serviço comercial obrigatório.
Integração: dnd-kit emite operações do modelo com identidades estáveis; colunas, slash, comentários, foco e sanitização pertencem ao Bloco.
Consequências: não ativar histórico comum junto ao colaborativo; auditar licenças de cada extensão/versão e comprovar acessibilidade em navegador.
Alternativas: BlockNote e Lexical continuam opções se a prova falhar; nenhuma troca silenciosa de dependência.
Avaliação e fontes oficiais: [arquitetura](../spec/architecture.md), [colaboração TipTap](https://tiptap.dev/docs/editor/extensions/functionality/collaboration), [proveniência/licenças](../dependencies.md).
