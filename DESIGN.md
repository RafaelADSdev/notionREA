---
name: Bloco
description: Sistema mineral/editorial para autenticação e trabalho em equipe.
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
rounded:
  control: "7px"
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
---

# Sistema visual: Bloco

## Visão geral

**Direção criativa: "Mineral/editorial"**

O sistema entregue combina papel quente, tinta azulada e planos discretos para tarefas de autenticação, navegação de workspace e gestão de equipe. O ritmo editorial aparece na hierarquia tipográfica e no espaço entre grupos; os controles mantêm uma linguagem operacional de uso frequente.

O símbolo autoral de três lâminas e o ponto cobre identificam o produto. A tipografia do sistema e os temas claro/escuro preservam a direção aprovada em PRODUCT.md e na ADR-006. Este registro deriva de `src/app/globals.css`, dos componentes compartilhados e dos domínios de autenticação/workspaces; páginas e editor futuros não têm padrões estabelecidos aqui.

**Características principais:**

- Planos de papel separados por tom e linhas finas.
- Índigo para ação, seleção e orientação; cobre restrito à marca.
- Controles discretamente arredondados e foco explícito.
- Símbolos SVG autorais com traço consistente.

## Cores

A paleta associa neutros quentes no claro e petróleo no escuro aos mesmos papéis semânticos. O frontmatter registra os valores usados; o CSS alterna os papéis quando o tema muda.

### Primárias

- **Índigo de ação** (`accent`, `on-accent`): botões principais, links, ícones e destaque da navegação atual.
- **Índigo diluído** (`accent-soft`): seleção de texto, navegação ativa, avatar, etiquetas e feedback informativo.
- **Contrapartes escuras** (`accent-dark`, `on-accent-dark`, `accent-soft-dark`): mantêm a hierarquia no petróleo. O foco usa o índigo de ação no claro e `focus-dark` no escuro.

### Secundárias

- **Cobre de assinatura** (`copper`, `copper-dark`): ponto da marca. A versão clara implementada ajusta a candidata inicial da ADR-006.
- **Vermelho de erro** (`error`, `error-dark`): mensagens de falha; a mensagem textual conserva o significado além da cor.

### Neutras

- **Papel** (`paper`): fundo de trabalho.
- **Superfície** (`surface`): campos, barra de contexto e botões secundários.
- **Painel mineral** (`panel`): navegação lateral e faixa de autenticação.
- **Tinta** (`ink`) e **texto secundário** (`muted`): hierarquia de leitura.
- **Linha** (`line`): limites de controles, divisórias e linhas de tabela.
- Os tokens com sufixo `-dark` preservam esses mesmos papéis no tema escuro.

**Regra do Acento Funcional.** Use índigo para indicar ação e estado; o cobre pertence à assinatura da marca.

## Tipografia

A família operacional é Segoe UI, com alternativa do sistema e sans-serif. Não há fonte baixada ou recuperada da referência. Os papéis no frontmatter descrevem títulos de trabalho, corpo e controles; não estabelecem uma voz de destaque reutilizável.

Os títulos têm quebra equilibrada. O corpo usa entrelinha aberta; descrições principais limitam a largura de leitura (até 65ch), enquanto mensagens auxiliares são menores. Cabeçalhos de tabela e rótulos de contexto usam uma escala compacta (12px). Botões elevam o peso do rótulo (600).

**Regra da Hierarquia de Trabalho.** Diferencie títulos, texto e ações por escala e peso da mesma família operacional; mantenha os rótulos visíveis junto aos campos.

## Composição

A estrutura usa navegação lateral recolhível (256px), barra de contexto com altura mínima (72px) e área principal limitada (1280px). O conteúdo recebe respiro fluido nas laterais; formulários mantêm grupos próximos e seções separadas. O conjunto de espaçamentos registrado é recorrente, não uma grade universal de múltiplos de quatro.

A autenticação combina painel de marca e formulário limitado (392px). Abaixo do limite móvel (800px), o painel lateral desaparece, a marca acompanha o formulário e o conteúdo ocupa uma coluna. O workspace também passa a uma coluna; a navegação abre em diálogo lateral (até 300px ou 85vw). Tabelas preservam as colunas com rolagem horizontal. Formulários em linha quebram linha; suas ações principais passam à largura disponível no móvel.

