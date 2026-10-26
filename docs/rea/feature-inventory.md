# Inventário funcional da referência e recorte do Bloco

Autoridade: P, documentação oficial listada em [fontes](public-sources.md). Nenhuma linha abaixo afirma observação em execução local. As colunas de entrega são D, derivadas da missão do usuário. Paridade significa o conjunto explicitado do MVP, não todos os recursos atuais da referência.

## Conteúdo

| Família | Capacidade documentada | Entrega D |
| --- | --- | --- |
| Texto | Parágrafos, três níveis de títulos, listas e tarefas (P-01/P-12) | M3, todos obrigatórios |
| Organização | Conteúdo recolhível, citações, destaques, divisores (P-01/P-12) | M3: toggle, citação, callout, divisor |
| Técnico | Bloco de código e conteúdo inline formatado (P-01/P-12) | M3: highlight; negrito, itálico, sublinhado, tachado, código, link e cor |
| Mídia | Imagens e anexos como unidades (P-12) | M3: upload privado Supabase Storage |
| Estrutura visual | Tabela simples e colunas (P-03) | M3; tabela não tem schema de database |
| Referências | Páginas aninhadas e links entre páginas (P-12/P-13) | M2/M3: árvore, menção de página e backlinks autorizados |
| Operações | Inserir, selecionar, mover e transformar unidades (P-01/P-02) | M3: slash, Markdown, drag, seleção, undo/redo e autosave |

## Organização e acesso

| Capacidade | Referência P | Entrega D |
| --- | --- | --- |
| Páginas | Metadados e relações de conteúdo (P-13) | M2: CRUD, hierarquia, posição, capa/ícone, breadcrumbs |
| Navegação | Busca de páginas/conteúdo (P-10; atalho em P-02) | M2: busca rápida FTS e favoritos pessoais |
| Recuperação | Remoção e restauração de páginas (P-09) | M2: lixeira recuperável, sem purge automático no MVP |
| Compartilhamento | Conceder e revisar acesso; link web (P-08) | M1/M5: membros, quatro papéis e público somente leitura |
| Colaboração | Comentários em conteúdo (P-01) | M5: presença, cursores, comentários e edição simultânea sem perda |
| Intercâmbio | Markdown/CSV/arquivos em exportação (P-11) | M6: export próprio e import de ZIP fornecido pelo usuário |

## Databases

P-04/P-05 documentam registros que são páginas e múltiplas views sobre os mesmos dados. P-06 documenta propriedades tipadas. P-07 documenta templates associados à base. A API pública distingue o contêiner e suas fontes de dados (P-14/P-15); isso não é evidência do banco interno da aplicação.

| Aspecto | Entrega D obrigatória no M4 |
| --- | --- |
| Contêiner | Base como página ou referência inline, um schema por base no MVP |
| Propriedades | Título, texto, número, select, multi-select, data, checkbox, URL, pessoa, relação, criado em, editado em |
| Views | Tabela, board, lista, calendário e galeria |
| Configuração | Filtros combinados, múltiplas ordenações, agrupamento e visibilidade de propriedades |
| Registros | CRUD, abrir corpo como página, valores validados, templates de linha |
| Relações | Ligações entre registros de bases do mesmo workspace, sem rollups |

## Capacidades reconhecidas e excluídas

Fórmulas, rollups, offline, apps nativos, IA, integrações e histórico de versões estão fora por decisão explícita do usuário. Timeline, gráficos, formulários, fontes múltiplas por base, automações, blocos sincronizados e controles corporativos encontrados na documentação também não são requisitos de equivalência deste MVP. Não serão introduzidos silenciosamente. Nenhum catálogo de templates, asset ou estilo da referência será usado.
