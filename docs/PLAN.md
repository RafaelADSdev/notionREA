# Bloco — plano e progresso

Atualização: 26/10/2026 (America/Sao_Paulo). Fonte única de progresso.

## Estado e próximo passo

Checkpoint 1 aprovado pelo usuário com “prosiga”. **M1 concluído; aguardar “prossiga” para M2.** ADRs 001–010 e adaptação ADR-012 aceitas. Evidência local REA continua parcial; implementação consultou somente especificação e fontes públicas. Próxima ação autorizável: M2.1, CRUD de páginas e Storage privado, lendo contratos e ADRs antes de editar. Não iniciar automaticamente.

Docker Desktop iniciado via Computer Use a pedido do usuário; engine confirmado `29.8.2 linux`, CLI Supabase local `2.122.0`. O binding inicial falhou em quatro movimentos concorrentes; usuário aprovou expressamente a [ADR-012](adr/ADR-012-stable-block-content.md). Conteúdo agora tem fragmentos estáveis separados da posição, com histórico pertencente à página. Provas ampliadas passaram; nenhum requisito de preservação foi invertido ou ignorado.

Fechamento M1: build, lint, typecheck, 38 testes unitários/de modelo, 121 pgTAP, cinco integrações Postgres/Yjs e sete E2E verdes; banco vazio reproduzido e tipos sem drift. Confirmação/recuperação usam mensagens reais do Mailpit local; Google real aguarda credenciais externas. CI versionado, sem push/deploy. Detalhes, medições e limites abaixo.

## Pré-requisitos observados

| Item          | Resultado em 26/10/2026                                                  | Ação                                                                      |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Diretório     | Vazio; nenhum repositório ancestral identificado                         | Git inicializado em `main`                                                |
| Node          | v24.21.0; wrapper pnpm usa 24.19.0, ambos LTS 24                         | `.node-version` e engines fixados                                        |
| pnpm          | 11.25.0                                                                  | packageManager e lockfile fixados                                        |
| Git           | 2.56.0.windows.2                                                         | Disponível                                                                |
| Docker CLI    | 29.8.2                                                                   | Disponível                                                                |
| Docker engine | 29.8.2 linux, funcional após configuração WSL pelo usuário               | Stack local `bloco` iniciada e verificada                                |
| Supabase CLI  | 2.122.0, dependência local                                                | Migrations e testes reproduzidos                                         |
| Notion        | Uma instalação encontrada nos caminhos padrão verificados; versão 7.12.0 | Alvo: `C:\Users\Usuario\AppData\Local\Programs\Notion\resources\app.asar` |
| REA           | Skill versão 41 e ferramentas conectadas                                 | Inspeção estática, sem UI/conta/rede do app                               |

## Marcos

| Marco             | Escopo                                                                     | Status                |
| ----------------- | -------------------------------------------------------------------------- | --------------------- |
| F1 / Checkpoint 1 | Inventário, fluxos, modelo, lacunas, MoSCoW, especificação e ADRs          | Aprovado pelo usuário |
| M1 Fundação       | Ambiente, prova de risco CRDT, auth, workspaces, RLS, shell original, CI   | Concluído; aguarda usuário |
| M2 Páginas        | Hierarquia, CRUD, ordem, capas, favoritos, lixeira e busca                 | Planejado             |
| M3 Editor         | Blocos, inline, arquivos, interações, autosave e base colaborativa         | Planejado             |
| M4 Databases      | Propriedades, cinco views, filtros, agrupamento e templates                | Planejado             |
| M5 Colaboração    | Edição simultânea, presença, comentários, ACL e publicação somente leitura | Planejado             |
| M6 Acabamento     | Intercâmbio, idiomas, acessibilidade, performance e deploy                 | Planejado             |

## Contratos, propostas e limites