**Regra do Plano de Trabalho.** Organize conteúdo por títulos, respiro e divisórias; a lista de equipe usa linhas de tabela, sem transformar cada pessoa em um cartão.

## Elevação e profundidade

Os planos de trabalho são planos: diferença tonal e borda fina constroem profundidade. A sombra ambiente fica no controle flutuante de tema; a navegação móvel usa sombra lateral e fundo translúcido de sobreposição para indicar sobreposição. Os valores completos ficam nas extensões do sidecar, fora do esquema de tokens do frontmatter.

**Regra da Sobreposição Visível.** Reserve sombra para controles flutuantes e navegação sobreposta; mantenha tabelas e formulários no plano da página.

## Formas

Campos, botões, feedback e navegação compartilham cantos suavizados pelo token `control`. Bordas de um pixel definem limites sem relevo. Etiquetas de acesso são cápsulas; o avatar de inicial é um pequeno quadrado arredondado. Esses formatos têm funções distintas e não substituem a geometria dos controles.

Os ícones são SVG de contorno, com espessura consistente (1.65), extremidades e junções arredondadas. As três lâminas reaparecem como assinatura em diferentes tamanhos; não são imagens ou glifos de uma fonte.

## Componentes

### Botões

Botões principais usam índigo e texto de contraste; secundários usam superfície e linha; ações discretas mantêm fundo transparente com borda. O mínimo de altura é confortável para toque (46px). Ao passar o cursor, o brilho é reduzido (0.94); pendência desabilita o botão, reduz opacidade (0.65) e atualiza o texto. Botões de ícone mantêm alvo quadrado (44px).

### Entradas e campos

Campos e seletores usam superfície, linha e o mesmo arredondamento dos botões. A altura mínima acompanha os botões (46px); rótulo e ajuda ficam associados ao controle. O texto de exemplo usa a cor de texto secundário e o cursor usa índigo. O foco visível global tem contorno (3px), com afastamento (4px).

### Navegação

Linhas de navegação têm alvo mínimo (44px). Ao passar o cursor, o fundo usa superfície; a página atual usa índigo diluído, texto de ação e peso elevado. O desktop permite recolher a lateral; o móvel abre diálogo modal, aceita Escape e devolve foco ao acionador ao fechar. Links auxiliares de autenticação têm alvo de altura mínima (44px).

### Mensagens de retorno

Mensagens informativas usam fundo de seleção e borda; erros usam superfície e texto de erro. O conteúdo quebra palavras longas. As mensagens de formulário recebem foco após a resposta e distinguem status de alerta.

### Equipe e etiquetas

A tabela separa pessoas por linhas finas, alinha ações com os dados e usa cabeçalhos compactos. Etiquetas de acesso usam fundo índigo diluído e texto de ação; não são botões. O avatar mostra uma inicial com os mesmos papéis de cor.

As transições se limitam a cor e fundo dos botões e da navegação (140ms, ease-out), habilitadas apenas quando a preferência de movimento reduzido permite. Não existe animação de abertura estabelecida pelo CSS entregue.

## Recomendações e restrições

### Recomendações:

- **Use** os papéis semânticos correspondentes ao tema, incluindo seleção de texto, cursor e foco.
- **Preserve** rótulos, estados de pendência e mensagens de recuperação junto à ação.
- **Use** SVG autoral consistente e divisórias finas para estruturar o trabalho.

### Restrições:

- **Não importe** identidade, fontes, ícones ou estilos recuperados do produto de referência.
- **Não trate** uma cor candidata da ADR como valor implementado; os tokens deste registro descrevem o CSS entregue.
- **Não promova** medidas pontuais de uma superfície a uma regra global.

Não canonizados: o título ampliado em fonte de sistema da lateral de autenticação e o espaçamento pontual entre letras da marca (-0.045em) não viram tokens reutilizáveis; o primeiro é uma recusa de acabamento para voz de destaque, e o segundo fica abaixo do piso de espaçamento entre letras. A família operacional aprovada permanece registrada para títulos de trabalho, corpo e controles.
