# Prova de movimentos concorrentes — M1.3

Experimento original do Bloco, de 26/10/2026. Nenhum dado ou código da instalação de referência foi usado. Stack efetivamente instalada: TipTap 3.32.0, y-tiptap 3.0.10, Yjs 13.6.33, Vitest 5.0.5 e jsdom 27.4.0.

## Cenário reproduzível

Dois editores são criados a partir do mesmo documento já inicializado e sincronizado. O primeiro move um bloco por transação ProseMirror de exclusão e reinserção, preservando seu ID. O segundo insere o sufixo fictício “-remote” no texto desse bloco, sem receber o movimento. Depois as duas réplicas trocam seus estados completos e recebem os updates repetidamente. A extensão oficial UniqueID está ativa e ignora transações remotas, conforme orientação pública. O teste usa o binding real, sem mock do CRDT.

Executar `pnpm test:spike`. O resultado esperado pelo requisito é convergência, texto “Beta-remote” preservado e identidade única. O resultado observado no primeiro ensaio foi convergência, porém texto “Beta” no bloco movido. Foram afetados parágrafo, conteúdo de toggle, tabela e colunas. Edição concorrente de texto sem mover passou; a verificação simples de dois movimentos da mesma identidade também passou. Não generalizar esses dois controles a todos os conflitos estruturais.

As asserções de preservação foram mantidas ao adaptar o cenário para fragmentos estáveis; o adaptador ingênuo foi substituído. Não há skip, inversão de expectativa ou aceite da perda. Resultados do ensaio final ficam exclusivamente no PLAN.

## Causa delimitada

O movimento usado pelo adaptador ingênuo substitui a estrutura compartilhada que carregava o texto; uma edição concorrente ainda aponta para a estrutura anterior. Preservar um atributo de ID de produto não preserva automaticamente a identidade dos tipos compartilhados do Yjs. A prova refuta esse desenho específico de movimento; não prova que toda integração TipTap/Yjs seja inviável.

DOM simulado serve aqui para executar modelo/transações reais. Não comprova interação por teclado, seleção real, acessibilidade ou drag em navegador. Uma falha de preservação no modelo já impede aprovar a arquitetura; os testes E2E continuam obrigatórios quando houver editor de produto.

## Adaptação aprovada

Manter um documento Yjs por página, mas guardar placement e conteúdo em identidades independentes. Blocos recebem IDs canônicos; posição/pai vivem no mapa estrutural; cada bloco tem um fragmento de conteúdo estável, vinculado ao TipTap. Mover deixa esse fragmento intacto. A API durável, Postgres, validação, CAS, projeções e Supabase Realtime continuam os mesmos conceitos da arquitetura aprovada.

O protótipo `tests/spikes/stable-block-identity.test.ts` demonstra somente: mover um bloco e editar texto em paralelo preserva o texto após sincronização/reload; dois movimentos da mesma identidade convergem para um único placement. Ambos passaram no primeiro ensaio. Isso não aprova aninhamento, ciclos, exclusão/edição, seleção entre fragmentos, clipboard, IME, tabelas, undo, desempenho ou o transporte de produção.

A alternativa de blocos normalizados no Postgres com Yjs por bloco continua viável para avaliação. A recomendação é a adaptação da ADR-012, que preserva o contêiner canônico por página e a stack solicitada, aceitando o custo explícito de um adaptador de edição mais amplo.

## Provas reproduzíveis e limites

Usuário aprovou expressamente a ADR-012. `pnpm test:spike` exercita parágrafo e descendentes de toggle/tabela/colunas, movimentos concorrentes, duplicação de updates, remoção/restauração, undo e desmontagem de outra view. `tests/unit/stable-page.test.ts` cobre identidades, ciclos locais e detectados após merge, pais ausentes, limites e ordem ordinal.

`pnpm test:integration` utiliza duas conexões escritoras e um leitor Postgres reais: revisão CAS concorrente com merge e retry, ACK perdido, recibo após compactação, catch-up sem evento, bootstrap MVCC com compactação/commit simultâneos e revogação na mesma sessão. Projeções são derivadas pelo ensaio do estado validado, não por payload arbitrário do navegador. A RPC interna confia nesse serviço; o endpoint público de validação do M3 ainda não existe.

`pnpm test:e2e` inclui duas páginas de navegador com o binding TipTap real. A fixture isolada `/test-editor` exige flag do servidor e origem de aplicação loopback; desabilitada por padrão. BroadcastChannel troca estados entre essas duas views para controlar interrupção/reconexão, sem representar o transporte de produção. Verifica texto, caret nativo, estrutura, undo local e texto preservado ao ocultar/restaurar; o fragmento permanece montado na fixture. Não demonstra seleção entre blocos, clipboard, IME ou editor composto, exigidos no M3.

Um ensaio adicional abre canal Supabase Realtime privado e lê conteúdo com conta sintética autenticada, revoga a ACL mantendo o canal aberto e comprova que novas leituras de snapshot/log são negadas. Autorização do socket pode estar em cache; eventos contêm somente revisão e recibo UUID do transporte. O teste aguarda prontidão explícita da replicação conforme [ADR-017](../adr/ADR-017-realtime-readiness.md); SUBSCRIBED isolado não oferece essa garantia. Presença, épocas, cursores remotos e provider completo são M5. Resultado verdadeiro de cada comando fica no PLAN.
