# Bloco — plano e progresso

Atualização: 26/10/2026 (America/Sao_Paulo). Fonte única de progresso.

## Estado e próximo passo

Checkpoint 1 entregue para revisão: dossiê REA delimitado, pesquisa pública, especificação e ADRs preparados. Evidência local é parcial; isso está explícito e não é validação completa do app instalado. M1 ainda não autorizado. **Parado: aguardar aprovação do escopo/ADRs/plano e “prossiga”.** Próxima ação autorizável: M1.1, após resolver os pré-requisitos pertinentes.

## Pré-requisitos observados

| Item | Resultado em 26/10/2026 | Ação |
| --- | --- | --- |
| Diretório | Vazio; nenhum repositório ancestral identificado | Git inicializado em `main` |
| Node | v24.21.0; linha 24 LTS | Fixar versão e engines no M1 |
| pnpm | 11.25.0 | Fixar packageManager no M1 |
| Git | 2.56.0.windows.2 | Disponível |
| Docker CLI | 29.8.2 | Disponível |
| Docker engine | Pipe do serviço indisponível | Iniciar Docker Desktop antes do M1 e verificar engine |
| Supabase CLI | Ausente no PATH | Dependência de desenvolvimento local e versionada no M1 |
| Notion | Uma instalação encontrada nos caminhos padrão verificados; versão 7.12.0 | Alvo: `C:\Users\Usuario\AppData\Local\Programs\Notion\resources\app.asar` |
| REA | Skill versão 41 e ferramentas conectadas | Inspeção estática, sem UI/conta/rede do app |

## Marcos

| Marco | Escopo | Status |
| --- | --- | --- |
| F1 / Checkpoint 1 | Inventário, fluxos, modelo, lacunas, MoSCoW, especificação e ADRs | Entregue; aguardando aprovação |
| M1 Fundação | Ambiente, prova de risco CRDT, auth, workspaces, RLS, shell original, CI | Aguardando Checkpoint 1 |
| M2 Páginas | Hierarquia, CRUD, ordem, capas, favoritos, lixeira e busca | Planejado |
| M3 Editor | Blocos, inline, arquivos, interações, autosave e base colaborativa | Planejado |
| M4 Databases | Propriedades, cinco views, filtros, agrupamento e templates | Planejado |
| M5 Colaboração | Edição simultânea, presença, comentários, ACL e publicação somente leitura | Planejado |
| M6 Acabamento | Intercâmbio, idiomas, acessibilidade, performance e deploy | Planejado |

## Contratos, propostas e limites

- REA identificou pacote ASAR; verificações registraram seis divergências de integridade em arquivos complementares. Bytes divergentes não são confiáveis; causa não determinada. Nenhuma proteção ou arquivo foi alterado.
- Inventário estático não demonstra comportamento em execução. Fontes públicas sustentam funcionalidade; escolhas do Bloco serão explicitamente separadas.
- ADR-001: comparar blocos normalizados e Yjs por página, mantendo databases relacionais.
- ADR-002: comparar TipTap, BlockNote e Lexical; avaliar licenças e transporte colaborativo.
- Não exportar código, grafo de símbolos ou assets analisados ao repositório.
- Contratos: [índice funcional](spec/README.md), [arquitetura](spec/architecture.md), [análise com limites](rea/README.md), [setup](setup.md).
- ADRs propostas: [001 armazenamento](adr/ADR-001-content-storage.md), [002 editor](adr/ADR-002-editor.md), [003 sincronização](adr/ADR-003-sync.md), [004 acesso](adr/ADR-004-access.md), [005 ordem](adr/ADR-005-ordering.md), [006 identidade](adr/ADR-006-identity.md), [007 intercâmbio](adr/ADR-007-interchange.md), [008 busca/idioma](adr/ADR-008-search-locale.md), [009 runtime/lifecycle](adr/ADR-009-runtime-lifecycle.md), [010 databases](adr/ADR-010-database-semantics.md).
- Decisão operacional reversível: [011 autoria do checkpoint](adr/ADR-011-checkpoint-authorship.md); sem nome/e-mail Git configurados, usar autoria técnica apenas nesta invocação, sem mudar configuração global.
- Revisão dos contratos identificou e corrigiu dois pontos: movimento que altera acesso exige gestão de todos os escopos afetados; referências antigas indisponíveis não bloqueiam edição de campos não relacionados. Nenhuma implementação foi testada nessa revisão.

