# Bloco

Workspace original de notas e bases de dados por blocos. Nome provisório; produto web com conteúdo colaborativo, organização hierárquica e identidade própria.

Aplicação web com Next.js App Router, TypeScript estrito, Tailwind e Supabase. A fundação reúne autenticação, workspaces/membros, políticas de acesso e a base do conteúdo colaborativo. O escopo e o estado de cada marco estão exclusivamente em [docs/PLAN.md](docs/PLAN.md).

## Executar localmente

Use Node 24 LTS (24.21.0 recomendado), pnpm 11.25.0 e Docker com engine Linux funcionando.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm supabase start
pnpm supabase db reset --local
pnpm local:env
pnpm dev --hostname 127.0.0.1
```

Abra [Bloco local](http://127.0.0.1:3000). Mensagens de confirmação e recuperação de senha ficam no [Mailpit local](http://127.0.0.1:54324); não são enviadas a destinatários externos. O reset apaga **somente os dados da stack local deste projeto** e reaplica as migrations. Não o execute para preservar dados locais que ainda precisa exportar.

`pnpm local:env` cria `.env.local` a partir da stack local sem exibir chaves e recusa sobrescrever um arquivo existente. Para instalação, credenciais Google, ambientes e solução de problemas, consulte [docs/setup.md](docs/setup.md).

## Comandos

| Comando | Finalidade |
| --- | --- |
| `pnpm dev --hostname 127.0.0.1` | Desenvolvimento local |
| `pnpm build` | Build de produção |
| `pnpm start --hostname 127.0.0.1` | Servir um build já gerado |
| `pnpm lint` | Regras de lint, sem aceitar avisos |
| `pnpm typecheck` | Gerar tipos de rotas e verificar TypeScript |
| `pnpm test` | Testes unitários e provas de modelo |
| `pnpm test:spike` | Provas focadas de colaboração |
| `pnpm test:integration` | Integração local de durabilidade, concorrência e autorização |
| `pnpm test:rls` | Testes de políticas e integridade no banco local |
| `pnpm test:e2e` | Fluxos reais de navegador contra a stack local |
| `pnpm db:types` | Gerar tipos TypeScript a partir do banco local |
| `pnpm db:types:check` | Falhar se os tipos versionados diferirem do banco |
| `pnpm local:env` | Criar ambiente local ignorado pelo Git |
| `pnpm supabase stop` | Parar a stack local |

Antes do primeiro E2E, instale o Chromium de teste com `pnpm exec playwright install chromium`. Em Linux/CI, use `pnpm exec playwright install --with-deps chromium`. O E2E usa o build de produção: execute `pnpm build` antes dele. Os testes criam contas e conteúdo fictícios somente no projeto local; não aponte esses comandos para produção.

## Arquitetura e contribuição

Conteúdo canônico em Yjs por página, com fragmentos estáveis por bloco separados de sua posição; metadados e databases relacionais no Postgres. Identidades e comentários não devem depender da posição visual. O transporte previsto usa Supabase Realtime e persistência durável, sem servidor WebSocket próprio. Detalhes e limites de comprovação estão nas [ADRs](docs/adr/ADR-012-stable-block-content.md) e no plano.

Rotas em `src/app/`, domínios em `src/features/`, infraestrutura em `src/lib/`, migrations em `supabase/migrations/`, testes em `tests/` e `e2e/`. Código/commits em inglês; interface e documentação em pt-BR. Nunca versionar `.env.local`, credenciais, dumps de sessão ou material recuperado da referência.

- [Progresso e próximo passo](docs/PLAN.md)
- [Instruções de continuidade](AGENTS.md)
- [Análise e limites de evidência](docs/rea/README.md)
- [Especificação funcional](docs/spec/README.md)
- [Decisões de armazenamento](docs/adr/ADR-001-content-storage.md)
- [Preparação do ambiente](docs/setup.md)

Toda implementação parte da especificação e de documentação pública, sem reutilização de código ou identidade da referência. A configuração Google depende de credenciais próprias e validação real do provedor; um teste simulado não comprova esse fluxo. Não há push ou deploy automático neste trabalho.
