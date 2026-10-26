# Fluxos e interações-chave

P indica capacidade documentada, sem execução local; D descreve o contrato próprio. Textos de controles e aparência serão originais. Fontes por código em [fontes públicas](public-sources.md).

| Fluxo | Referência P, em alto nível | Contrato D para implementar |
| --- | --- | --- |
| Criar e organizar página | P-13: página tem metadados e parentesco | Criar no workspace ou filha; focar título; manter URL estável; mover sem ciclos e sem alterar filhos |
| Inserir bloco | P-01/P-02: menu contextual por comando | `/` em contexto elegível abre catálogo próprio; busca por nome/tipo; setas, Enter e Esc; cancelar preserva texto literal |
| Markdown | P-02: padrões digitados transformam texto | Regras de entrada próprias; não disparar durante IME, código ou colagem; conversão é uma ação reversível |
| Selecionar | P-02: seleção de blocos e extensão por teclado | Distinguir cursor de texto, intervalo e seleção estrutural; pais incluem filhos; teclado e mouse chegam ao mesmo modelo |
| Arrastar | P-01/P-03: mover unidades e formar colunas | Alça original; destino anunciado; operação única; alternativa por teclado; ciclo/destino sem acesso é recusado |
| Transformar | P-01: alterar tipo de conteúdo | Preservar texto e identidade quando representável; conversão destrutiva não é silenciosa |
| Desfazer/refazer | P-01: revisão de ações locais | Histórico local por página; desfazer não reverte edição remota; exclusões estruturais e transformações agrupadas |
| Buscar e referenciar | P-10/P-02: localizar conteúdo e criar referências | Buscar somente conteúdo autorizado; navegar com teclado; menção por ID estável e rótulo atualizado |
| Criar base | P-04: base inteira/inline, registros como páginas | Mesma base pode ser referenciada inline; não duplicar dados ao mudar apresentação |
| Configurar view | P-05: layouts e critérios independentes | Selecionar layout, filtrar, ordenar, agrupar; alteração de view não recria registros |
| Criar com template | P-07: conteúdo e campos predefinidos | Copiar valores e documento com novas identidades; mudanças posteriores no template não alteram instâncias |
| Compartilhar | P-08: escolher destinatário e acesso | Selecionar membro/papel, mostrar acesso efetivo; publicação explícita e revogável por página |
| Remover/restaurar | P-09: lixeira e recuperação | Ocultar subárvore; restaurar posição possível; se pai indisponível, restaurar na raiz com aviso |
| Importar | P-11: formato de exportação contém arquivos distintos | Usuário fornece ZIP; prévia, mapeamento, relatório de perdas e confirmação antes de persistir |

## Amostra documental de atalhos da referência

P-02 documenta busca com Ctrl/Cmd+K; B/I/U para ênfase; Enter/Shift+Enter para novo bloco/quebra; Esc para seleção; Shift+setas para ampliar; Tab/Shift+Tab para aninhar; Ctrl/Cmd+Shift+setas para mover; `#`/`##`/`###` para títulos, `-` para lista, `[]` para tarefa, `>` para toggle e aspas para citação, seguidos de espaço. O mapeamento do Bloco em [editor](../spec/editor.md) é uma decisão de produto, com conflitos do navegador resolvidos explicitamente.

## O que continua desconhecido

Não foram observados limiares de drag, foco real após cada comando, comportamento do teclado ABNT2, composição IME, sequência exata de undo em conflitos e movimentos simultâneos. Não se deduz nenhuma garantia de concorrência do app a partir do pacote estático. O MVP terá seus próprios critérios de aceitação.

Se o usuário exigir reprodução exata de um desses detalhes, pedir somente uma captura ou gravação que ele produza em página fictícia, sem nomes, e-mails ou conteúdo de conta: abrir `/` e cancelar; selecionar e mover três blocos; digitar em IME e desfazer; duas sessões editando e movendo o mesmo bloco. Não acessar nem operar a UI para obtê-las.