## Execução proposta após aprovação

Os itens abaixo são fatias internas, não marcos adicionais que dispensem os gates de M1–M6. Status de todas as fatias: **não iniciado**. Dependências seguem a ordem indicada; ao implementar, registrar por item os arquivos, critérios medidos e evidências aqui. Não criar `tasks/plan.md`, tracker paralelo ou segunda fonte de status.

| ID | Fatia e dependência | Critério de aceitação / verificação |
| --- | --- | --- |
| M1.1 | Toolchain, esqueleto Next/TS/Tailwind e scripts; depende de aprovação | Versões fixadas, build/lint/typecheck e teste inicial reais; nenhuma credencial |
| M1.2 | Docker/Supabase local, migrations e testes; depende M1.1 | Banco recriado do zero, RLS deny inicial e tipos gerados sem drift |
| M1.3 | Prova TipTap/Yjs/transporte/estrutura; depende M1.2 | Duas sessões convergem; mover/editar/apagar, CAS, compactação e revogação atendem spec; falha reabre ADR-001/002 antes de fixar conteúdo |
| M1.4 | Cadastro/e-mail, login, recuperação, Google e sessão; depende M1.2 | Fluxos E2E e negativos; provedor real validado quando configurado, sem chamar simulação de validação Google |
| M1.5 | Workspace, membros, convites e fundação ACL; depende M1.4 | Dois workspaces isolados, quatro capacidades de página em políticas, último owner preservado, convite seguro |
| M1.6 | Shell, tokens originais e claro/escuro; depende M1.5 | Teclado/foco/contraste e layout responsivo verificados; sem arte da referência |
| M1.7 | CI, README/setup/AGENTS e gate; depende M1.3–M1.6 | Todos os comandos do DoD verdes, docs operacionais, commit e parada |
| M2.1 | CRUD, títulos, ícone e capa com Storage privado; depende M1 | Ciclo completo E2E e políticas para upload/download de capa |
| M2.2 | Árvore incremental e movimentos; depende M2.1 | Índices/ordem/ciclos, concorrência e cadeia profunda em unitário+banco+navegador |
| M2.3 | Breadcrumbs, favoritos e lixeira; depende M2.2 | Remover/restaurar subárvore sem reviver exclusões antigas ou ampliar acesso |
| M2.4 | FTS por título e busca rápida; depende M2.1 | Ranking/acentos/cursor e ausência de vazamento em snippets/contagens |
| M2.gate | Integração e documentação; depende M2.3/M2.4 | DoD completo, commit, relatório e parada |
| M3.1 | Schema e persistência canônica; depende M2 e prova M1.3 | Validação, updates idempotentes, migração de schema e projeções atômicas testados |
| M3.2 | Tipos textuais, listas e marks; depende M3.1 | Corpus obrigatório sobrevive reload sem perda, testes de conversão |
| M3.3 | Slash, Markdown, seleção, transformar e undo; depende M3.2 | Teclado, IME, colagem e undo com update remoto em navegador |
| M3.4 | Mídia, tabelas e colunas; depende M3.2 | Storage privado, alt, células/colunas e drag acessível; reaproveitar upload seguro do M2 |
| M3.5 | Autosave, movimentos, menções e índice do corpo; depende M3.3/M3.4 | ACK perdido/retry, ID estável, FTS/backlinks autorizados, falhas recuperáveis |
| M3.gate | Integração e documentação; depende M3.5 | DoD completo, commit, relatório e parada |
| M4.1 | Base inteira/inline e propriedades/valores tipados; depende M3 | Doze tipos validados, título único canônico e constraints/RLS |
| M4.2 | Views tabela/lista e edição de célula; depende M4.1 | Navegação por teclado, conflito por célula e consultas sem N+1 |
| M4.3 | Filtros/sorts/grupos no servidor; depende M4.2 | AST limitada, nulos/empates/conjuntos e paginação testados |
| M4.4 | Board/calendário/galeria; depende M4.3 | Mesmas entidades nas cinco views, drag altera valor, datas/fusos/sem data |
| M4.5 | Templates e mudanças de schema; depende M4.4 | Instâncias independentes e conversões sem perda silenciosa |
| M4.gate | Integração e documentação; depende M4.5 | DoD completo, commit, relatório e parada |
| M5.1 | Provider de produção e catch-up; depende M4 | Duas sessões, reconexão, duplicação, ordenação, compactação e nenhuma perda de update aceito |
| M5.2 | Presença/cursores e revogação; depende M5.1 | Canais privados, leases/épocas, sem novo texto para canal revogado |
| M5.3 | Comentários e âncoras; depende M5.1 | Autoria/roles, resolver/reabrir e âncoras após mover/apagar |
| M5.4 | UI de compartilhamento e link público; depende M5.2/M5.3 | Quatro papéis, projeção pública restrita e revogação de página/arquivo |
| M5.gate | Integração e documentação; depende M5.4 | Matriz de RLS completa, E2E multiusuário, DoD, commit e parada |
| M6.1 | Export Markdown/CSV e import ZIP; depende M5 | Corpus representável e adversarial, prévia/relatório, jobs idempotentes |
| M6.2 | pt-BR/en e auditoria WCAG AA; depende M6.1 | Traduções, fusos, teclado, leitor de tela e contraste |
| M6.3 | Virtualização e performance; depende M6.2 | Métricas de fixture registradas, seleção/IME/foco preservados em página longa |
| M6.4 | Preparo Vercel/Supabase e documentação final; depende M6.3 | Variáveis, quotas, backup/restauração, rollback e smoke checklist; sem deploy não solicitado |
| M6.gate | Entrega do MVP; depende M6.4 | DoD integral e documentação reproduzível, commit, relatório e parada |

