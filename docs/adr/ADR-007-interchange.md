# ADR-007 — Intercâmbio seguro e perdas explícitas
Status: proposta para Checkpoint 1; data: 26/10/2026.
Contexto: Markdown/CSV não preservam toda a semântica do editor ou da plataforma de referência.
Decisão proposta: ZIP com Markdown/CSV/anexos, convenções próprias documentadas e relatório por recurso não representável.
Import: somente upload do usuário; validar inventário, mostrar prévia/mapear tipos e confirmar antes de persistir em lotes idempotentes.
Segurança: bloquear traversal/symlinks/colisões/bombas ZIP, sanitizar HTML e neutralizar fórmulas CSV; nenhuma busca remota automática.
Identidade: IDs novos e remapeamento de links, sem clonar permissões, pessoas ou metadados de sistema da origem.
Alternativa: import automático pela API/conta ou promessa de round-trip completo é excluída; ambiguidades ficam visíveis para resolução.
Contrato, limites e corpus: [intercâmbio](../spec/interchange-quality.md), [formato público](https://www.notion.com/help/export-your-content).
