# Arquitetura proposta e avaliações

Este documento desenvolve as ADRs curtas. Todas as decisões são D, com fontes públicas apontadas, e ficam propostas até o Checkpoint 1. Não derivam de estrutura de código, esquema privado ou protocolo da referência.

## ADR-001 — opções de armazenamento

| Critério | Blocos normalizados como fonte canônica no Postgres | Documento Yjs canônico por página + índice derivado |
| --- | --- | --- |
| Texto concorrente | SQL por bloco não resolve concorrência de caracteres; exige OT/CRDT adicional, possivelmente por bloco | CRDT permite merge do texto, condicionado à entrega eventual dos updates |
| Estrutura/mover | Transações e ordem por bloco são diretas; texto concorrente do mesmo bloco ainda precisa merge | Binding do editor facilita texto; mover/editar/apagar em paralelo exige prova específica, pois convergência não garante intenção |
| Databases | Schema, filtros e relações naturalmente relacionais | Propriedades/valores/views continuam relacionais; não entram no documento rico |
| Busca/backlinks | Índice sobre texto normalizado; atualizações por bloco | Extrair texto/referências do estado validado e indexar revisão do documento |
| RLS | Por linha/bloco, com herança e alto volume de registros | Por página/update/snapshot; mesmo acesso integral ao corpo; sem ACL por bloco no MVP |
| Operações | Muitas mutações de árvore, joins e reconstrução do documento; protocolo de edição precisa ser projetado | Log e compactação próprios; bootstrap, payload e validação binária precisam ser projetados |
| Evolução do editor | Modelo de bloco desacoplado, com adaptador mais extenso para TipTap | Melhor alinhamento com TipTap/Yjs, mas schema e migrações do documento viram contrato |
| Alternativa JSON puro | Transações continuam necessárias | Snapshot JSON sobrescrito por cliente perde concorrência: não atende M5 |

Recomendação: Yjs binário canônico por página, com atualizações duráveis e snapshots; páginas, metadados e domínio de database no Postgres. JSON estruturado, texto para FTS e backlinks são projeções reconstruíveis, nunca fontes alternativas editáveis. Essa escolha evita retrofit de CRDT no M5 e mantém filtros/relações transacionais. Custos aceitos: provider próprio, validação no servidor, compactação e prova de movimentos concorrentes.

