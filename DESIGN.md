---
name: Bloco
description: Sistema mineral/editorial para autenticação, páginas, editor de blocos, bases de dados e trabalho em equipe.
colors:
  accent: "#344cb7"
  on-accent: "#ffffff"
  accent-soft: "#e4e8fa"
  accent-dark: "#bccaff"
  on-accent-dark: "#172446"
  accent-soft-dark: "#2b3e65"
  copper: "#934626"
  copper-dark: "#e9ab87"
  error: "#9d2727"
  error-dark: "#ffb2ae"
  paper: "#f7f3ea"
  surface: "#fffdf8"
  panel: "#eeeae1"
  ink: "#252c3b"
  muted: "#5d625f"
  line: "#d7d7ce"
  paper-dark: "#131d29"
  surface-dark: "#182534"
  panel-dark: "#1d2c3c"
  ink-dark: "#edf1f5"
  muted-dark: "#b3c1cc"
  line-dark: "#3b4e60"
  focus-dark: "#c4d0ff"
  editor-green: "#255d44"
  editor-green-dark: "#b1d9c7"
  editor-yellow: "#6b530c"
  editor-yellow-dark: "#e8d593"
  editor-green-soft: "#deeee4"
  editor-green-soft-dark: "#1c3d31"
  editor-red-soft: "#f7dedb"
  editor-red-soft-dark: "#4b2b33"
  editor-yellow-soft: "#f3ebc8"
  editor-yellow-soft-dark: "#453d1c"
  editor-copper-soft: "#f3e2d7"
  editor-copper-soft-dark: "#4b342a"
typography:
  headline:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "clamp(1.8rem, 4vw, 2.3rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "1.2rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.6
  supporting:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  editor-body:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  editor-code:
    fontFamily: '"Cascadia Code", Consolas, monospace'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  control: "7px"
  editor-inline-control: "4px"
  editor-selection: "5px"
  editor-block: "6px"
  editor-menu: "8px"
spacing:
  compact: "10px"
  control: "12px"
  related: "16px"
  form: "18px"
  group: "24px"
  section: "28px"
  heading: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-quiet:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation-current:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  feedback:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  page-list-link:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "12px"
  search-result-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    padding: "12px"
  editor-action:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.editor-block}"
    padding: "8px 12px"
  editor-command-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.editor-selection}"
    padding: "8px 12px"
---

# Sistema visual: Bloco

## Visão geral

**Direção criativa: "Mineral/editorial"**

O sistema entregue combina papel quente, tinta azulada e planos discretos para autenticação, navegação de workspace, organização de páginas, escrita por blocos e gestão de equipe. O ritmo editorial aparece na hierarquia tipográfica e no espaço entre grupos; os controles mantêm uma linguagem operacional de uso frequente. Listas de páginas e subpáginas usam linhas contínuas e espaço aberto; o editor mantém o texto no mesmo plano de trabalho.

O símbolo autoral de três lâminas e o ponto cobre identificam o produto. A tipografia do sistema e os temas claro/escuro preservam a direção aprovada em PRODUCT.md e na ADR-006. Este registro deriva de `src/app/globals.css`, `src/features/pages/pages.css`, `src/features/editor/ui/editor.css`, `src/features/databases/databases.css`, dos componentes compartilhados e das superfícies implementadas até o M4. As capturas sintéticas ficam em `.impeccable/review/`; no M4, `desktop.png` e `mobile-dark.png` registram a composição da base. Os padrões de colaboração do M5 permanecem fora deste registro.

**Características principais:**

- Planos de papel separados por tom e linhas finas.
- Índigo para ação, seleção e orientação; cobre na marca e no conteúdo do editor.
- Controles discretamente arredondados e foco explícito.
- Símbolos SVG autorais com traço consistente.
- Páginas em listas de linhas; busca sobreposta e árvore lateral compacta.
- Escrita contínua, ferramentas compactas e salvamento com retorno textual.

## Cores

A paleta associa neutros quentes no claro e petróleo no escuro aos mesmos papéis semânticos. O frontmatter registra os valores usados; o CSS alterna os papéis quando o tema muda.

### Primárias