- REA identificou pacote ASAR; verificações registraram seis divergências de integridade em arquivos complementares. Bytes divergentes não são confiáveis; causa não determinada. Nenhuma proteção ou arquivo foi alterado.
- Inventário estático não demonstra comportamento em execução. Fontes públicas sustentam funcionalidade; escolhas do Bloco serão explicitamente separadas.
- ADR-001: comparar blocos normalizados e Yjs por página, mantendo databases relacionais.
- ADR-002: comparar TipTap, BlockNote e Lexical; avaliar licenças e transporte colaborativo.
- Não exportar código, grafo de símbolos ou assets analisados ao repositório.
- Contratos: [índice funcional](spec/README.md), [arquitetura](spec/architecture.md), [análise com limites](rea/README.md), [setup](setup.md).
- ADRs aceitas: [001 armazenamento](adr/ADR-001-content-storage.md), [002 editor](adr/ADR-002-editor.md), [003 sincronização](adr/ADR-003-sync.md), [004 acesso](adr/ADR-004-access.md), [005 ordem](adr/ADR-005-ordering.md), [006 identidade](adr/ADR-006-identity.md), [007 intercâmbio](adr/ADR-007-interchange.md), [008 busca/idioma](adr/ADR-008-search-locale.md), [009 runtime/lifecycle](adr/ADR-009-runtime-lifecycle.md), [010 databases](adr/ADR-010-database-semantics.md).
- Decisão operacional reversível: [011 autoria do checkpoint](adr/ADR-011-checkpoint-authorship.md); sem nome/e-mail Git configurados, usar autoria técnica apenas nesta invocação, sem mudar configuração global.
- Revisão dos contratos identificou e corrigiu dois pontos: movimento que altera acesso exige gestão de todos os escopos afetados; referências antigas indisponíveis não bloqueiam edição de campos não relacionados. Nenhuma implementação foi testada nessa revisão.

## Execução proposta após aprovação

Os itens abaixo são fatias internas, não marcos adicionais que dispensem os gates de M1–M6. M1.1–M1.7 concluídas com os limites de escopo registrados nas evidências. Não criar `tasks/plan.md`, tracker paralelo ou segunda fonte de status.

