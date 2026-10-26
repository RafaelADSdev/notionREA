# Intercâmbio, qualidade e deploy

Origem D: missão e ADR-007/008/009. Testes e segurança se aplicam a cada marco; M6 não é autorização para postergar requisitos básicos.

## Exportação Markdown/CSV

Exportar página/subárvore autorizada para ZIP: Markdown UTF-8 por página, CSV UTF-8 por base e arquivos anexos acessíveis. Links internos relativos preservam referências quando possível; títulos repetidos recebem nomes únicos seguros. CSV usa escape de delimitador/aspas/quebras e neutraliza valores interpretáveis como fórmulas em planilhas, sem alterar o valor canônico no banco. O relatório informa o tratamento aplicado.

Markdown é interoperável, não formato perfeito do documento rico. Títulos/listas/tarefas/quotes/código/links/imagens/tabelas simples usam representação textual; callouts e toggles recebem convenções textuais próprias documentadas; colunas são linearizadas na ordem de leitura. Cor e layout podem se perder, declaradamente. Não exportar HTML executável para preservar aparência. Views, ACL, comentários, cursores e histórico não entram em Markdown/CSV. Criado/editado podem ser colunas informativas; não restauram autoria de sistema.

## Importação de ZIP exportado pelo Notion

Apenas arquivo entregue voluntariamente ao produto pelo usuário. Nenhuma conexão à conta ou API da referência. [A documentação pública](https://www.notion.com/help/export-your-content) descreve Markdown para páginas, CSV para bases, anexos e callouts com representação HTML; isso não garante restauração de todos os recursos originais.

Pipeline: upload privado → validação de arquivo e inventário → prévia e mapeamento de colunas/tipos → confirmação do usuário → importação retomável em lotes → relatório por item. Cancelar antes da confirmação não cria páginas. Job identifica workspace, ator, digest e itens; retry não duplica itens já confirmados. ACL é revalidada em cada lote; falha parcial informa exatamente o que foi criado. Usuário pode remover a raiz importada pela lixeira, sem apagar conteúdo preexistente.

- Recusar ZIP traversal, caminhos absolutos/UNC, dispositivos Windows, links simbólicos, colisões de case/path, arquivos criptografados e entradas aninhadas não suportadas. Validar contagem, razão de expansão, bytes efetivamente expandidos e tempo; não confiar no tamanho declarado.
- Parsear Markdown como dados; sanitizar HTML encontrado, convertendo apenas trechos seguros reconhecidos, e preservar texto legível com aviso quando não houver mapeamento. Nunca executar scripts, resolver includes ou baixar URL externa.
- Reconstituir árvore por diretórios/links e remapear identificadores do export para IDs novos do Bloco. Segundo passe resolve links internos; destino ausente fica como referência externa/texto com aviso. Não reutilizar UUID da origem como identidade interna.
- CSV inicia base e registros; prévia permite mapear os doze tipos suportados. Inferência conservadora começa em texto quando ambígua; nunca adivinhar pessoa por e-mail, relação por título duplicado ou data regional ambígua. Relações só resolvem após mapeamento inequívoco e confirmação; sistema de datas de criação/edição é preservado como texto informativo, sem forjar autoria.
- Arquivos locais do ZIP entram em Storage privado. Remotos continuam links e não são baixados automaticamente. Recursos fora do MVP, views/ACL/comentários e layouts perdidos são listados; não prometer restauração integral de export que não os contém.

Corpus M6: fixtures sintéticas de páginas aninhadas, títulos duplicados, Unicode, links relativos codificados, anexos, tabelas, bases CSV e HTML de callout; adversariais de expansão, traversal, colisão, MIME e fórmula. Fixture real anonimizada é útil, mas não pode exigir acesso à conta. Exportar→importar preserva semântica representável e lista perdas esperadas.

## Idiomas e acessibilidade

pt-BR padrão e en selecionável, com mensagens de erro, datas, números, menus e nomes acessíveis traduzidos. IDs, URLs e valores canônicos não dependem do idioma. Datas civis preservam o dia; instantes exibem fuso escolhido com padrão do navegador, sem assumir o fuso do servidor.

Meta: [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Foco visível, ordem coerente, nomes acessíveis, texto alternativo, regiões semânticas, contraste aferido, zoom e reflow; sem depender só de cor. Diálogos gerenciam foco; menus e grids têm interação documentada; drag possui alternativa por teclado e anúncio; movimento respeita preferência reduzida. Testes automatizados não substituem verificação por teclado e leitor de tela. IME, seleção e leitura de páginas longas fazem parte da validação do editor.

## Capacidade e orçamento propostos

Estes números são metas/limites iniciais D, não resultados medidos. Alterá-los exige ADR, evidência e exposição de impacto; não pode rebaixar os critérios do usuário.

| Dimensão | Contrato inicial |
| --- | --- |
| Listas | 50 itens por página, máximo 100; keyset/cursor, sem offset profundo ou busca integral no cliente |
| Conteúdo longo | Fixture de 5.000 blocos e até 8 MiB canônicos; sem teto de profundidade da árvore; cadeia de 1.000 páginas nos testes |
| Dados de escala | Workspace sintético de 10.000 páginas e base de 50.000 registros; nenhum limite de schema fixado por esses números |
| Updates | Até 256 KiB por request, schema/profundidade validados; bootstrap/chunks de até 512 KiB para não depender de payload grande |
| Anexos | Até 25 MiB por arquivo, upload direto a Storage; imagem não executável, validação antes de finalizar |
| Import | ZIP até 50 MiB, expansão até 250 MiB, até 10.000 entradas e razão máxima 100:1; job privado por lotes retomáveis |
| Interação | Input→paint p95 ≤ 50 ms no cenário de referência; busca p95 ≤ 500 ms de resposta de servidor em base de fixture aquecida |
| Web | LCP ≤ 2,5 s e CLS ≤ 0,1 na página autenticada de referência; INP ≤ 200 ms quando houver dados de campo |
| Sincronização | Duas sessões, 50 ms de latência simulada; atualização aceita visível na outra p95 ≤ 1 s; catch-up não depende de Broadcast confiável |

Aferir em Chromium, viewport 1440×900, região de dados próxima ao runtime, RTT e throttling documentados; registrar máquina, versões, fixture, amostra e percentis no PLAN ao medir. Meta sem medição não passa. Restrições reais de payload/duração do [runtime Vercel](https://vercel.com/docs/functions/limitations) e cotas Supabase serão verificadas para os planos escolhidos, sem prometer capacidade ilimitada.

Índices por workspace/pai/posição, página/revisão, referências e tipos filtráveis; GIN para FTS. Sem N+1: página de resultados exige quantidade limitada de consultas, independente do número de registros; componentes não buscam propriedade por célula. Virtualizar árvore/listas/views e documento longo; no editor, preservar seleção, âncoras, busca, foco e composição. A técnica deve ser validada por benchmark e E2E; não remover conteúdo do modelo canônico para virtualizar.

## Gates por marco implementado

1. `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` e `pnpm test:rls` passam; suites pertinentes não ficam ignoradas. Banco vazio é recriado por migrations e `pnpm db:types:check` não encontra drift.
2. Unitários cobrem invariantes de blocos, posições e filtros conforme surgem; integrações cobrem constraints, RLS de cada tabela e atomicidade; Playwright cobre os fluxos principais reais, inclusive permissões negativas.
3. Inputs validados; rich text sanitizado; `.env.example` e setup atualizados; nenhuma secret/service key no cliente, repositório ou logs. Storage/Realtime recebem testes próprios.
4. Fluxos operáveis por teclado, foco gerenciado, sem violações graves automatizadas conhecidas; índices/paginação/consultas inspecionados. Performance do comportamento novo é medida quando pertinente.
5. Revisar diff, registrar comandos/resultados e riscos no PLAN, commit Conventional Commits em inglês, relatório de até dez linhas e parar aguardando “prossiga”. Não produzir um falso verde quando infraestrutura ou credencial impede execução.

## Preparo de deploy no M6

Vercel hospeda Next.js e funções curtas; Supabase fornece banco/Auth/Storage/Realtime/Edge Functions. Sem servidor WebSocket, Redis, motor de busca ou fila externos. Jobs grandes usam estado persistido e lotes idempotentes, sem depender de uma função manter processo vivo. Ambientes de preview e produção isolados; migrations versionadas antes do código dependente, com caminho documentado de rollback/forward fix e backup validado.

Documentar variáveis públicas versus secretas, domínios e redirect OAuth, serviço de e-mail/configuração de entrega do Supabase, buckets/políticas, quotas, região, CSP, índices, limites e alertas. Checklist inclui smoke de login/e-mail/Google, RLS, revogação pública, uploads, colaboração, export/import, teclado, backup/restauração e observabilidade sem conteúdo pessoal. Credenciais/planos externos e autorização final de publicação são decisões do usuário no momento do deploy; esta fase não cria recursos remotos nem faz deploy.