- **Índigo de ação** (`accent`, `on-accent`): botões principais, links, ícones e destaque da navegação atual.
- **Índigo diluído** (`accent-soft`): seleção de texto, navegação ativa, resultado de busca selecionado, favorito ativo, avatar, etiquetas e feedback informativo.
- **Contrapartes escuras** (`accent-dark`, `on-accent-dark`, `accent-soft-dark`): mantêm a hierarquia no petróleo. O foco usa o índigo de ação no claro e `focus-dark` no escuro.

### Secundárias

- **Cobre de assinatura e conteúdo** (`copper`, `copper-dark`): ponto da marca, código inline, números/propriedades no código e cor de texto escolhida no editor. A versão clara implementada ajusta a candidata inicial da ADR-006.
- **Vermelho de erro** (`error`, `error-dark`): mensagens de falha; a mensagem textual conserva o significado além da cor.
- **Cores de conteúdo** (`editor-green`, `editor-yellow` e fundos `editor-*-soft`, com pares escuros): formatação escolhida para texto/fundo. O verde também distingue strings no código. A paleta de conteúdo reutiliza índigo, cobre e vermelho existentes; não cria novos estados de navegação.

### Neutras

- **Papel** (`paper`): fundo de trabalho.
- **Superfície** (`surface`): campos, barra de contexto e botões secundários.
- **Painel mineral** (`panel`): navegação lateral e faixa de autenticação.
- **Tinta** (`ink`) e **texto secundário** (`muted`): hierarquia de leitura.
- **Linha** (`line`): limites de controles, divisórias e linhas de tabela.
- Os tokens com sufixo `-dark` preservam esses mesmos papéis no tema escuro.

**Regra do Acento Funcional.** Use índigo para indicar ação e estado da interface; cores aplicadas ao conteúdo e ao código conservam função de leitura, sem redefinir estados da navegação.

## Tipografia

A família operacional é Segoe UI, com alternativa do sistema e sans-serif. Não há fonte baixada ou recuperada da referência. Os papéis no frontmatter descrevem títulos de trabalho, corpo e controles; não estabelecem uma voz de destaque reutilizável.

Os títulos têm quebra equilibrada. O corpo usa entrelinha aberta; descrições principais limitam a largura de leitura (até 65ch), enquanto mensagens auxiliares são menores. Cabeçalhos de tabela e rótulos de contexto usam uma escala compacta (12px). Botões elevam o peso do rótulo (600).

No M2, os títulos das listas usam escala de corpo com peso de seção. O nome editável da página usa a mesma família em escala maior, reduzida no móvel; é um campo de metadados. Árvore e breadcrumbs usam o papel auxiliar. Os títulos longos quebram nas listas e nos resultados; a árvore conserva uma linha com reticências.

O M3 estabelece corpo de escrita com entrelinha própria e títulos de bloco em três níveis (32px, 26px e 21px; peso 600, entrelinha 1.3). Código usa a família monoespaçada do frontmatter, preserva espaços e rola horizontalmente; código inline reduz o corpo (0.9em). Menus combinam nome de comando (14px/600) e descrição auxiliar (12px); os seletores de cor conservam rótulos visíveis.

**Regra da Hierarquia de Trabalho.** Diferencie títulos, texto e ações por escala e peso da mesma família operacional; mantenha os rótulos visíveis junto aos campos. O campo de nome da página usa nome acessível associado.

## Composição

A estrutura usa navegação lateral recolhível (256px), barra de contexto com altura mínima (72px) e área principal limitada (1280px). O conteúdo recebe respiro fluido nas laterais; formulários mantêm grupos próximos e seções separadas. O conjunto de espaçamentos registrado é recorrente, não uma grade universal de múltiplos de quatro.

A autenticação combina painel de marca e formulário limitado (392px). Abaixo do limite móvel (800px), o painel lateral desaparece, a marca acompanha o formulário e o conteúdo ocupa uma coluna. O workspace também passa a uma coluna; a navegação abre em diálogo lateral (até 300px ou 85vw). Tabelas preservam as colunas com rolagem horizontal. Formulários em linha quebram linha; suas ações principais passam à largura disponível no móvel.

