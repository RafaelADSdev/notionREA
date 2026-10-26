# ADR-018 — Testes separados dos dados pessoais locais
Status: decisão operacional reversível; data: 26/10/2026.
Contexto: após o M1, o usuário criou conta e workspace reais na stack local; testes não podem descartá-los.
Decisão: preservar projeto bloco nas portas 54321–54324/app 3000; criar bloco-test em 55321–55324/app 3001 para fixtures e resets.
Fonte: configuração/migrations/testes canônicos versionados; preparação copia para workdir ignorado, sem segunda fonte editável de schema.
Segredos: ambiente de teste separado e ignorado, captura de status sem imprimir valores, recusa de destinos fora das portas/projeto de teste.
Gates: banco vazio, tipos/RLS/integração/E2E rodam no isolado; app pessoal recebe apenas migrations aditivas previamente verificadas.
Alternativas recusadas: reset da stack pessoal, apagar/recriar a conta do usuário ou apontar E2E ao navegador autenticado do usuário.
Consequência: mais containers locais; iniciar somente serviços necessários, manter a interface pessoal disponível e nunca remover volumes alheios.
