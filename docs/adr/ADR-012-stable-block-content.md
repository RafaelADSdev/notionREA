# ADR-012 — Conteúdo estável por bloco, separado da posição

Status: aceita pelo usuário após falha do gate M1.3, em 26/10/2026; demais provas continuam obrigatórias.
Evidência: binding de página única TipTap/Yjs perdeu texto remoto em quatro casos de movimento concorrente; convergência isolada não atende o contrato.
Decisão: manter um Y.Doc canônico por página, com identidades/posições de blocos separadas de fragmentos TipTap estáveis por bloco; mover altera apenas placement.
Benefício esperado: ordem/parentesco não substituem a identidade CRDT do texto; referências e comentários continuam ligados ao mesmo bloco.
Custo: adaptador próprio para seleção entre blocos, clipboard, listas, tabelas/colunas, IME e undo; hierarquia/ciclos e exclusão concorrente continuam gates obrigatórios.
Alternativa: árvore/blocos canônicos normalizados no Postgres com Yjs por bloco; simplifica transações estruturais, mas muda a escolha de armazenamento e multiplica entidades.
Prova: cenários de estrutura, histórico, duas views de navegador e persistência são gates do M1; resultados medidos e limites ficam no PLAN, sem equivaler ao editor completo.
Condição: não consolidar migrations de conteúdo nem anunciar M1 concluído até aprovar a adaptação e passar a prova completa; não relaxar os testes que falharam.
Detalhes e reprodução: [prova de movimentos](../spec/collaboration-spike.md); a proposta complementa/reabre ADR-001/002, sem trocar stack ou adicionar servidor WebSocket.
