# Bloco — instruções para continuidade

## Retomada e limites

- Leia `docs/PLAN.md` primeiro: é a única fonte de progresso, decisões pendentes, gates e próximo passo. Não crie outro plano ou checklist de status.
- Leia os contratos em `docs/spec/` e as ADRs referenciadas no plano antes da mudança correspondente. As ADRs do Checkpoint 1 são propostas até aprovação.
- A missão está dividida em Checkpoint 1 e M1–M6. Ao concluir cada marco: verificações aplicáveis verdes, commit Conventional Commits em inglês, relatório de até dez linhas e parada. Aguarde o usuário dizer “prossiga”.
- Não avance do Checkpoint 1 para M1 sem aprovação. Não remova requisitos para fazer um gate passar; registre e resolva o impedimento.
- Decisões reversíveis não especificadas vão para `docs/adr/`, com 5–10 linhas por ADR. Pergunte apenas em bloqueio ou decisão cara de reverter.

## Clean-room

- A instalação do Notion foi autorizada apenas para análise estática somente leitura com a skill REA. Não opere sua interface.
- Nunca leia perfil, conta, cache, cookies, credenciais ou sessões. Não capture tráfego nem use API privada. Não execute, modifique, extraia para este repositório ou reempacote o app.
- `docs/rea/` contém exclusivamente especificação em linguagem natural e proveniência sanitizada; não adicione código, símbolos internos, strings de interface, imagens, fontes ou estilos recuperados.
- Implemente exclusivamente a partir de `docs/spec/`, ADRs aprovadas e documentação pública. Não reabra o artefato para implementar. Se faltar comprovação de comportamento, peça captura/gravação sem dados pessoais ao usuário.
- Identidade original. “Bloco” é nome provisório. Nenhum asset ou branding do produto de referência.

## Engenharia

- Stack solicitada: Next.js App Router, React, TypeScript strict, Tailwind, pnpm, Supabase e Vercel; dnd-kit; Vitest, Playwright e testes de RLS. Editor sujeito à ADR-002.
- Código, nomes técnicos e commits em inglês; documentação e interface em pt-BR; en previsto no M6.
- Planejado: `src/app/` para rotas, `src/features/` para domínios, `src/components/` para UI compartilhada, `src/lib/` para infraestrutura, `supabase/migrations/`, `tests/`, `e2e/`, `public/brand/` para assets originais.
- RLS em toda tabela da aplicação, isolamento por workspace e ACL por página; políticas de Storage e Realtime também. Nunca expor `service_role` ao cliente.
- Valide entradas no servidor, sanitize rich text, limite payloads e nunca use HTML arbitrário como conteúdo confiável. Sem segredos versionados.
- Preserve identidades de páginas e blocos, ordenação fracionária, paginação e índices. Não use substituição do documento inteiro como resolução de edição simultânea.
- Recursos operáveis por teclado e foco gerenciado. Não enfraqueça testes, lint, tipos ou RLS.

## Comandos e gates

No Checkpoint 1 há somente documentação: `git diff --check` e a revisão de links/cobertura são verificações disponíveis. Build, lint, typecheck e testes de aplicação **ainda não existem**, portanto não podem ser declarados verdes.

O M1 deve materializar e documentar: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:rls`, `pnpm supabase start`, `pnpm supabase db reset`, `pnpm db:types` e o comando de paridade dos tipos gerados. Comandos ainda planejados não são instruções executáveis neste estado.

Antes de commit de marco implementado: todos os gates acima aplicáveis passam, migrations reproduzem banco vazio, tipos estão sincronizados, `.env.example` está atualizado e o diff foi revisado por segredos. Atualize o plano antes do commit. Não faça push ou deploy nesta fase.
