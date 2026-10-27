# Especificação funcional do Bloco

Contrato aprovado no Checkpoint 1. Origem: requisitos da missão e decisões originais D, informadas por documentação pública. Não é uma reconstrução de código do aplicativo de referência. A análise sanitizada fica em `docs/rea/`; implementação consulta este contrato e as ADRs aprovadas. Estado de execução e limites comprovados ficam exclusivamente no [PLAN](../PLAN.md).

## Objetivo e público

Aplicação web para pessoas e pequenas equipes criarem documentos e organizarem registros em um workspace comum. Sucesso: escrever, organizar, consultar e colaborar no conjunto de capacidades abaixo, com isolamento verificável, identidade original e dados exportáveis. Nome de trabalho: Bloco; nome definitivo não bloqueia o MVP.

## Mapa de capacidades e contratos

| ID estável | Responsabilidade | Dependências | Contrato |
| --- | --- | --- | --- |
| foundation | Runtime, identidade, sessão, workspace, membros, shell e CI | — | [Fundação e páginas](foundation-pages.md) |
| pages | Identidade de página, árvore, ordem, lixeira e descoberta | foundation | [Fundação e páginas](foundation-pages.md) |
| editor | Documento, blocos, marks, arquivos e referências | pages | [Editor](editor.md) |
| databases | Schema, valores, registros, views e templates | pages, editor | [Databases](databases.md) |
| collaboration | Acesso compartilhado, presença, comentários, publicação e simultaneidade | foundation, pages, editor, databases | [Colaboração e segurança](collaboration-security.md) |
| interchange | Importação, exportação, idiomas, escala e lançamento | capacidades anteriores | [Intercâmbio e qualidade](interchange-quality.md) |

Ordem de entrega: M1 → M2 → M3 → M4 → M5 → M6. Os contratos de autorização e sincronização devem orientar M1/M3 antes da liberação da colaboração no M5. A prova de risco M1 não equivale a antecipar todo o M5. Progresso e tarefas vivem somente em [PLAN](../PLAN.md).

## Fontes da arquitetura

[Arquitetura e avaliações](architecture.md) detalha decisões propostas. ADR-001 a ADR-010 registram escolhas e consequências em 5–10 linhas cada. Não incluir SDK, dependência ou infraestrutura paga por conveniência sem documentar custo/licença. Apenas Vercel e Supabase na infraestrutura de produção.

## Convenções e limites

- Interface/documentação pt-BR; en no M6. Código, nomes técnicos e commits em inglês; TypeScript strict, sem suppressions para esconder erros.
- Entradas e saídas públicas validadas; erros distinguem validação, falta de acesso, conflito e indisponibilidade. Recurso inexistente e inacessível têm resposta indistinguível a quem não tem acesso.
- Sempre: atualizar contratos quando mudarem, testar comportamento e RLS, preservar conteúdo e autoria, registrar decisões reversíveis. Perguntar: bloqueios e mudanças caras de reverter. Nunca: copiar material analisado, segredos no cliente/repo, contornar proteção ou reduzir o DoD.
- Arquitetura planejada: rotas em `src/app/`; domínios em `src/features/`; UI comum em `src/components/`; infraestrutura em `src/lib/`; migrations em `supabase/migrations/`; testes em `tests/` e `e2e/`; assets originais em `public/brand/`.
- Nenhum trecho de implementação faz parte desta fase documental. Exemplos reais de estilo serão incorporados às regras no M1 a partir do código produzido.

## Comandos e verificação

Os comandos implementados, instalação reproduzível e uso das stacks pessoal/isolada estão no [README](../../README.md) e no [setup](../setup.md). `pnpm build`, lint, tipos, unitários, integrações, RLS e Playwright compõem os gates; a CLI local é acessível como `pnpm supabase`. Reset e dados sintéticos pertencem somente à stack `bloco-test`.

Vitest testa invariantes, conversões, filtros e ordenação; testes de banco testam RLS, constraints e transações; Playwright testa interação real, seleção, IME, acesso e colaboração. Testes não devem espelhar a implementação ou aceitar execução falsa em DOM simulado para comprovar edição. Casos específicos constam nos contratos. O DoD e métricas ficam em [qualidade](interchange-quality.md).

## Limite do MVP

Todos os itens M1–M6 da missão são obrigatórios. Fora: fórmulas/rollups, offline, nativos, IA, integrações e histórico de versões. Logs e snapshots técnicos do CRDT servem à durabilidade, não constituem histórico navegável de versões. Também não há promessa de timeline, gráficos, formulários ou paridade corporativa. Nenhuma exceção remove segurança, acessibilidade ou testes.
