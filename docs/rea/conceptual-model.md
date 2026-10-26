# Modelo conceitual

Este modelo é abstração funcional. P-12 a P-15 da [API pública](public-sources.md) descrevem recursos externos, não o banco interno do Notion. Workspace, ACL, view e lifecycle abaixo são conceitos necessários à missão, sem alegação de recuperação de implementação.

| Conceito | Responsabilidade e relações conceituais |
| --- | --- |
| Pessoa | Identidade autenticada; participa de workspaces por vínculos |
| Workspace | Fronteira de isolamento; contém membros, páginas, bases e arquivos |
| Vínculo de membro | Associa pessoa e workspace; determina papel máximo permitido |
| Página | Identidade navegável com título, pai opcional, capa, ícone e ciclo de vida |
| Documento | Conteúdo editável de uma página; inclui unidades ordenadas e aninhadas |
| Bloco | Unidade com identidade estável, tipo e conteúdo; alguns tipos admitem filhos |
| Texto rico | Sequência de texto, marcas e referências; não é HTML confiável |
| Database | Coleção com schema de propriedades, registros e views; apresentada inteira ou inline |
| Propriedade | Define nome, tipo e configuração; nomes podem mudar sem trocar a identidade |
| Valor | Conteúdo tipado de uma propriedade em um registro |
| Registro | Página pertencente a uma base; combina propriedades e documento de blocos |
| View | Projeção de registros; layout, filtros, ordenação, grupos e propriedades visíveis |
| Template | Documento/valores de origem para novas instâncias independentes |
| Concessão de acesso | Liga sujeito e escopo a capacidades; herança deve ser explícita |
| Publicação | Autoriza leitura anônima de uma página; não equivale a acesso ao workspace |
| Comentário | Conversa vinculada a página/bloco e, se aplicável, intervalo de texto |
| Arquivo | Objeto privado do workspace, com vínculo a conteúdo e política de leitura |
| Referência | Liga página de origem a destino; backlinks são projeção com filtragem por acesso |

## Invariantes conceituais escolhidos para o Bloco (D)

- Uma página tem no máximo um pai de navegação; não existem ciclos nem vínculos entre workspaces. Profundidade não tem teto artificial; carregamento é incremental.
- Uma página de registro pertence a no máximo uma base; uma base tem um único schema no MVP. Uma view não detém cópias das páginas.
- Blocos são identificados independentemente da posição; mover não deve recriar comentário, upload ou referência.
- Título e propriedades de base são dados relacionais; o documento canônico e suas projeções seguem ADR-001. Não existem duas fontes concorrentes de verdade para o texto.
- Identidade autenticada não concede leitura por si. Documento, propriedades, arquivos, pesquisa, presença e backlinks usam a mesma autorização efetiva.
- Exclusão lógica de ancestral impede leitura comum dos descendentes; restauração não publica conteúdo e não revive concessões revogadas.
- Datas de sistema são do servidor; datas sem horário preservam o dia civil, sem conversão implícita de fuso.

As entidades e invariantes detalhados de implementação estão em [arquitetura](../spec/architecture.md). Não há nomes de tabelas ou identificadores recuperados da instalação neste modelo.
