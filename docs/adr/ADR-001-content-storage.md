# ADR-001 — Armazenamento do conteúdo

Status: aceita no Checkpoint 1; data: 26/10/2026.
Contexto: edição simultânea sem perda, editor de blocos, pesquisa/backlinks e databases tipadas.
Alternativa A: blocos canônicos normalizados no Postgres simplificam árvore/SQL, mas exigem CRDT/OT adicional para texto concorrente.
Alternativa B: Yjs canônico por página facilita merge de texto; exige log, compactação, validação e projeções; JSON puro com sobrescrita não atende.
Decisão: B, com Yjs binário durável; JSON/texto/backlinks são derivados; páginas, propriedades, valores e views permanecem relacionais.
Consequências: RLS por página/workspace; projeção e revisão atômicas; mesmo documento nunca tem duas fontes editáveis.
Gate: falha inicial reabriu a decisão; adaptação [ADR-012](ADR-012-stable-block-content.md) aprovada separa conteúdo/posição, preservando a prova obrigatória no M1.
Avaliação e fontes: [arquitetura](../spec/architecture.md), [Yjs](https://docs.yjs.dev/api/document-updates).
