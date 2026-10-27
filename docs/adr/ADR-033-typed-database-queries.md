# ADR-033 — Valores e consultas das bases
Status: decisão reversível do M4; data: 26/10/2026.
Contexto: propriedades dinâmicas precisam manter precisão, autorização e paginação nas cinco views.
Decisão: schema/valores/views relacionais, título canônico na página e revisão independente por célula; números são strings decimais exatas.
Consulta: operadores por whitelist, parâmetros vinculados e escopo visível materializado uma vez; até cinquenta registros e 1 MiB por resposta.
Ordenação: Unicode com collation C, números por numeric, select pela ordem das opções, conjuntos por IDs; nulos por último e desempate por ID.
Cursores: chaves tipadas vinculadas ao hash SQL da consulta, view e revisão da base; mudança concorrente exige recarregar.
Referências: títulos autorizados em lotes de cem, membros paginados sem e-mails; campos ocultos na view não concedem ou removem acesso.
Alternativas: filtrar toda a base no cliente, converter decimais para float e autorizar cada registro com consulta separada foram recusadas.
