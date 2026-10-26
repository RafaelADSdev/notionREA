# Editor de blocos

Origem D: missão; ADR-001/002/003. TipTap/ProseMirror é proposto, com schema próprio e Yjs canônico desde M3. Interface, menu e ícones serão produzidos para o Bloco. Todos os tipos abaixo são obrigatórios.

## Modelo e blocos

Cada bloco tem identidade estável, tipo, atributos validados e conteúdo permitido. Identidade independe do caminho e da posição. Um documento tem versão de schema; cliente incompatível abre somente leitura e orienta atualização, sem descartar nós desconhecidos. Texto canônico não é substituído por snapshot JSON de um cliente.

| Tipo | Conteúdo e comportamento |
| --- | --- |
| Parágrafo | Texto rico; Enter divide preservando marks aplicáveis; Shift+Enter insere quebra |
| H1–H3 | Texto rico e nível; Enter no final volta a parágrafo; sem hierarquia automática de páginas |
| Lista com marcadores/numerada | Itens aninháveis, indent/outdent; enumeração consistente após mover; item vazio sai da lista |
| Tarefa | Texto, estado marcado e filhos; checkbox acessível; mudança é operação desfazível |
| Toggle | Título e filhos; expansão é preferência local; conteúdo recolhido continua pesquisável para autorizados |
| Citação/callout | Filhos de conteúdo; callout tem acento e símbolo originais, sem depender só de cor |
| Divisor | Sem texto; foco/seleção estrutural e remoção por teclado |
| Código | Texto literal, linguagem selecionável e highlight seguro; Tab insere indentação, saída por comando acessível; sem execução |
| Imagem | Upload, texto alternativo, legenda opcional e tamanho; carregamento não move seleção |
| Arquivo | Nome de exibição, tamanho, MIME verificado e download autorizado; sem HTML/SVG executável inline |
| Tabela simples | Células de texto rico, inserir/remover linhas/colunas, cabeçalho opcional e Tab para célula seguinte; sem fórmulas ou propriedades de database |
| Colunas | Grupo com duas ou mais colunas ordenadas, cada uma contendo blocos; em tela estreita empilhar na ordem de leitura; alterar composição sem perder conteúdo |
| Referência de página | Menção inline por identidade e ligação navegável para página/subpágina; aninhamento navegável continua relacional |
| Referência inline de database | Inserida no M4; aponta para base/view com autorização independente |

Não converter mídia/tabelas em texto perdendo dados sem aviso e ação explícita. Transformações textuais preservam texto, marks compatíveis, filhos e identidade; tipo sem suporte a filhos deve exigir escolha explícita para preservar filhos como irmãos. Duplicar gera novas identidades e não duplica o objeto de arquivo; acesso permanece verificado. Blocos desconhecidos importados não são apagados silenciosamente.

## Formatação e menus

Marks: negrito, itálico, sublinhado, tachado, código inline, link e cor de texto/fundo de uma paleta acessível. Não armazenar CSS ou HTML arbitrários. Link aceita protocolos permitidos, rejeita JavaScript/data; links externos usam proteção de navegação. Colar HTML passa por parser/sanitização e schema permitido; colar URL em seleção pode criar link; código permanece literal.

O menu `/` abre em parágrafo vazio ou após separação por espaço, fora de código/IME. Filtra catálogo com aliases em pt-BR/en, agrupa por finalidade, navega com setas, escolhe com Enter, fecha com Esc e restaura o texto literal ao cancelar. Escolher comando consome somente a consulta. Resultados sem correspondência não apagam texto. “Transformar” e ações de bloco estão disponíveis por menu com foco gerenciado, além do slash.

Digitar `@` em texto elegível consulta páginas autorizadas, com título/ícone próprios; Enter cria menção por ID. Renomear atualiza rótulo; sem acesso ou destino removido mostra referência indisponível sem revelar nome antigo. Backlinks são derivados e filtrados, nunca concessões de acesso.