| ID      | Fatia e dependência                                                   | Critério de aceitação / verificação                                                                                                      |
| ------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| M1.1    | Toolchain, esqueleto Next/TS/Tailwind e scripts; depende de aprovação | Versões fixadas, build/lint/typecheck e teste inicial reais; nenhuma credencial                                                          |
| M1.2    | Docker/Supabase local, migrations e testes; depende M1.1              | Banco recriado do zero, RLS deny inicial e tipos gerados sem drift                                                                       |
| M1.3    | Prova TipTap/Yjs/transporte/estrutura; depende M1.2                   | Duas sessões convergem; mover/editar/apagar, CAS, compactação e revogação atendem spec; falha reabre ADR-001/002 antes de fixar conteúdo |
| M1.4    | Cadastro/e-mail, login, recuperação, Google e sessão; depende M1.2    | Fluxos E2E e negativos; provedor real validado quando configurado, sem chamar simulação de validação Google                              |
| M1.5    | Workspace, membros, convites e fundação ACL; depende M1.4             | Dois workspaces isolados, quatro capacidades de página em políticas, último owner preservado, convite seguro                             |
| M1.6    | Shell, tokens originais e claro/escuro; depende M1.5                  | Teclado/foco/contraste e layout responsivo verificados; sem arte da referência                                                           |
| M1.7    | CI, README/setup/AGENTS e gate; depende M1.3–M1.6                     | Todos os comandos do DoD verdes, docs operacionais, commit e parada                                                                      |
| M2.1    | CRUD, títulos, ícone e capa com Storage privado; depende M1           | Ciclo completo E2E e políticas para upload/download de capa                                                                              |
| M2.2    | Árvore incremental e movimentos; depende M2.1                         | Índices/ordem/ciclos, concorrência e cadeia profunda em unitário+banco+navegador                                                         |
| M2.3    | Breadcrumbs, favoritos e lixeira; depende M2.2                        | Remover/restaurar subárvore sem reviver exclusões antigas ou ampliar acesso                                                              |
| M2.4    | FTS por título e busca rápida; depende M2.1                           | Ranking/acentos/cursor e ausência de vazamento em snippets/contagens                                                                     |
| M2.gate | Integração e documentação; depende M2.3/M2.4                          | DoD completo, commit, relatório e parada                                                                                                 |
| M3.1    | Schema e persistência canônica; depende M2 e prova M1.3               | Validação, updates idempotentes, migração de schema e projeções atômicas testados                                                        |
| M3.2    | Tipos textuais, listas e marks; depende M3.1                          | Corpus obrigatório sobrevive reload sem perda, testes de conversão                                                                       |
| M3.3    | Slash, Markdown, seleção, transformar e undo; depende M3.2            | Teclado, IME, colagem e undo com update remoto em navegador                                                                              |
| M3.4    | Mídia, tabelas e colunas; depende M3.2                                | Storage privado, alt, células/colunas e drag acessível; reaproveitar upload seguro do M2                                                 |
| M3.5    | Autosave, movimentos, menções e índice do corpo; depende M3.3/M3.4    | ACK perdido/retry, ID estável, FTS/backlinks autorizados, falhas recuperáveis                                                            |
| M3.gate | Integração e documentação; depende M3.5                               | DoD completo, commit, relatório e parada                                                                                                 |
| M4.1    | Base inteira/inline e propriedades/valores tipados; depende M3        | Doze tipos validados, título único canônico e constraints/RLS                                                                            |
| M4.2    | Views tabela/lista e edição de célula; depende M4.1                   | Navegação por teclado, conflito por célula e consultas sem N+1                                                                           |
| M4.3    | Filtros/sorts/grupos no servidor; depende M4.2                        | AST limitada, nulos/empates/conjuntos e paginação testados                                                                               |
| M4.4    | Board/calendário/galeria; depende M4.3                                | Mesmas entidades nas cinco views, drag altera valor, datas/fusos/sem data                                                                |
| M4.5    | Templates e mudanças de schema; depende M4.4                          | Instâncias independentes e conversões sem perda silenciosa                                                                               |
| M4.gate | Integração e documentação; depende M4.5                               | DoD completo, commit, relatório e parada                                                                                                 |
| M5.1    | Provider de produção e catch-up; depende M4                           | Duas sessões, reconexão, duplicação, ordenação, compactação e nenhuma perda de update aceito                                             |
| M5.2    | Presença/cursores e revogação; depende M5.1                           | Canais privados, leases/épocas, sem novo texto para canal revogado                                                                       |
| M5.3    | Comentários e âncoras; depende M5.1                                   | Autoria/roles, resolver/reabrir e âncoras após mover/apagar                                                                              |
| M5.4    | UI de compartilhamento e link público; depende M5.2/M5.3              | Quatro papéis, projeção pública restrita e revogação de página/arquivo                                                                   |
| M5.gate | Integração e documentação; depende M5.4                               | Matriz de RLS completa, E2E multiusuário, DoD, commit e parada                                                                           |
| M6.1    | Export Markdown/CSV e import ZIP; depende M5                          | Corpus representável e adversarial, prévia/relatório, jobs idempotentes                                                                  |
| M6.2    | pt-BR/en e auditoria WCAG AA; depende M6.1                            | Traduções, fusos, teclado, leitor de tela e contraste                                                                                    |
| M6.3    | Virtualização e performance; depende M6.2                             | Métricas de fixture registradas, seleção/IME/foco preservados em página longa                                                            |
| M6.4    | Preparo Vercel/Supabase e documentação final; depende M6.3            | Variáveis, quotas, backup/restauração, rollback e smoke checklist; sem deploy não solicitado                                             |
| M6.gate | Entrega do MVP; depende M6.4                                          | DoD integral e documentação reproduzível, commit, relatório e parada                                                                     |

## Decisões do usuário no Checkpoint 1

1. Aprovar escopo completo de M1–M6 e exclusões, sem reduzir Must para contornar dificuldade.
2. Aprovar ADR-001 (Yjs por página + databases relacionais), ADR-002 (TipTap) e prova antecipada no M1; aceitar que falha de semântica concorrente reabre decisão cara.
3. Aprovar acesso raiz privado, administração explícita do owner do workspace, quatro papéis por página, publicação sem herança automática e demais defaults das ADRs.
4. Aprovar o plano de marcos e direção original provisória. Nome final e credenciais externas podem ser decididos na fase pertinente.

## Pendências e riscos para continuidade

- Google real e entrega externa de e-mail exigem credenciais e configuração próprias antes do deploy; código/roteiro presentes, sem alegar validação do provedor externo.
- O endpoint público de validação de conteúdo e provider de produto serão M3/M5; não estão expostos pelo M1. Seleção entre fragmentos, IME, clipboard, montagem/virtualização e todos os tipos finais de bloco continuam gates do editor, sem dívida de perda de texto já aceita.
- Configuração real Google/e-mail e recursos Vercel/Supabase dependem de contas/credenciais que não foram acessadas; solicitar somente quando bloquear a etapa.
- Evidência local REA permanece parcial; fluxos foram especificados por fontes públicas e decisões D. Capturas do usuário só são necessárias se exigir paridade exata dos detalhes U; não reabrir o app para implementar.
- Intercâmbio é deliberadamente com perdas reportadas; não prometer recuperar views/ACL/histórico ausentes em Markdown/CSV.
- Segurança, acessibilidade e performance são gates de cada marco; números em qualidade são metas propostas, não resultados medidos.

