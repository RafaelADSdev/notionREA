# ADR-001 — Armazenamento do conteúdo
Status: proposta para Checkpoint 1; data: 26/10/2026.
Contexto: edição simultânea sem perda, editor de blocos, pesquisa/backlinks e databases tipadas.
Alternativa A: blocos canônicos normalizados no Postgres simplificam árvore/SQL, mas exigem CRDT/OT adicional para texto concorrente.
Alternativa B: Yjs canônico por página facilita merge de texto; exige log, compactação, validação e projeções; JSON puro com sobrescrita não atende.
Decisão proposta: B, com Yjs binário durável; JSON/texto/backlinks são derivados; páginas, propriedades, valores e views permanecem relacionais.
Consequências: RLS por página/workspace; projeção e revisão atômicas; mesmo documento nunca tem duas fontes editáveis.
Gate: provar mover/editar/apagar concorrentes no M1; falha reabre a decisão antes de consolidar schema, sem adiar a garantia para M5.
Avaliação e fontes: [arquitetura](../spec/architecture.md), [Yjs](https://docs.yjs.dev/api/document-updates).