## Decisões do usuário no Checkpoint 1

1. Aprovar escopo completo de M1–M6 e exclusões, sem reduzir Must para contornar dificuldade.
2. Aprovar ADR-001 (Yjs por página + databases relacionais), ADR-002 (TipTap) e prova antecipada no M1; aceitar que falha de semântica concorrente reabre decisão cara.
3. Aprovar acesso raiz privado, administração explícita do owner do workspace, quatro papéis por página, publicação sem herança automática e demais defaults das ADRs.
4. Aprovar o plano de marcos e direção original provisória. Nome final e credenciais externas podem ser decididos na fase pertinente.

## Pendências e riscos para continuidade

- Iniciar/verificar Docker engine e instalar CLI local no M1; nenhum serviço foi iniciado ou software instalado nesta fase.
- Provar movimentos simultâneos/identidade, validação binária, CAS/compactação e revogação antes de consolidar armazenamento; não há implementação ou benchmark aprovado ainda.
- Configuração real Google/e-mail e recursos Vercel/Supabase dependem de contas/credenciais que não foram acessadas; solicitar somente quando bloquear a etapa.
- Evidência local REA permanece parcial; fluxos foram especificados por fontes públicas e decisões D. Capturas do usuário só são necessárias se exigir paridade exata dos detalhes U; não reabrir o app para implementar.
- Intercâmbio é deliberadamente com perdas reportadas; não prometer recuperar views/ACL/histórico ausentes em Markdown/CSV.
- Segurança, acessibilidade e performance são gates de cada marco; números em qualidade são metas propostas, não resultados medidos.

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
