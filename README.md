# Bloco

Workspace original de notas e bases de dados por blocos. Nome provisório; produto web com conteúdo colaborativo, organização hierárquica e identidade própria.

[Publicação na Vercel](https://bloco-jet.vercel.app): modo local com páginas e notas persistidas no navegador por IndexedDB, sem backend. Os recursos sincronizados continuam dependendo do Supabase; o estado real e as pendências ficam no plano. Use sempre o mesmo domínio/perfil e baixe backups das suas notas.

Aplicação web com Next.js App Router, TypeScript estrito, Tailwind e Supabase. A fundação reúne autenticação, workspaces/membros, políticas de acesso e a base do conteúdo colaborativo. O escopo e o estado de cada marco estão exclusivamente em [docs/PLAN.md](docs/PLAN.md).

## Executar localmente

Use Node 24 LTS (24.21.0 recomendado), pnpm 11.25.0 e Docker com engine Linux funcionando.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm supabase start
pnpm local:env
pnpm dev --hostname 127.0.0.1
```

Abra [Bloco local](http://127.0.0.1:3000). Mensagens de confirmação e recuperação de senha ficam no [Mailpit local](http://127.0.0.1:54324); não são enviadas a destinatários externos. Preserve a stack pessoal: não execute reset nem remova seus volumes. Testes usam outro projeto, separado nas portas 55321–55324 e aplicação 3001.

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
| `pnpm test:perf` | Orçamento de 500 ms p95 em busca/listagem com 10 mil páginas sintéticas |
| `pnpm test:perf:databases` | Consultas autenticadas com 50 mil registros, filtro, ordenação e cursor |
| `pnpm test:perf:editor` | Validar 5.000 blocos e lotes causais no worker real já compilado |
| `pnpm test:rls` | Testes de políticas e integridade no banco local |
| `pnpm test:e2e` | Fluxos reais de navegador contra a stack local |
| `pnpm test:local` | Persistência IndexedDB, backup/restauração, abas e falha de gravação em3002, sem backend |
| `pnpm test:env` | Preparar/iniciar a stack de testes isolada |
| `pnpm test:db:reset` | Recriar somente o banco descartável de testes |
| `pnpm test:build` | Build isolado para os testes de navegador |
| `pnpm db:types` | Gerar tipos TypeScript a partir do banco local |
| `pnpm db:types:check` | Falhar se os tipos versionados diferirem do banco |
| `pnpm local:env` | Criar ambiente local ignorado pelo Git |
| `pnpm supabase stop` | Parar a stack local |

Antes do primeiro E2E, instale o Chromium de teste com `pnpm exec playwright install chromium`. Em Linux/CI, use `pnpm exec playwright install --with-deps chromium`. Prepare com `pnpm test:env`, recrie somente o teste com `pnpm test:db:reset` e execute `pnpm test:build` antes de `pnpm test:e2e`. `.env.test.local` e `.next-test` mantêm teste e preview pessoais separados; as verificações recusam a stack pessoal ou um destino remoto.

## Arquitetura e contribuição

Conteúdo canônico em Yjs por página, com fragmentos estáveis por bloco separados de sua posição; metadados e databases relacionais no Postgres. Identidades e comentários não devem depender da posição visual. O transporte previsto usa Supabase Realtime e persistência durável, sem servidor WebSocket próprio. Detalhes e limites de comprovação estão nas [ADRs](docs/adr/ADR-012-stable-block-content.md) e no plano.

Rotas em `src/app/`, domínios em `src/features/`, infraestrutura em `src/lib/`, migrations em `supabase/migrations/`, testes em `tests/` e `e2e/`. Código/commits em inglês; interface e documentação em pt-BR. Nunca versionar `.env.local`, credenciais, dumps de sessão ou material recuperado da referência.

- [Progresso e próximo passo](docs/PLAN.md)
- [Instruções de continuidade](AGENTS.md)
- [Análise e limites de evidência](docs/rea/README.md)
- [Especificação funcional](docs/spec/README.md)
- [Decisões de armazenamento](docs/adr/ADR-001-content-storage.md)
- [Preparação do ambiente](docs/setup.md)
- [Guia de uso](docs/user-guide.md)
- [Preparação de deploy](docs/deploy.md)
- [Operação e recuperação](docs/operations.md)

Toda implementação parte da especificação e de documentação pública, sem reutilização de código ou identidade da referência. A configuração Google depende de credenciais próprias e validação real do provedor; um teste simulado não comprova esse fluxo. Não há push ou deploy automático neste trabalho.
