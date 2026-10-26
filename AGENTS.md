# Bloco — instruções para continuidade

## Retomada e limites

- Leia `docs/PLAN.md` primeiro: é a única fonte de progresso, decisões pendentes, gates e próximo passo. Não crie outro plano ou checklist de status.
- Leia os contratos em `docs/spec/` e as ADRs referenciadas no plano antes da mudança correspondente. Aprovações, condições ainda abertas e alterações posteriores ficam registradas no plano; não presuma que uma prova pequena aprova todo o editor.
- A missão está dividida em Checkpoint 1 e M1–M6. Ao concluir cada marco: verificações aplicáveis verdes, commit Conventional Commits em inglês e relatório de até dez linhas. O usuário autorizou posteriormente implementar M2–M6 sem novas pausas entre marcos; registrar no PLAN e continuar até concluir o escopo.
- Respeite aprovações e autorizações posteriores registradas no PLAN. Não remova requisitos para fazer um gate passar; registre e resolva o impedimento.
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
- Estrutura: `src/app/` para rotas, `src/features/` para domínios, `src/components/` para UI compartilhada, `src/lib/` para infraestrutura, `supabase/migrations/`, `tests/`, `e2e/`, `public/brand/` para assets originais.
- RLS em toda tabela da aplicação, isolamento por workspace e ACL por página; políticas de Storage e Realtime também. Nunca expor `service_role` ao cliente.
- Valide entradas no servidor, sanitize rich text, limite payloads e nunca use HTML arbitrário como conteúdo confiável. Sem segredos versionados.
- Preserve identidades de páginas e blocos, ordenação fracionária, paginação e índices. Não use substituição do documento inteiro como resolução de edição simultânea.
- Leia metadados de página pela RPC `get_page_metadata` e projeções autorizadas; `parent_id` físico e campos internos não têm SELECT direto. Não reintroduza vazamento de ancestrais privados ao construir editor, relações ou exportações.
- Recursos operáveis por teclado e foco gerenciado. Não enfraqueça testes, lint, tipos ou RLS.

## Comandos e gates

Use Node 24 LTS (24.21.0 recomendado, mínimo 24.19.0) e pnpm 11.25.0. Instalação reproduzível: `pnpm install --frozen-lockfile --ignore-scripts`. Preserve a política de scripts de dependências negados, peers estritos, patches e lockfile único.

Desenvolvimento: `pnpm supabase start`, `pnpm local:env` e `pnpm dev --hostname 127.0.0.1`. O gerador de ambiente recusa sobrescrever `.env.local`; nunca imprima seus valores. Reset somente na stack local explicitamente identificada: `pnpm supabase db reset --local`, com dados sintéticos que podem ser descartados.

A stack `bloco`/54321–54324 contém conta e dados pessoais do usuário: nunca executar reset/purge/remover volumes nela. Testes novos devem usar stack isolada `bloco-test`/55321–55324 e app 3001, conforme ADR-018; mudanças no ambiente pessoal são migrations aditivas verificadas, sem substituir `.env.local`.

Gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:spike`, `pnpm test:integration`, `pnpm test:rls`, `pnpm db:types:check`, `pnpm build`, `pnpm test:e2e`, `pnpm audit --audit-level high` e `git diff --check`. `pnpm db:types` gera os tipos; não os edite à mão. E2E exige Chromium instalado e build atualizado; `playwright.config.ts` controla o servidor e a superfície de prova. Não habilite `ENABLE_COLLABORATION_SPIKE` em produção.

Antes de commit de marco implementado: todos os gates aplicáveis passam, migrations reproduzem banco vazio, tipos estão sincronizados, `.env.example` está atualizado e o diff foi revisado por segredos. OAuth Google real e entrega externa de e-mail exigem configuração/credenciais próprias; fixture ou flag não comprovam esses provedores. Se um gate não rodou, registre a limitação verdadeira no plano.

Atualize o plano antes do commit. Não faça push, deploy ou criação de recursos remotos nesta fase. Não leia a instalação de referência para implementar. O workflow CI não configura sozinho proteção de branch nem valida provedores externos.
