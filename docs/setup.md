# Preparação do ambiente

Estado de 26/10/2026, Windows. Este documento começa pela verificação já realizada; o passo a passo executável da aplicação será completado no M1. Ainda não existe aplicação, `.env.example`, package manifest, stack Supabase local ou projeto remoto.

## Disponível

Node v24.21.0, pnpm 11.25.0, Git 2.56.0.windows.2 e Docker CLI 29.8.2. A [linha Node 24 é LTS](https://nodejs.org/en/about/previous-releases). Repositório inicializado em `main`, no diretório atual.

## Pendências reais para M1

1. Iniciar Docker Desktop e confirmar que o engine responde a `docker info`. A verificação desta fase falhou porque o pipe do serviço não estava disponível. Ter a CLI instalada não significa ter containers funcionando.
2. Adicionar Supabase CLI como dependência de desenvolvimento local, com versão exata compatível e lockfile. A CLI não está no PATH nesta máquina. A [documentação oficial](https://supabase.com/docs/guides/local-development/cli/getting-started) recomenda dependência por projeto e versão fixada; não requer instalação global.
3. Fixar conjunto compatível de versões Node/pnpm/Next/React/Supabase e bibliotecas no M1, antes de gerar a aplicação; `pnpm install --frozen-lockfile` será o modo de reprodução após existir lockfile.
4. Criar configuração local Supabase, migrations, fixtures não pessoais, políticas e geração de tipos. Só executar reset de banco em stack local do projeto identificado; nunca apontar reset a produção.

Não é necessário iniciar Docker ou instalar CLI para revisar o Checkpoint 1. Os bloqueios devem estar resolvidos para declarar M1 verde.

## Auth — roteiro a materializar no M1

E-mail: habilitar senha e confirmação no Supabase local, usar caixa de entrada local de testes para confirmar/resetar, restringir redirects ao endereço da aplicação e validar todos os fluxos reais. Antes de produção, configurar entrega de e-mail no Supabase e verificar confirmação/recuperação no domínio escolhido. Não versionar credenciais SMTP.

Google: seguir o [guia Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), criar/usar projeto Google autorizado pelo usuário, configurar consentimento e credenciais OAuth web, cadastrar callback exato do Auth e URLs de retorno da aplicação, guardar segredo somente na configuração de Auth/servidor e executar login/logout reais. O callback local/produção deve ser obtido da configuração efetiva, sem adivinhar domínio ou project ref. Sem credenciais reais, indicar provedor pendente; fixture de teste não o substitui.

Sessão Next.js: implementar SSR conforme o [guia oficial](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), validar sessão no servidor e tratar renovação, cookies e redirects. Não reaproveitar sessão ou credenciais de qualquer aplicativo instalado.

## Variáveis planejadas, sem valores reais

| Nome previsto | Exposição | Finalidade |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Pública | Endpoint do projeto do ambiente |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Pública | Chave pública; acesso continua dependente de RLS |
| SUPABASE_SECRET_KEY | Somente servidor | Caminhos internos estritamente necessários; equivalente privilegiado nunca no cliente |
| APP_URL | Configuração do servidor | Origem e retorno permitido da aplicação |
| Credenciais Google/SMTP | Configuração Auth/servidor | Provedores; não usar prefixo NEXT_PUBLIC para segredos |

Nomes finais e necessidade de cada variável serão verificados na versão escolhida. M1 deverá criar `.env.example` somente com nomes e valores fictícios, explicar onde obtê-los e manter `.env.local` ignorado. Ambientes remoto, preview e local não compartilham segredos por conveniência.

## Comandos futuros

`pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:rls`, `pnpm db:types` e `pnpm db:types:check` só estarão disponíveis após M1. O CLI local será invocado por `pnpm supabase`; o setup então documentará ordem de start, reset local, tipos e testes. Não interpretar esta lista como execução verificada.

Nesta fase, revisão documental usa `git diff --check` e os arquivos apontados no README. Resultados e próximo passo estão em [PLAN](PLAN.md).