A página organiza breadcrumbs, capa opcional, ações de acesso/favorito, metadados, editor, subpáginas e organização recolhível em sequência vertical. Favoritos reutilizam a lista de páginas. A lixeira mantém itens em fluxo vertical, separados por linha, com restauração junto ao item. A árvore recua por nível e limita o recuo em hierarquias profundas. A busca tem largura limitada e margem lateral preservada; seu conteúdo rola dentro da janela. No móvel, os cabeçalhos de seção e os controles de capa podem quebrar linha.

O editor começa após divisória e respiro (16px); os blocos textuais permanecem em fluxo, com controles laterais e recuo próprio. Filhos recuam (24px; 14px no móvel). A toolbar conserva uma linha com rolagem horizontal e ocupa a largura disponível no móvel. Colunas usam larguras relativas e intervalo (24px), passando a uma coluna com intervalo menor (16px) no limite móvel existente. Tabelas simples preservam células e rolam dentro do bloco. Menus de slash/menção ficam limitados à janela, com margem mínima lateral (8px) e rolagem interna.

**Regra do Plano de Trabalho.** Organize conteúdo por títulos, respiro e divisórias; páginas, subpáginas, lixeira e equipe mantêm listas contínuas no plano da página.

## Elevação e profundidade

Os planos de trabalho são planos: diferença tonal e borda fina constroem profundidade. A sombra ambiente fica no controle flutuante de tema, nos diálogos e nos menus sobrepostos do editor; a navegação móvel usa sombra lateral e fundo translúcido de sobreposição. Os diálogos também escurecem o contexto atrás deles. Callout e código recebem fundo tonal no fluxo. Os valores completos ficam nas extensões do sidecar, fora do esquema de tokens do frontmatter.

**Regra da Sobreposição Visível.** Reserve sombra ambiente para controles flutuantes, menus, diálogos e navegação sobreposta; mantenha tabelas, listas e formulários no plano da página. O realce fino de foco ou seleção pertence ao estado do elemento.

## Formas

Campos, botões, feedback e navegação compartilham cantos suavizados pelo token `control`. Bordas de um pixel definem limites sem relevo. Etiquetas de acesso são cápsulas; o avatar de inicial é um pequeno quadrado arredondado. Esses formatos têm funções distintas e não substituem a geometria dos controles.

Os ícones da interface são SVG de contorno, com espessura consistente (1.65), extremidades e junções arredondadas. As três lâminas reaparecem como assinatura em diferentes tamanhos. Um emoji escolhido como ícone de página pertence ao conteúdo do usuário e não define a iconografia da interface. A estrela do favorito passa de contorno a preenchimento quando ativa. Capas usam o arredondamento de controle e recorte central; são conteúdo opcional, sem imagem de marca padrão.

O editor introduz cantos compactos em controles inline, seleção, blocos tonais e menus; o frontmatter registra os papéis recorrentes. Imagens mantêm proporção, cabem na largura do conteúdo e usam contenção, sem recorte editorial obrigatório.

## Componentes

### Botões

Botões principais usam índigo e texto de contraste; secundários usam superfície e linha; ações discretas mantêm fundo transparente com borda. O mínimo de altura é confortável para toque (46px). Ao passar o cursor, o brilho é reduzido (0.94); pendência desabilita o botão, reduz opacidade (0.65) e atualiza o texto. Botões de ícone mantêm alvo quadrado (44px).

### Entradas e campos

Campos e seletores usam superfície, linha e o mesmo arredondamento dos botões. A altura mínima acompanha os botões (46px); rótulo e ajuda ficam associados ao controle. O texto de exemplo usa a cor de texto secundário e o cursor usa índigo. O foco visível global tem contorno (3px), com afastamento (4px).

### Navegação

Linhas de navegação têm alvo mínimo (44px). Ao passar o cursor, o fundo usa superfície; a página atual usa índigo diluído, texto de ação e peso elevado. O desktop permite recolher a lateral; o móvel abre diálogo modal, aceita Escape e devolve foco ao acionador ao fechar. Links auxiliares de autenticação têm alvo de altura mínima (44px).

### Listas de páginas e árvore

