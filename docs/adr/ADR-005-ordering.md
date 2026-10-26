# ADR-005 — Hierarquia e ordenação
Status: proposta para Checkpoint 1; data: 26/10/2026.
Contexto: páginas profundas, drag, concorrência e ordenação sem renumerar todos os irmãos a cada operação.
Decisão proposta: árvore relacional sem teto de profundidade; chaves fracionárias textuais com comparação ordinal e desempate estável.
Operação: servidor verifica ciclos/workspace/permissões, serializa o escopo do pai, calcula chave e aplica transação com revisão.
Manutenção: rebalanceamento explícito transacional quando a chave cresce; índices por workspace/pai/posição e paginação por cursor.
Alternativas: índices inteiros densos causam reescritas; floats perdem precisão; reordenação somente no DOM não persiste intenção.
Consequências: unidades de texto usam transação do documento, não a árvore SQL; sort de view ativa impede reordenação manual sem efeito.
Gate: testes gerativos de inserir/mover, irmãos concorrentes, raiz nula, ciclos simultâneos e cadeia profunda; [contrato](../spec/foundation-pages.md).
