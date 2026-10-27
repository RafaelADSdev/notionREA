# ADR-032 — Concorrência delimitada dos testes
Status: ajuste operacional reversível; data: 26/10/2026.
Problema: a suíte ampliada iniciou dezenas de ambientes jsdom concorrentes e um teste de transporte delimitado excedeu seu prazo sob contenção.
Decisão: limitar a quatro workers da suíte unitária, mantendo isolamento por arquivo e todos os casos, fixtures e timeouts existentes.
Escopo: integrações continuam serializadas; Playwright mantém um worker e servidor isolado, sem reutilizar o preview pessoal.
Critério: corrigir falhas reais; nunca reduzir corpus ou elevar timeout apenas para obter resultado verde.
Prioridade posterior do usuário: durante implementação, executar provas focadas das alterações e evitar repetir gates amplos sem mudança correspondente.