Páginas e subpáginas compartilham linhas com ícone, título e seta de destino. O link tem altura mínima (62px), texto de tinta e fundo de superfície no hover. O controle de movimento é separado do link; aceita teclado com Espaço, setas e Escape. Durante o arraste, o destino para colocar dentro de outra página aparece com borda tracejada e recebe índigo quando ativo. A árvore separa expansão e navegação, usa alvos mínimos (44px) e mostra seleção tonal no link atual. A paginação mantém ações textuais explícitas.

### Busca rápida

Um diálogo de superfície, borda fina e cantos suavizados contém campo de busca, resultados e instruções de teclado. A busca abre pelo acionador ou Ctrl/Meta K, coloca foco no campo e aceita setas/Enter; Escape fecha e restaura o foco. Resultados têm altura mínima (48px); hover e seleção compartilham o índigo diluído. Os símbolos não encolhem junto de títulos longos. Estado vazio, busca em andamento, falha e mais resultados aparecem como texto. O mesmo tratamento de diálogo serve à confirmação de movimentos que alteram acesso.

### Metadados, capa e favorito

O nome editável tem fundo transparente em repouso, linha inferior no hover e superfície no foco. Título e ícone têm salvamento explícito. A capa privada usa largura disponível, altura fluida e imagem central recortada; adicionar, trocar, remover e cancelar envio usam os botões existentes, com retorno textual junto aos controles. Favorito é um botão quadrado com estado pressionado, fundo de seleção e estrela preenchida; o nome acessível muda com o estado.

### Organização e lixeira

Mover página e enviar à lixeira ficam em seção recolhível com divisória. Ações de risco têm confirmação textual e checkbox; o botão de remoção usa texto de erro sobre fundo transparente. Cada item da lixeira associa título, data e formulário de restauração; o destino alternativo aparece quando o local original é desmarcado. Esses formulários reutilizam campos, botões e feedback existentes.

### Mensagens de retorno

Mensagens informativas usam fundo de seleção e borda; erros usam superfície e texto de erro. O conteúdo quebra palavras longas. As mensagens de formulário recebem foco após a resposta e distinguem status de alerta.

### Escrita e ferramentas do editor

Cada bloco conserva sua área textual ao transformar ou mover; títulos, listas, tarefas, citação e código mudam apresentação sem substituir o texto. O corpo mantém cursor índigo, quebra de palavras e foco local por linha fina. A seleção estrutural usa fundo índigo diluído; arraste tem anúncio e operação por teclado. Ações de bloco ficam em painel sobreposto com duplicação, transformação, remoção e destino textual para movimento.

A toolbar reúne marks, link e seletores de cor com rótulos visíveis. Botões mantêm estado pressionado e alvo mínimo (44px); setas, Home e End percorrem controles disponíveis. Tarefas associam a ação de concluir ao texto do item e centralizam o checkbox em área (44 × 44px). Toggle conserva botão de expandir/recolher e estado acessível.

### Blocos compostos e mídia

Citação usa linha lateral e recuo; callout usa fundo de seleção e seletor de tom. Código usa painel, borda fina, linguagem visível e coloração sintática por papel. A tabela simples combina cabeçalho tonal, células delimitadas e seleção retangular com fundo e contorno de ação; os comandos de seleção e limpeza têm instrução textual, independente da seleção estrutural de blocos. Colunas expõem largura relativa, adição e remoção; remover pede confirmação e informa a transferência dos blocos à vizinha, com foco de retorno.

Imagens e arquivos privados usam placeholder tonal, legenda e controles associados. A imagem permite descrição e largura; o arquivo mostra nome e tamanho no link. Envio comunica preparação, progresso, confirmação, cancelamento e nova tentativa junto ao bloco; estados de trabalho usam `aria-busy`, progresso nomeado e retorno de status.

### Menus e diálogos do editor

Slash e menção compartilham superfície, linha fina, sombra ambiente, título e opções tonais. O foco continua na caixa de texto, que referencia a lista e a opção ativa; setas percorrem, Enter escolhe e Escape fecha. Opções de slash têm nome e descrição, agrupadas por função. Menção comunica busca, vazio e falha, apresentando títulos obtidos por consulta autorizada. Links e confirmações de tabela/coluna reutilizam diálogo modal com fundo escurecido, ações explícitas e recuperação de foco.