Fonte: [updates Yjs](https://docs.yjs.dev/api/document-updates) fundamenta idempotência/ordem/convergência; não prova consistência semântica dos comandos do Bloco. A análise local não oferece fundamento para escolher armazenamento.

## ADR-002 — editor e licenças

| Alternativa | Adequação pública | Consequência D |
| --- | --- | --- |
| TipTap/ProseMirror | Core extensível e integração Yjs; [base](https://tiptap.dev/docs/editor/core-concepts/prosemirror), [colaboração](https://tiptap.dev/docs/editor/extensions/functionality/collaboration), [licença](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md) | Escolha proposta; schema, colunas, menus, comentários, dnd-kit e controles próprios; usar somente extensões com licença compatível |
| BlockNote | Modelo de blocos e Yjs prontos; [estrutura](https://www.blocknotejs.org/docs/foundations/document-structure), [colaboração](https://www.blocknotejs.org/docs/features/collaboration) | Acelera UI, mas colunas XL envolvem GPL-3.0/licença comercial segundo [licença oficial](https://www.blocknotejs.org/legal/blocknote-xl-commercial-license); não assumir gratuidade de todo recurso |
| Lexical | [Core](https://lexical.dev/docs/intro) extensível e MIT; [colaboração](https://lexical.dev/docs/collaboration/react) documenta y-websocket como provider oficialmente suportado | Viável, com composição e adaptador próprios; inferência de maior esforço no escopo atual |

TipTap headless permite identidade própria, mas não fornece conformidade automática: controles, foco e acessibilidade são responsabilidade do Bloco ([guia](https://tiptap.dev/docs/guides/accessibility)). O histórico comum não deve competir com o colaborativo. Não usar TipTap Cloud, Hocuspocus hospedado ou outro servidor próprio. Licenças devem ser verificadas por pacote/versão no M1/M3; a licença do core não cobre qualquer extensão opcional.

## Persistência, projeções e sincronização

1. Cliente envia delta binário limitado, página, versão de schema e ID de operação ao endpoint curto no runtime Node da Vercel. Realtime não aceita gravação de corpo pelo browser.
2. Servidor valida sessão/autoria; lê snapshot consistente e updates posteriores à sua revisão, reconstrói o documento e aplica o delta. Valida schema, limites expandidos e invariantes; delta com dependências causais ainda ausentes não recebe ACK e exige sincronização/reenvio, pois conteúdo pendente não pode escapar da validação. Exige autorização para referências novas/alteradas; referências já aceitas no estado canônico podem permanecer opacas/indisponíveis após revogação do destino, sem bloquear edição não relacionada. Reintrodução de referência ausente é nova mutação. Binário não recebe confiança só por ser update Yjs.
3. Servidor extrai projeção JSON permitida, texto FTS e referências. RPC interna, indisponível ao browser, revalida membership/ACL e compara revisão atual com a base lida; em uma transação grava delta, nova revisão, projeção e backlinks. Deduplicação considera operação/ator/página e digest; reuso do ID com bytes diferentes falha.
4. Caminho privilegiado não presume RLS: identidade é obtida da sessão verificada, autorização corrente é checada dentro da transação e escrita de ACL usa a mesma disciplina de locks. Grants de log/projeções/manutenção ficam revogados ao cliente. RLS continua em todas as tabelas de dados. Testar tentativa direta e revogação concorrente.
5. Se revisão mudou, reler/mesclar e tentar CAS novamente com limite e backoff; excesso devolve conflito recuperável sem descartar o buffer. Nunca persistir índice produzido sobre outra revisão. ACK inclui revisão e ID da operação efetivamente comprometida.
6. Transação sinaliza nova revisão por canal privado; cliente autorizado busca deltas do registro durável. Evento perdido é recuperado por catch-up/sondagem. Broadcast só contém identificador de escopo já autorizado, época e revisão; sem conteúdo. Presence separado não é persistência.
7. Compactador usa snapshot em revisão estável, mantém log posterior e troca checkpoint por CAS. Só elimina updates cobertos após comprovar que o novo snapshot reconstrói o mesmo estado. Leitor que iniciou antes da compactação recebe pacote consistente ou reinicia bootstrap; nenhum buraco entre snapshot/log.

Esse protocolo é uma proposta a validar, não um provider oficial pronto. [Provider Yjs](https://docs.yjs.dev/tutorials/creating-a-custom-provider) atribui ao transporte/armazenamento a distribuição dos updates. [Supabase Realtime](https://supabase.com/docs/guides/realtime/authorization) documenta controle de canais e cache de autorização; por isso texto durável sempre exige nova leitura autorizada.

## Domínios persistidos e integridade

Nomes abaixo são conceitos próprios; o M1 definirá nomes SQL em inglês nas migrations.

| Domínio | Chaves e invariantes | Índices mínimos e acesso |
| --- | --- | --- |
| Workspaces, membros e convites | Workspace + usuário únicos; owner preservado; convite hash/expiração/uso | Workspace/usuário, convite hash; RLS por vínculo e gestão |
| Páginas e árvore | Workspace/página, pai do mesmo workspace, revisão, posição e estado de lixeira | Workspace/pai/posição/ID; constraint composta e lock contra ciclos concorrentes |
| Conteúdo | Página, schema, revisão, checkpoint e updates idempotentes | Página/revisão e identidade de operação; leitura por ACL, escrita interna |
| FTS/backlinks | Página de origem/destino, revisão da projeção | GIN FTS; workspace/origem/destino; ambos os lados autorizados |
| Bases e propriedades | Página contêiner, propriedade estável, tipo/configuração, opções | Workspace/base/propriedade; FK composta e validação de schema |
| Valores e relações | Registro/propriedade únicos; coluna tipada conforme propriedade; relações explícitas | Base/propriedade/valor/registro; índices seletivos por tipo e destino |
| Views/templates | Base, configuração tipada e revisão | Base/posição/ID; mudança compartilhada por editor; template referencia apenas escopo permitido |
| Favoritos/recentes | Pessoa/workspace/página únicos | Usuário/workspace/posição; preferência não concede acesso |
| Comentários/âncoras | Página/bloco e posições relativas opcionais; autor imutável | Página/conversa/data/ID; acesso ao conteúdo obrigatório |
| Arquivos | Objeto, workspace, página, dono, estado staging/finalizado | Página e objeto únicos; Storage privado e vínculos sob ACL |
| Publicação/jobs/auditoria | Escopo, revisão/estado, ator e permissões | Escopo/ator/status; payload público whitelisted; jobs isolados |

Sem tabela de valor livre que aceite todos os tipos sem constraint. Título tem fonte única na página; timestamps são de servidor. Alterar schema não converte valores silenciosamente. Toda associação cruzada carrega workspace verificável; toda tabela nova exige política negativa em testes.

## Ordem e pesquisa

Chaves fracionárias textuais com comparação ordinal, sem ponto flutuante; algoritmo próprio ou biblioteca de licença compatível com testes baseados em propriedades. Inserção/movimento relacional calcula posição no servidor e serializa o intervalo por pai, com desempate de ID e rebalanceamento transacional quando necessário. Não usar collation localizada nas chaves. A árvore de páginas não vira CRDT por usar Yjs no corpo.

FTS por página com peso maior no título, vetores em português/inglês e normalização de acentos consistente entre indexação e consulta. Consulta tolerante a termos comuns, sem concatenar SQL e sem revelar trecho não autorizado. PostgreSQL oferece [configuração, ranking e índices FTS](https://www.postgresql.org/docs/current/textsearch.html); a combinação concreta é decisão do Bloco e será testada no Supabase versionado. No M2 indexa título; M3 conecta projeção do corpo.

## Prova de maior risco antes de consolidar o modelo

M1 deve testar, em fixture sem UI de produto final: duas instâncias Yjs/TipTap; edições simultâneas no mesmo texto; mover/editar/apagar bloco em paralelo, inclusive filho de toggle, tabela e coluna; duplicação e reordenação de updates; reconexão sem evento; CAS/projeções concorrentes; compactação durante bootstrap; revogação com canal aberto; undo local. Critério: convergência e preservação de cada operação aceita com semântica documentada, sem duplicar identidade de bloco ou perder texto aceito em movimento.

Se o binding padrão não atender a estrutura concorrente, **não** marcar o spike verde ou prometer resolver no M5. Registrar evidência, propor adaptação de modelo de árvore/identidade ou alternativa de armazenamento e retornar à decisão cara antes de fixar migrations de conteúdo. Nenhuma prova foi executada nesta fase.

## Toolchain e evolução

Node 24 LTS disponível. Versões exatas compatíveis de Next/React/TipTap/Yjs/Supabase/pnpm serão verificadas em fontes oficiais e fixadas com lockfile no M1, sem assumir que a versão mais nova de cada pacote compõe um conjunto válido. Runtime Node para validação pesada de documento; Supabase Edge Functions apenas para tarefas compatíveis e lotes delimitados. APIs HTTP do produto têm schemas versionados e IDs opacos próprios; nenhuma compatibilidade de endpoint com Notion é objetivo.
