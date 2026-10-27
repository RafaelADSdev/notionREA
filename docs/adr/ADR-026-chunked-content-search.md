# ADR-026 — Índice de corpo em conjuntos delimitados
Status: decisão reversível da projeção de busca; data: 26/10/2026.
Contexto: um tsvector Postgres tem limite de 1 MiB; uma página canônica válida de vários MiB pode superar um vetor agregado.
Decisão: derivar lexemas pt/en/com e sem acentos, deduplicar e guardar no máximo cem por chunk autorizado; não truncar o texto canônico.
Consulta: reunir acertos por termo entre título e todos os chunks, exigir cobertura de uma forma linguística completa e deduplicar por página.
Ranking: termo no título vale quatro, no corpo um; desempate/cursor por identidade e autorização atual por workspace/página.
Atomicidade: revisão, snapshot, projeção, chunks e backlinks são confirmados juntos; retry de recibo antigo não regrava o índice atual.
Alternativa recusada: rebaixar o limite de conteúdo, truncar corpo ou exigir que todos os termos estejam dentro de um mesmo chunk.
Fonte: [limites FTS Postgres](https://www.postgresql.org/docs/current/textsearch-limitations.html); corpus de alta diversidade e orçamento de consulta fazem parte dos gates do M3.
