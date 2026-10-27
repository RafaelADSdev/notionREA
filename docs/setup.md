# Ambiente local e autenticação

Este guia descreve como reproduzir o ambiente. Resultados efetivamente verificados, limitações e progresso estão exclusivamente em [PLAN](PLAN.md).

## Pré-requisitos e instalação

Use Node 24 LTS, com 24.21.0 recomendado em `.node-version` e mínimo 24.19.0, pnpm 11.25.0 e Git. O [ciclo oficial do Node](https://nodejs.org/en/about/previous-releases) identifica as linhas suportadas. As dependências e a CLI Supabase são fixadas no projeto; não é necessário instalar a CLI globalmente.

No Windows, instale/ative WSL 2 e inicie Docker Desktop com backend Linux. No macOS/Linux, use um runtime compatível com Docker. Antes de instalar a stack, confirme que `docker info` termina sem erro e indica servidor Linux. CLI instalada ou janela aberta não bastam. O primeiro início pode baixar imagens grandes; aguarde os health checks.

Na raiz do repositório:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm supabase start
pnpm local:env
pnpm dev --hostname 127.0.0.1
```

A instalação ignora scripts de ciclo de vida de dependências; `pnpm-workspace.yaml` também os nega por padrão e exige peers compatíveis. Não desative essas políticas para contornar falhas. Mantenha `pnpm-lock.yaml` e patches versionados; não adicione outro lockfile. O [guia da CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) explica seu funcionamento por projeto.

O projeto `bloco` contém dados locais a preservar. Não execute reset, parada/recriação ou remoção de volumes nessa stack para verificar código. Migrações da aplicação devem ser aplicadas de modo aditivo, após validação na stack isolada abaixo. Nunca use uma conexão remota para executar testes. Não use `--ignore-health-check` para declarar o banco pronto.

`local:env` consulta somente o endpoint local esperado, escreve `.env.local` sem mostrar valores e recusa sobrescrita. Se o arquivo já existir, preserve-o e altere os nomes necessários localmente com base em `.env.example`; não envie seu conteúdo ao chat, issue ou log. Para atualizar tipos após uma migration, rode `pnpm db:types`, revise o diff e valide com `pnpm db:types:check`.

## Endereços locais

| Serviço | Endereço |
| --- | --- |
| Aplicação | [http://127.0.0.1:3000](http://127.0.0.1:3000) |
| Supabase API/Auth | [http://127.0.0.1:54321](http://127.0.0.1:54321) |
| Studio | [http://127.0.0.1:54323](http://127.0.0.1:54323) |
| Mailpit | [http://127.0.0.1:54324](http://127.0.0.1:54324) |
| Postgres | Porta 54322, somente stack local de desenvolvimento |

Use a mesma origem durante cadastro, confirmação e retorno de autenticação. Trocar entre `localhost` e `127.0.0.1` no meio do fluxo pode separar cookies e invalidar a confirmação PKCE.

## Variáveis

| Nome | Exposição | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Pública | Endpoint Supabase do ambiente |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Pública | Chave pública; autorização continua em RLS |
| `SUPABASE_SECRET_KEY` | Somente servidor/teste local | Preparação e manutenção estritamente necessárias; nunca no navegador |
| `APP_URL` | Servidor | Origem canônica e retorno permitido da aplicação |
| `GOOGLE_AUTH_ENABLED` | Servidor | `true` apenas depois de configurar o provedor Google; padrão `false` |
| `ENABLE_COLLABORATION_SPIKE` | Servidor, somente teste | Habilita a superfície isolada das provas E2E; padrão `false`, manter desabilitada em produção |

Nenhum segredo recebe prefixo `NEXT_PUBLIC`. O validador recusa uma chave privilegiada no lugar da pública e exige HTTPS fora de loopback. `.env.example` contém apenas nomes e exemplos; `.env.local` permanece ignorado. Separar valores de desenvolvimento, preview e produção. Configurar o domínio final no ambiente do servidor, sem derivá-lo de um cabeçalho enviado pelo visitante.

## Cadastro, confirmação e recuperação por e-mail

1. Abra a aplicação e cadastre um endereço fictício com senha de 12 a 128 caracteres. A confirmação está habilitada na stack local.
2. Abra o Mailpit e a mensagem destinada à conta fictícia. Use o link no mesmo navegador que iniciou o cadastro.
3. Depois da confirmação, entre com e-mail/senha. Para recuperar acesso, solicite redefinição e abra o novo link do Mailpit.
4. Confirme a nova senha e teste login/logout. Links expirados ou já usados devem exigir uma nova solicitação.

O Mailpit intercepta e-mails da stack local; não comprova entrega externa. Para produção, configurar o envio no Supabase Auth com serviço SMTP autorizado, domínio/remetente e credenciais somente no provedor. Validar confirmação e recuperação reais antes do deploy, inclusive limites de envio e URLs de retorno. A aplicação usa sessão verificada no servidor conforme o [guia SSR Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).

## Entrada com Google

O código do fluxo não configura sozinho uma conta Google Cloud. Credenciais próprias e validação real são necessárias; a flag não substitui a configuração do Supabase. Não compartilhe o client secret pelo chat ou repositório. O [guia oficial Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) descreve o provedor.

### Configurar o cliente no Google

1. No projeto Google Cloud autorizado, configure a tela de consentimento para a aplicação e os usuários de teste enquanto estiver em modo de teste.
2. Crie um cliente OAuth do tipo aplicação web. Informe a origem da aplicação usada no ambiente, sem acrescentar caminhos à origem.
3. Cadastre como URI de redirecionamento o callback do **Supabase Auth**, que recebe a resposta Google. Localmente: `http://127.0.0.1:54321/auth/v1/callback`. No projeto hospedado, copie o callback exato mostrado na configuração do provedor; não invente o project ref.
4. Guarde o client ID e client secret na configuração privada do Auth. Considere credenciais distintas para desenvolvimento e produção. Configuração e escopos seguem o [protocolo web oficial do Google](https://developers.google.com/identity/protocols/oauth2/web-server).

### Usar Google na stack local

No `supabase/config.toml`, configure uma seção de provedor como abaixo, com valores vindos do ambiente do processo da CLI:

```toml
[auth.external.google]
enabled = true
client_id = "env(BLOCO_GOOGLE_CLIENT_ID)"
secret = "env(BLOCO_GOOGLE_CLIENT_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
```

Defina `BLOCO_GOOGLE_CLIENT_ID` e `BLOCO_GOOGLE_CLIENT_SECRET` somente no ambiente local protegido usado para iniciar o Auth; não os grave no TOML versionado. Reinicie a stack com `pnpm supabase stop` e `pnpm supabase start`, depois ajuste `GOOGLE_AUTH_ENABLED=true` no `.env.local` e reinicie a aplicação. A configuração local padrão permanece com Google desabilitado; não envie essa alteração de ambiente como prova de funcionamento do provedor.

### Usar Google em um projeto Supabase hospedado

Habilite o provedor Google no painel Auth do projeto autorizado e salve ali as credenciais do cliente web correspondente. Em URL Configuration, defina Site URL como a origem HTTPS da aplicação e permita o retorno exato `${APP_URL}/auth/callback`; para recuperação, permita também o retorno com `next=/reset-password` utilizado pelo fluxo. Na Vercel, mantenha URL/chave pública do projeto correto, `APP_URL` e `GOOGLE_AUTH_ENABLED=true`, com segredos apenas no ambiente privado necessário. Não abra os retornos a domínios arbitrários nem use wildcard amplo em produção. Consulte [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

### Comprovar o fluxo

Faça entrada real com uma conta de teste autorizada, conceda os escopos necessários, confirme retorno à aplicação e sessão do usuário correto, saia e teste nova entrada. Verifique também recusa/cancelamento e retorno inválido. Os testes locais automatizados verificam o comportamento implementado e a indisponibilidade quando desabilitado; não equivalem a uma validação da integração real com Google. Registre o resultado verdadeiro no PLAN, sem credenciais.

## Verificações e CI

Os testes utilizam exclusivamente o projeto `bloco-test`, API `http://127.0.0.1:55321`, Postgres `55322`, Mailpit `55324` e aplicação `http://127.0.0.1:3001`. O ambiente pessoal em `3000` e `54321–54324` permanece independente. A preparação copia a configuração, migrations e testes canônicos para `.supabase/testing/`, ignorado pelo Git; não edite essa cópia.

Prepare os serviços e recrie **somente o banco descartável de teste**:

```sh
pnpm test:env
pnpm test:db:reset
```

`test:env` inicia os serviços mínimos necessários e gera `.env.test.local`, também ignorado, sem imprimir credenciais. `test:db:reset` atualiza as cópias e exige projeto/portas de teste antes do reset. Após mudar migrations, repita o reset isolado. Esses comandos nunca carregam `.env.local`.

Com a stack de teste disponível:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:spike
pnpm test:rls
pnpm test:integration
pnpm test:perf
pnpm db:types:check
pnpm build
pnpm test:build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --audit-level high
git diff --check
```

`test:build` compila com variáveis isoladas e saída `.next-test`; o build normal continua em `.next`. `test:e2e` inicia exclusivamente o build de prova em `3001`, com reutilização de servidor desabilitada, e utiliza contas/páginas sintéticas. Se `3001` estiver ocupada, investigue antes de parar um processo. Não aponte testes ao servidor pessoal. Para CI Linux, a instalação do navegador usa `--with-deps chromium`. Não gerar/uploadar traces, screenshots ou logs contendo senhas, cookies ou chaves.

`db:types` e `db:types:check` inspecionam somente o schema da stack de teste; integre novas migrations antes de gerar. `test:rls` e `test:integration` também recusam o banco pessoal. Para parar somente os serviços descartáveis: `pnpm test:env:stop`. Não use `pnpm supabase stop` como encerramento de testes.

O workflow versionado em `.github/workflows/ci.yml` reproduz os gates no Ubuntu com Docker, Node e pnpm fixados. Ele não publica a aplicação, não precisa de segredo de produção e não prova OAuth Google ou entrega SMTP. Exigir o check de CI na proteção da branch quando houver repositório remoto; essa configuração remota não é feita pelo arquivo YAML.

## Falhas comuns

### Conteúdo por blocos

O build compila o validador isolado para `.editor-runtime/validation-worker.mjs`; desenvolvimento mantém esse arquivo atualizado junto ao Next. O artefato é ignorado pelo Git e incluído no tracing da rota de documentos. Use o build completo ao preparar o pacote; copiar apenas os fontes da rota não inclui seu validador.

O salvamento transmite deltas Yjs de até 256 KiB, com identidade de operação e confirmação durável. O bootstrap divide a leitura por revisão em chunks de 512 KiB. A validação limita estado e projeção a 8 MiB cada; duas gravações podem ler/validar/confirmar simultaneamente por instância, com oito aguardando. Excesso recebe erro recuperável, sem descartar o rascunho. A sessão de edição oferece retry e cópia do texto pendente; fechar abruptamente a aba antes da confirmação ainda pode perder esse rascunho em memória.

Arquivos usam upload direto privado de até 25 MiB; anexos baixam como binário, imagens exigem formato e dimensões verificados. A finalização limita tentativas por pessoa/workspace e não libera acesso público por conta própria. Uma mudança de permissão exige nova autorização para leitura, download e salvamento.

Depois de compilar o runtime, `pnpm test:perf:editor` verifica o limite de três segundos com 5.000 blocos, dois workers concorrentes e lotes causais; registra bytes, máquina e heap amostrado, sem conteúdo pessoal. Essa prova mede validação, não a latência de digitação nem a renderização no navegador.

## Diagnóstico local

- **Docker não responde:** abra o Docker Desktop e aguarde o engine Linux; no Windows, confirme WSL 2 funcional. Retome só depois de `docker info` passar.
- **Porta ocupada:** identifique o serviço antes de parar qualquer processo; não mude endpoints em apenas um componente.
- **`.env.local` já existe:** o gerador preserva o arquivo. Não o apague para contornar sem revisar o que precisa manter.
- **Tipos divergentes:** confira migrations, reproduza o banco local e gere os tipos; não edite o arquivo gerado à mão.
- **Google indisponível:** configure Auth e cliente Google, além da flag; autenticação simulada não resolve credenciais ausentes.
- **E-mail não chegou externamente:** no desenvolvimento, procure no Mailpit. No projeto hospedado, verifique remetente, SMTP e limites no Supabase.

Para parar o ambiente local, execute `pnpm supabase stop`. Isso não encerra o Docker Desktop nem altera aplicativos instalados de referência.
