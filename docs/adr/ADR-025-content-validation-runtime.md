# ADR-025 — Validação binária delimitada
Status: detalhamento de segurança da ADR-009; data: 26/10/2026.
Decisão: validar/mesclar Yjs em worker Node 24 empacotado por esbuild, sem ambiente de credenciais, SDK ou acesso ao banco.
Recursos: update até 256 KiB, estado/projeção até 8 MiB, heap antigo 96 MiB/novo 16 MiB/stack 4 MiB e prazo de 3 s; bytes têm limites próprios.
Concorrência: duas gravações ativas e oito aguardando antes da leitura do head, além do limite de dois workers; quota durável de 240 tentativas/minuto por ator/workspace antes da decodificação.
Integridade: rejeitar causalidade pendente, roots/campos desconhecidos, referências inválidas, HTML/CSS livre e versões incompatíveis; commit revalida ACL/CAS/referências.
Binding: metadados de posição públicos do y-tiptap têm schema estrito, 10 mil registros, 1 MiB ativo e intervalos delimitados; nunca viram corpo público.
Alternativa recusada: decodificar bytes sem limite no processo HTTP ou aprovar operações ainda não integradas que possam ativar payload oculto depois.
Fontes: [Node workers](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html), [esbuild](https://esbuild.github.io/api/#bundle) e tipos/fontes dos pacotes públicos fixados; gates medem o artefato real.
