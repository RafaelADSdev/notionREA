# Databases e views

Origem D: missão e ADR-001/004/005/010. O domínio é relacional; a visualização não muda a identidade ou o conteúdo do registro. Todo item abaixo pertence ao M4.

## Base e registro

Criar uma base inteira cria uma página contêiner, um schema e uma view de tabela inicial. Inserir inline cria uma base própria ou referência explícita a base existente: a UI distingue as duas ações. A referência aponta à base/view, sem copiar registros ou conceder acesso. No MVP uma base possui um único schema; cada registro é uma página com corpo de blocos e pertence a uma base. O título é o título dessa página, sem uma segunda cópia editável.

Editor autorizado pode criar/renomear/remover propriedade, gerenciar opções e configurar views/templates. Remover propriedade informa o alcance e dependências; não a apaga silenciosamente de filtros ou templates. Alterar tipo exige prévia de conversão, preservação dos valores compatíveis e decisão explícita para incompatíveis; operação atômica. Nomes de propriedades/opções são editáveis, mas os IDs não mudam.

## Tipos obrigatórios

| Propriedade | Valor e validação D |
| --- | --- |
| Título | Uma propriedade obrigatória, ligada à página; rótulo renomeável, propriedade não removível |
| Texto | Texto simples multilinha; vazio distinto de ausência quando necessário à importação; limite visível |
| Número | Decimal finito, sem NaN/Infinity; separador localizado só na apresentação; zero não é vazio |
| Select | Uma opção por ID estável; nome/cor próprios; excluir opção exige tratar valores em uso |
| Multi-select | Conjunto de opções únicas; ordem visual configurável; vazio é conjunto vazio |
| Data | Dia civil ou instante com fuso; início e fim opcional; fim não antecede início; sem transformar dia civil em UTC |
| Checkbox | Booleano com padrão falso; filtro por vazio não trata falso como ausente |
| URL | URL normalizada em protocolos permitidos; texto exibido seguro; sem fetch automático de URL fornecida |
| Pessoa | Conjunto de membros do mesmo workspace; não expõe e-mails em views públicas; membro removido não vira vínculo com outra conta |
| Relação | Conjunto de páginas de uma base alvo do mesmo workspace; referências por ID, sem duplicata ou rollup; nunca revela título de destino sem acesso |
| Criado em | Instante de criação da página, gerado pelo servidor e somente leitura |
| Editado em | Instante da última mutação aceita do corpo/metadados/propriedades do registro; servidor, somente leitura |

Formato numérico/cor/moeda não muda o valor canônico. Propriedade removida, opção inexistente ou destino novo/alterado sem acesso causam erro de validação, sem valores órfãos. Referência já aceita no estado canônico é preservada como opaca/indisponível se perder acesso ou entrar na lixeira; isso não bloqueia alteração de campo não relacionado. Reintroduzir destino removido exige nova autorização. Rótulos privados nunca são fornecidos pelo cliente como autoridade. Integridade e isolamento são garantidos no banco, inclusive contra chamadas diretas.

## Views obrigatórias

| View | Interação e aceitação |
| --- | --- |
| Tabela | Colunas são propriedades; células editam por tipo; Enter confirma, Esc cancela, Tab navega; abrir título mostra corpo do registro; colunas configuráveis |
| Board | Agrupa por select ou checkbox; coluna sem valor explícita quando cabível; mover cartão altera o campo do grupo em uma transação; sem campo elegível oferece escolha/criação explícita |
| Lista | Linha compacta com título e propriedades escolhidas; mesma busca/filtro e abertura de registro |
| Calendário | Escolha de propriedade data e mês; registros sem data aparecem em lista acessível; intervalos renderizados sem duplicar entidade; mover por dia preserva semântica de data e horário/fuso |
| Galeria | Cards com capa ou primeira imagem autorizada e propriedades escolhidas; fallback original; navegação por teclado e layout responsivo |

Configuração persistida por view: nome, tipo, campos visíveis/ordem, filtros, ordenações e agrupamento compatível. Editor pode criar, renomear, duplicar e excluir view; não excluir a última. Viewer pode experimentar filtros temporários sem persistir configuração compartilhada. Toda view usa consulta paginada no servidor; esconder coluna ou aplicar filtro **não é** controle de acesso.

## Filtros, ordenação e agrupamento

- Árvore de filtros AND/OR, até cinco níveis e cinquenta condições; operações permitidas pelo tipo, compiladas por whitelist parametrizada. Texto/título/URL: igual, contém, começa, vazio; número: igualdade e comparações; data: antes/depois/intervalo/vazio; select: igual/diferente; conjuntos: contém qualquer/todos/nenhum; checkbox: verdadeiro/falso; campos de sistema usam operações de data. Negação possui semântica explícita de nulo e testes.
- Condições sobre campo removido são mostradas como inválidas e não ignoradas silenciosamente. Comparações nunca geram SQL a partir de nome/fragmento arbitrário do cliente. Relações e pessoas são filtradas por identidades validadas, sem inferência por texto.
- Ordenações têm prioridade e direção; nulos por último em ambas as direções; empate termina em ID estável. Texto usa regra consistente documentada, número compara valor, data compara dia ou instante conforme schema, select segue ordem das opções. Multi-select/pessoa/relação usam chave derivada de IDs ordenados, sem buscar um título proibido.
- Ordenação manual fracionária vale quando não há sort explícito. Com sort ativo, desabilitar drag que apenas reordena registros e explicar; mover cartão de grupo continua permitido, pois altera um valor. Concorrência de célula usa revisão da célula: campos distintos não conflitam artificialmente; mesmo campo apresenta conflito, sem last-write-wins oculto.
- Agrupamento compartilhado por select, multi-select, checkbox ou pessoa nas views compatíveis; uma entidade pode aparecer em vários grupos de conjunto, mantendo seu ID. Board aceita apenas grupo singular. Calendário agrupa por dia; não suporta um segundo eixo de grupos no MVP. Grupo vazio e sem valor têm tratamento explícito. Reordenar grupo não muda seus valores.

## Templates

Criar/editar/duplicar/excluir template por base, com corpo e valores padrão; metadados de sistema não são pré-preenchidos. Criar registro a partir de template gera novos IDs de página/blocos e novos estados CRDT, sem clonar identidades de colaboração. Relações predefinidas mantêm destinos intencionais autorizados e são exibidas na prévia. Alterar template não altera instâncias existentes; sem recorrência ou catálogo externo.

Aceitação M4: o mesmo registro aparece coerente nas cinco views; filtros combinados, empates, nulos, zero e falso têm testes unitários; a query é estável entre páginas e limitada em consultas; mover cartão altera campo/revisão, não duplica registro; calendário cobre UTC−3, fuso com horário de verão e data sem hora; template não compartilha IDs. Relação entre workspaces, dado de campo read-only e célula sem acesso são recusados em testes de banco e E2E.
