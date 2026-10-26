# ADR-008 — Pesquisa e localização

Status: aceita no Checkpoint 1; data: 26/10/2026.
Contexto: pesquisa Postgres, pt-BR/en, títulos e corpos ricos sem vazamento entre pessoas/workspaces.
Decisão: FTS com vetores português/inglês e acentos normalizados; título com peso maior, desempate de ID e cursor.
Projeção: corpo indexado na mesma revisão aceita do documento; título já pesquisável no M2; backlinks derivados e autorizados nos dois lados.
Localização: pt-BR padrão, en no M6; idioma não altera IDs/valores; datas civis e instantes são tipos distintos e formatos pertencem à UI.
Alternativas: motor externo viola infra; baixar o workspace para buscar viola paginação; indexar HTML bruto viola segurança.
Consequências: normalização idêntica na query/índice, testes em ambos os idiomas e exclusão de lixeira/ACL também em snippets/contagens.
Fonte e desenho: [FTS oficial](https://www.postgresql.org/docs/current/textsearch.html), [arquitetura](../spec/architecture.md).
