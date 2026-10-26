# ADR-009 — Runtime, limites e ciclo de vida
Status: proposta para Checkpoint 1; data: 26/10/2026.
Contexto: Windows local, produção serverless, conteúdo/upload grandes e necessidade de retomada sem infraestrutura externa.
Decisão proposta: Node 24 LTS; versões compatíveis exatas e lockfile no M1; Supabase CLI local como devDependency, Docker para stack local; texto UTF-8/LF por .gitattributes.
Execução: validação Yjs no Node Vercel; funções curtas, jobs em lotes persistidos no Supabase; upload/download grandes via Storage autorizado.
Limites: propostas mensuráveis em qualidade; paginação padrão 50/máximo 100; negar excesso de payload com erro recuperável, sem truncar conteúdo.
Retenção: lixeira sem purge automático no MVP; limpeza apenas de uploads staging órfãos com carência documentada; backup/restauração antes de produção.
Consequências: credenciais externas de Google/e-mail são dependências reais; teste simulado não comprova provedor; quotas/limites do plano são verificados no deploy.
Gates e limites: [qualidade](../spec/interchange-quality.md); nenhum build/teste de aplicação é declarado verde antes de existir aplicação.