## Evidências de fechamento do M1

- Implementação: `src/app/`, `src/features/auth/`, `src/features/workspaces/`, `src/features/editor/model/`, `src/lib/`, `supabase/migrations/202610260001_foundation.sql`. Next 16.4.3/React 19.3.1/TS 6.0.3/Tailwind 4.3.3; pnpm 11.25.0; dependências exatas, peers estritos, scripts negados e patch público de tipos mínimo.
- `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (38), `pnpm test:rls` (121), `pnpm test:integration` (5), `pnpm test:e2e` (7), `pnpm db:types:check`, `pnpm audit --audit-level high` e `git diff --check`: passaram. Nenhum teste skip/only, regra desativada ou tipo suprimido.
- Reset local reproduzido duas vezes no fechamento; segunda rodada partiu de banco vazio e repetiu RLS, integração, tipos e os sete E2E. Recibos sobrevivem à compactação, CAS rejeita base obsoleta e retry aplica o delta ao head novo; bootstrap MVCC não perde revisão concorrente.
- Modelo: move/edição em parágrafo e descendentes de toggle/tabela/colunas preservam conteúdo; dois movimentos convergem sem duplicar ID; ciclos locais são rejeitados e ciclos de merge detectados antes da aceitação; tombstone preserva edição para restauração; undo local não apaga texto remoto. A desmontagem de outra view não destrói histórico.
- Navegador: duas views TipTap reais preservam texto, caret e undo ao mudar posição/ocultar/restaurar. Fixture BroadcastChannel é controle de ensaio, não transporte de produção. `/test-editor` depende de flag de servidor e origem loopback; com flag desabilitada, renderiza apenas indisponibilidade (resposta pode ser streaming 200). Não representa editor composto de M3.
- Supabase real: conta sintética recebe aviso em canal privado, lê snapshot autorizado, perde leitura de snapshot/log imediatamente após revogação com canal ainda aberto. Prontidão de replicação é aguardada explicitamente; avisos carregam revisão e UUID de transporte, nunca corpo. Catch-up sem aviso também foi comprovado em Postgres.
- Auth: cadastro, confirmação e recuperação de senha via Mailpit, login/logout, erro e callback inválido exercitados. Google tem início PKCE, callback canônico, flag e fronteiras testadas; fluxo com Google real não executado. Cookies HttpOnly, CSP com nonce, entradas limitadas e redirecionamentos fechados.
- Workspaces: criação idempotente, owner inicial/último owner, membros/convites hash/expiração/uso único/e-mail confirmado, isolamento e switch testados. Revisão independente encontrou paginação ausente; RPC/índice/cursor/UI corrigidos e equipe de 61 pessoas atravessa duas páginas sem repetição. Cascade privilegiado corrigido com regressão; último owner continua protegido.
- Interface: identidade original mineral/editorial, claro/escuro, sidebar recolhível e diálogo móvel com Escape/foco. Axe nos escopos login/workspace móvel: zero violações WCAG automatizadas; não equivale à auditoria completa do MVP. Capturas carregadas 1440px/390px revisadas; um ajuste de alvo 44px dos links foi pontuado e o revisor o marcou resolvido (`ship` no escopo do ajuste).
- Ferramenta visual: detector Impeccable foi tentado uma vez e falhou por módulo ausente na instalação da skill (`detect-url.mjs`); nenhum falso passe do detector. Piso revisado manualmente por revisor independente; DESIGN deriva do código e sidecar permanece local/ignorado.
- Medição local do shell autenticado: Chromium 156.0.8078.4, Windows, i5-14600KF/20 CPUs lógicas/16 GiB, viewport 1440×900, loopback sem throttling, build/cache aquecidos, uma pessoa e workspace sintéticos. Cinco navegações: LCP 96/352/344/56/360 ms; CLS 0 em todas; TTFB máximo 24,1 ms. Máximo observado LCP 360 ms, sem tratar cinco amostras como benchmark p95 de produção. Metas de editor/base extensa/rede simulada continuam nos marcos correspondentes.
- Segurança/higiene: auditoria nativa sem vulnerabilidades conhecidas; revisão de diff e padrões de segredos sem achado; valor privilegiado local ausente dos 20 chunks JS públicos inspecionados. Sem perfil/dado/código/asset do app de referência. `.env.local`, imagens de QA, caches e sidecar ignorados. Fixtures sintéticas limpas; nenhuma conta/infra remota criada.
- Novas decisões: [012 identidade estável](adr/ADR-012-stable-block-content.md), [013 toolchain](adr/ADR-013-toolchain-bootstrap.md), [014 tipos SDK](adr/ADR-014-sdk-type-compatibility.md), [015 histórico](adr/ADR-015-history-ownership.md), [016 paginação/manutenção](adr/ADR-016-foundation-pagination.md), [017 prontidão Realtime](adr/ADR-017-realtime-readiness.md). ESLint 9 é checagem adicional ao Biome mantido; revisar compatibilidade no M6. Patch de tipos não altera runtime Auth; remover quando upstream corrigir.
- Inventário nativo de licenças de produção consultado; editor/CRDT diretos MIT, sem extensão comercial. Licenças e avisos transitivos de dados e imagem nativa estão documentados em [dependências](dependencies.md); revisar pacote Linux/avisos do artefato ao preparar deploy no M6.
- CI Ubuntu versionado com actions por SHA e gates equivalentes; YAML/scripts revisados. CI remoto não executado e proteção de branch não configurada, pois não há push solicitado. Setup/README/AGENTS têm comandos atuais e roteiro Google/SMTP.
- Encerramento: commit local Conventional Commits `feat: establish secure collaborative workspace foundation`, autoria técnica por invocação conforme ADR-011; sem push/deploy. Preview local pode ser servido por `pnpm start --hostname 127.0.0.1`; desenvolvimento por `pnpm dev --hostname 127.0.0.1`, após stack/ambiente descritos em setup.

## Gates de encerramento da Fase 1

- [x] Verificar diretório vazio, pré-requisitos e identidade do alvo.
- [x] Inicializar Git e registrar instruções de retomada.
- [x] Encerrar a investigação delimitada com evidências, cobertura parcial, limites e questões residuais explícitos.
- [x] Especificar todas as capacidades, critérios e contratos originais.
- [x] Registrar ADRs iniciais e plano de execução dos marcos.
- [x] Verificar documentos, links locais, diff e material permitido no repositório.
- [x] Fechar com commit documental e relatório de até dez linhas; parar no Checkpoint 1.

Build, lint, typecheck e testes da aplicação: não aplicáveis na Fase 1, pois não há aplicação. Não representam verificações verdes. Gates de aplicação serão obrigatórios de M1 em diante.

## Evidências de fechamento do Checkpoint 1

- 29 documentos Markdown; 54 links locais verificados, nenhum destino ausente; 11 ADRs com 5–10 linhas não vazias cada.
- Pré-commit Matriarca: nenhum binário, asset recuperado, cache, código do alvo, dump de sessão ou dependência no staging; nenhum item bloqueador de higiene. Apenas documentação e configuração Git de exclusão/fim de linha.
- Busca por padrões de chave privada/JWT/secret key/token GitHub: zero ocorrências no diff; revisão contextual dos documentos sem valores reais de credenciais. Isso não é auditoria de uma aplicação ainda inexistente.
- `git diff --cached --check`: passou após normalização de finais de arquivo e política UTF-8/LF; zero colisões de paths/case. Verificação repetida antes do commit.
- REA: sessão encerrada sem snapshot/export de código; SHA-256 final do ASAR igual ao inicial; não houve operação de UI ou acesso a perfil/conta.
- Revisão independente dos contratos: dois achados materiais corrigidos (acesso por movimento e referência indisponível); sem execução de código de aplicação.
- Commit de fechamento identificável por `docs: define clean-room MVP specification and milestone plan`; autoria técnica restrita à invocação. Nenhum push ou recurso remoto criado.
- Retomada: ler este plano e AGENTS.md, aguardar aprovação se ainda não registrada; depois executar M1.1. Não reiniciar análise da instalação para implementar.
