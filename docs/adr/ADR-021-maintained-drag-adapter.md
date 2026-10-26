# ADR-021 — Adaptador dnd-kit compatível com React atual
Status: decisão reversível dentro da stack solicitada; data: 26/10/2026.
Contexto: pacotes legacy core/sortable usam namespace JSX global incompatível com a checagem integral de React 19.
Decisão: dnd-kit React 0.5.1 com suporte declarado a React 18/19, provider e sortable atuais; não criar namespace JSX global nem desativar checagem de bibliotecas.
Movimento: UI traduz índices/identidades para intenção de irmão seguinte; servidor calcula a chave fracionária sob lock e revisão, mantendo fonte canônica no banco.
Acessibilidade: handle por teclado e ação Mover oferecem caminhos completos; cancelamento não persiste; erro devolve o estado do servidor.
Consequência: versões exatas e regressões de teclado/ponteiro obrigatórias; animação otimista da biblioteca não substitui confirmação durável.
Fontes: [migração oficial](https://dndkit.com/react/guides/migration/), [sortable atual](https://dndkit.com/react/hooks/use-sortable/), licença MIT do pacote público.
