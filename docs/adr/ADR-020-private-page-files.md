# ADR-020 — Arquivos privados em preparação e finalização
Status: decisão reversível dentro da ADR-009; data: 26/10/2026.
Contexto: capas de até 25 MiB excedem payloads do runtime; revogação precisa valer também para imagens.
Decisão: metadado autorizado cria path opaco em bucket privado; browser recebe somente assinatura de upload sem upsert, nunca chave de sessão/serviço em JavaScript.
Finalização: servidor verifica sessão, tamanho, MIME e assinatura binária; RPC interna reautoriza ator e compara revisão antes de vincular capa.
Leitura: endpoint autenticado revalida RLS e devolve bytes seguros com no-store/nosniff; política permite GET autenticado e recusa assinatura de download/listagem.
Limites: PNG/JPEG/WebP/GIF, até 25 MiB; quota por ator, staging de uma hora, remoção da capa apenas desvincula arquivo.
Retenção: token de upload pode durar duas horas, mas envio tardio não finaliza nem fica legível; limpeza de órfãos exige carência de 24h no M6.
Alternativa recusada: bucket público, URL assinada de leitura duradoura ou HTML/SVG executável inline; sem fetch de URL arbitrária do usuário.
