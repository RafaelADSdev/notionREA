# ADR-042 — Transferência pública por partes autorizadas
Status: decisão reversível do M6; data: 26/10/2026.
Decisão: projeções pequenas seguem JSON direto; resposta acima de 1 MiB usa manifesto SHA-256 e partes UTF-8 de 256 KiB, codificadas em base64.
Cada leitura revalida publicação atual, arquivos e destinos; mudança de conteúdo/rótulo/token invalida o hash com conflito, revogação nega a próxima parte.
Referências repetidas usam dicionário autorizado, sem nomes privados; referência indisponível é nó semântico, nunca uma substituição em texto autoral.
Capacidade: preservam-se os 8 MiB canônicos; até 10.000 títulos de 500 caracteres escapados, IDs e tokens somam menos de 40 MiB com a fonte.
Orçamento derivado: 48 MiB sanitizados; excesso devolve erro explícito, sem truncamento. Database continua com paginação de 50 registros e resposta de até 1 MiB.
Cliente valida índices, comprimento, UTF-8, schema e hash completo antes de exibir; HTML/RSC inicial contém somente metadados e manifesto das páginas grandes.
Consequência: leituras não usam cache persistente; dados já recebidos não podem ser retirados da memória do visitante. Nova leitura exige autorização atual.
