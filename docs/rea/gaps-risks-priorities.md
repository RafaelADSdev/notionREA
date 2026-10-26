# Lacunas, riscos e MoSCoW

Status de execução e decisões pendentes pertencem exclusivamente a [PLAN](../PLAN.md). Aqui ficam o diagnóstico e a priorização contratual.

## Lacunas da análise

| Lacuna | Consequência | Resolução proposta |
| --- | --- | --- |
| Integridade contraditória de seis arquivos complementares | Não afirmar autenticidade integral do instalado | Manter evidência limitada; não depende dela a implementação |
| Oito fontes estáticas não concluídas e grafo parcial | Ausência de achado não prova ausência de recurso | Não reconstruir implementação; usar contratos públicos/originais |
| Nenhuma interação observada no app | Detalhes de foco, drag e conflitos não confirmados | D explícitas; captura do usuário somente para paridade exata |
| Nenhum export real do usuário foi lido | Variações de ZIP/CSV ainda não exercitadas | Corpus sintético e fixture voluntária anonimizada no M6 |
| API pública e UI possuem modelos distintos | Não inferir armazenamento interno ou equivalência completa | Modelo conceitual próprio, sem replicação da API |
| Fontes públicas mudam e algumas consultas tiveram timeout | Não tratar documentação como prova da versão instalada | Data/autoridade registradas; comportamentos não comprovados ficam D/U |

## Riscos de produto e execução

| Risco | Impacto | Tratamento e gate |
| --- | --- | --- |
| Movimentação de nós + edição concorrente em CRDT | Perda ou duplicação de conteúdo apesar de convergência | Prova M1 antes de consolidar schema; falha exige rever ADR, sem reduzir requisito |
| Broadcast não é registro durável | Updates ausentes após reconexão | Persistência antes de ACK, dedupe, catch-up e compactação testada |
| Projeção de busca divergente do conteúdo | Busca/backlinks incorretos ou vazamento | Validação confiável e revisão atômica; leitura sempre sob ACL |
| Revogação de canais já conectados | Conteúdo pode continuar chegando | Não distribuir texto sensível por Broadcast; sinalizar revisão e reautorizar fetch durável |
| JSON rich text ou arquivo hostil | XSS, memória excessiva, exposição | Schema permitido, sanitização, limites, bucket privado e render seguro |
| ZIP malicioso ou CSV interpretado como fórmula | Escrita indevida ou execução ao abrir export | Pré-validação, limites expandidos, paths seguros e saída CSV protegida |
| Propriedade/view concorrente | Sobrescrita silenciosa de célula/configuração | Revisão por entidade/célula, conflito explícito e retry controlado |
| Escopo amplo | Marcos longos e integração tardia | Fatias verificáveis dentro de cada marco; pausas do usuário preservadas |
| Licenças de extensões prontas | Dependência comercial involuntária | Core aberto, inventário por versão; colunas/controles próprios |
| Virtualizar editor rico | Quebra de seleção, IME e acessibilidade | Perfil e prova de seleção antes de virtualizar conteúdo editável no M6 |

## MoSCoW do MVP

| Prioridade | Escopo | Regra de entrega |
| --- | --- | --- |
| Must | M1: stack, auth e Google, workspaces/membros, RLS, layout/temas, CI e documentação | Todos obrigatórios |
| Must | M2: árvore sem teto de profundidade, CRUD/drag/ordem, ícone/capa, breadcrumbs, favoritos, lixeira e FTS | Todos obrigatórios |
| Must | M3: todos os tipos/marks da missão, comandos, Markdown, menção, drag/transformação, undo/redo e autosave | Todos obrigatórios |
| Must | M4: base inteira/inline, 12 tipos de propriedade, cinco views, filtros/ordenação/agrupamento e templates | Todos obrigatórios |
| Must | M5: presença/cursores, simultaneidade sem perda, comentários, quatro papéis e link público de leitura | Todos obrigatórios |
| Must | M6: Markdown/CSV, ZIP do Notion, pt-BR/en, WCAG AA, virtualização e preparo Vercel | Todos obrigatórios; segurança/testes/performance não são opcionais |
| Should | Refinos adicionais: redimensionamento manual de colunas, lembrete visual de atalhos | Não bloqueiam o escopo literal; não antecipar trabalho |
| Could | Biblioteca de templates originais e personalização adicional de capas | Somente depois dos Must e com novo escopo |
| Won't | Fórmulas, rollups, offline, nativos, IA, integrações e histórico de versões | Backlog explícito do usuário |
| Won't | Timeline, gráficos, formulários, fontes múltiplas, automações, paridade corporativa | Fora do recorte definido; nova aprovação para incluir |

Should/Could não rebaixam nenhum item solicitado. Uma limitação de importação deve ser comunicada por item; não é licença para ignorar silenciosamente um formato do escopo.