## Entrada por teclado — contrato D

Ctrl equivale a Cmd no macOS. B/I/U aplicam ênfase; Shift+S aplica tachado; E aplica código inline; K com texto selecionado edita link. Sem seleção, K abre busca. Ctrl/Cmd+Z desfaz; Shift+Z refaz, Ctrl+Y também no Windows. Atalhos só interceptam contextos previstos e não capturam AltGr.

Padrões próprios no início de bloco, seguidos de espaço: `#`, `##`, `###` para títulos; `-`, `*`, `+` para marcadores; `1.` para numeração; `[]` ou `[ ]` para tarefa; `>` para toggle; aspas para citação. Três hífens seguidos de Enter criam divisor; três crases abrem código. Padrões inline reconhecem pares de asteriscos, asterisco simples, crase e dois tils. Essas escolhas são documentadas na ajuda do produto e não exigem paridade de todas as variantes da referência.

Não transformar durante composição IME, em bloco de código ou ao colar lote. Undo desfaz uma regra de entrada em uma ação. Tab/Shift+Tab aninham apenas onde há semântica de lista/tarefa; fora desses contextos mantêm navegação de foco. Esc sai de texto para seleção de bloco; Enter retorna; Shift+setas expande seleção estrutural; Delete remove seleção inteira; Ctrl/Cmd+D duplica. Ctrl/Cmd+Shift+setas move a seleção em contexto estrutural; o menu “Mover” oferece alternativa sem atalho conflitante.

## Seleção, drag e histórico

Seleção de texto, intervalo de células e seleção de blocos são estados diferentes. Selecionar pai inclui descendentes uma única vez; mover preserva sua ordem relativa. dnd-kit produz transação do modelo e anúncio de destino; não usa posição DOM como fonte de conteúdo. Cancelar drag não altera documento. Não permitir ciclo, drop em estrutura incompatível ou página sem permissão. Foco retorna ao bloco movido, com rolagem previsível.

Undo é local à sessão/página e ao autor: não desfaz texto remoto. Digitação consecutiva forma grupo; drag, transformar, checklist e remoção são grupos separados. Nova operação local invalida redo correspondente; atualização remota não limpa todo o histórico local. Comentários ancorados preservam identidade em movimentos; âncoras de texto usam posições relativas colaborativas. Conflito mover/editar/apagar deve ter resultado explícito sem sumiço silencioso de edição aceita; é gate do spike M1, não garantia automática de Yjs.

## Salvamento e arquivos

UI otimista imediata; debounce de 500 ms, flush em blur/navegação e aviso ao sair com operações não confirmadas. Estados: alterações locais, enviando, salvo, erro/reconexão. Só mostrar “salvo” após confirmação de persistência durável. Identidade de operação permite repetir envio sem duplicação; confirmação perdida é resolvida por consulta/retry. Buffer em memória permanece até confirmação ou escolha explícita de descarte; erro de acesso oferece copiar o rascunho e mantém leitura bloqueada. Não há modo offline prometido; fechar abruptamente a aba pode perder rascunho ainda não confirmado, sem afetar updates já aceitos.

Storage privado: upload direto assinado, status por bloco, retry/cancelamento, finalização autorizada e limpeza de órfãos com carência. Validar tamanho/tipo/assinatura, nome seguro e vínculo ao workspace/página. Imagem exige descrição editável; anexos não executam conteúdo. Limites e exposição pública seguem [segurança](collaboration-security.md) e [qualidade](interchange-quality.md).

Aceitação M3: corpus de todos os tipos/marks sobrevive serialização, reload e export representável; IME/colar não corrompem texto; todas as operações têm alternativa por teclado; undo local funciona após update remoto; mover preserva ID e comentários; XSS/protocolos maliciosos são recusados; falha de upload é recuperável; autosave tolera duplicação e resposta perdida. Modelo e transformações em Vitest; edição/seleção/IME/drag/upload/reload em Playwright; tabelas e objetos associados sob testes de RLS.