### Salvamento e rascunhos

Uma linha de status antecede as ferramentas e comunica carregamento, alterações locais, envio, salvo, falha, acesso indisponível e versão incompatível por texto, com anúncio discreto. A falha oferece nova tentativa; alterações pendentes oferecem cópia do rascunho e continuam identificadas na sessão. Rascunhos de outra página aparecem em faixa de superfície, com ações para voltar e copiar. Sair aguarda envio e pede confirmação nativa se ainda houver alterações não confirmadas; o controle fica ocupado durante a operação. Esse tratamento não estabelece modo offline nem recuperação após encerrar a sessão.

**Regra do Estado Recuperável.** Mantenha status e ação de recuperação próximos ao conteúdo afetado; pendência, falha e indisponibilidade precisam de mensagem textual.

### Bases de dados

Abas tonais e roláveis alternam tabela, board, lista, calendário e galeria. Tabela e calendário mantêm rolagem interna; o board conserva colunas horizontais, enquanto lista e galeria ajustam os registros à largura disponível. Grupos usam títulos e divisórias; cartões de registro têm superfície e borda fina, sem sombra.

O título abre o registro; a edição do valor fica em controle separado. Campos tipados mantêm rótulos visíveis, ações de salvar/cancelar e erro junto ao rascunho. Controles têm altura mínima (44px), foco explícito com afastamento local (2px) e números tabulares nas views de dados. Opções reutilizam as cores de conteúdo existentes.

Filtros aninhados, ordenações, propriedades e templates ficam em painéis recolhíveis e grupos delimitados; controles quebram linha no móvel. Configurações e confirmações usam diálogo de superfície, sombra ambiente, fundo escurecido, Escape e retorno de foco. A prévia de alteração de propriedade explica o alcance antes da confirmação.

A galeria recorta a capa autorizada preservando a largura do cartão; ausência de capa tem fallback textual. Calendário separa registros sem data, apresenta o dia em cada célula e oferece destino de data explícito. Pendência desabilita ações específicas; falha e consulta vazia têm retorno textual. Nenhum token novo de marca é introduzido pelo M4.

### Equipe e etiquetas

A tabela separa pessoas por linhas finas, alinha ações com os dados e usa cabeçalhos compactos. Etiquetas de acesso usam fundo índigo diluído e texto de ação; não são botões. O avatar mostra uma inicial com os mesmos papéis de cor.

As transições se limitam a cor e fundo dos botões e da navegação (140ms, ease-out), habilitadas apenas quando a preferência de movimento reduzido permite. Não existe animação de abertura estabelecida pelo CSS entregue.

## Recomendações e restrições

### Recomendações:

- **Use** os papéis semânticos correspondentes ao tema, incluindo seleção de texto, cursor e foco.
- **Preserve** rótulos, estados de pendência e mensagens de recuperação junto à ação.
- **Use** SVG autoral consistente e divisórias finas para estruturar o trabalho.
- **Reutilize** as listas por linhas para páginas e subpáginas, com controles de navegação e movimento separados.
- **Preserve** texto e foco nas operações do editor; menus inline relacionam a caixa de texto à opção ativa.

### Restrições:

- **Não importe** identidade, fontes, ícones ou estilos recuperados do produto de referência.
- **Não trate** uma cor candidata da ADR como valor implementado; os tokens deste registro descrevem o CSS entregue.
- **Não promova** medidas pontuais de uma superfície a uma regra global.
- **Não confunda** salvamento pendente na sessão com garantia de modo offline ou rascunho persistente após fechar o navegador.

Não canonizados: o título ampliado em fonte de sistema da lateral de autenticação, o espaçamento pontual entre letras da marca (-0.045em), o glifo de exclamação do callout, o rótulo acima do título da base e o glifo do fallback de galeria não viram padrões reutilizáveis; são desvios do piso de acabamento para voz de destaque, espaçamento, rótulo introdutório e iconografia. A família operacional aprovada permanece registrada para títulos de trabalho, corpo e controles; letras de formatação são abreviações do comando.
