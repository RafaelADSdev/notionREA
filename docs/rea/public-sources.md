# Fontes públicas oficiais

Consultadas em 26/10/2026. As descrições nos documentos são paráfrases limitadas; nenhuma ilustração, exemplo de código ou texto de interface foi importado. P indica documentação pública; não observação do app instalado. Os contratos D definem comportamento original e prevalecem para o Bloco.

## Referência funcional

| ID | Fonte | Fato documental usado |
| --- | --- | --- |
| P-01 | [Escrita e edição](https://www.notion.com/help/writing-and-editing-basics) | Conteúdo organizado em unidades manipuláveis e operações de edição |
| P-02 | [Atalhos](https://www.notion.com/help/keyboard-shortcuts) | Categorias de comandos de teclado, seleção e transformações de texto |
| P-03 | [Organização e tabelas simples](https://www.notion.com/help/columns-headings-and-dividers) | Colunas lado a lado e tabela simples distinta de base |
| P-04 | [Introdução a databases](https://www.notion.com/help/intro-to-databases) | Registros abrem como páginas; apresentações inteira e inline |
| P-05 | [Views, filtros, ordenação e grupos](https://www.notion.com/help/views-filters-and-sorts) | Views compartilham registros e mantêm configurações próprias |
| P-06 | [Propriedades](https://www.notion.com/help/database-properties) | Campos tipados sobre registros |
| P-07 | [Templates de database](https://www.notion.com/help/database-templates) | Conteúdo e propriedades predefinidos ao criar registro |
| P-08 | [Compartilhamento](https://www.notion.com/help/sharing-and-permissions) | Acesso por pessoa, escopo compartilhado e publicação |
| P-09 | [Exclusão e restauração](https://www.notion.com/help/duplicate-delete-and-restore-content) | Lixeira e recuperação; conteúdo excluído tem tratamento distinto |
| P-10 | [Busca](https://www.notion.com/help/search) | Busca de páginas e conteúdo; página recuperada inicialmente, consultas posteriores tiveram timeout |
| P-11 | [Exportação](https://www.notion.com/help/export-your-content) | ZIP com Markdown, CSV e arquivos; formatos não preservam todos os recursos |
| P-12 | [Bloco na API pública](https://developers.notion.com/reference/block) | Unidades tipadas e filhos; não revela o esquema de armazenamento interno |
| P-13 | [Página na API pública](https://developers.notion.com/reference/page) | Metadados e valores de propriedades de uma página |
| P-14 | [Database na API pública](https://developers.notion.com/reference/database) | Contêiner de fontes de dados e apresentação inline/inteira |
| P-15 | [Fonte de dados na API pública](https://developers.notion.com/reference/data-source) | Schema de propriedades e páginas pertencentes a uma fonte |

## Fundamentos da solução própria

| ID | Fonte | Uso |
| --- | --- | --- |
| T-01 | [Updates Yjs](https://docs.yjs.dev/api/document-updates) | Convergência exige entrega eventual dos updates; ordem e duplicação toleradas pelo CRDT |
| T-02 | [Provider próprio Yjs](https://docs.yjs.dev/tutorials/creating-a-custom-provider) | Transporte e armazenamento são responsabilidades do provider |
| T-03 | [Autorização Realtime](https://supabase.com/docs/guides/realtime/authorization) | Políticas específicas para canais privados, Broadcast e Presence |
| T-04 | [Broadcast](https://supabase.com/docs/guides/realtime/broadcast) | Canal de distribuição; não substitui a persistência do produto |
| T-05 | [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) | Controle por linha e cuidado com caminhos privilegiados |
| T-06 | [CLI e desenvolvimento local](https://supabase.com/docs/guides/local-development/cli/getting-started) | CLI e runtime local suportado |
| T-07 | [Ciclo de versões Node](https://nodejs.org/en/about/previous-releases) | Linha 24 identificada como LTS na data consultada |
| T-08 | [TipTap e ProseMirror](https://tiptap.dev/docs/editor/core-concepts/prosemirror) | Modelo extensível do editor |
| T-09 | [Colaboração TipTap](https://tiptap.dev/docs/editor/extensions/functionality/collaboration) | Integração Yjs e histórico colaborativo |
| T-10 | [Acessibilidade TipTap](https://tiptap.dev/docs/guides/accessibility) | Responsabilidade da aplicação pelos controles e semântica |
| T-11 | [Licença do core TipTap](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md) | MIT; verificar separadamente cada extensão e versão |
| T-12 | [Estrutura BlockNote](https://www.blocknotejs.org/docs/foundations/document-structure) | Modelo de blocos e filhos |
| T-13 | [Colaboração BlockNote](https://www.blocknotejs.org/docs/features/collaboration) | Integração colaborativa |
| T-14 | [Licença comercial BlockNote XL](https://www.blocknotejs.org/legal/blocknote-xl-commercial-license) e [produto](https://www.blocknotejs.org/) | Colunas XL envolvem GPL-3.0 ou licença comercial |
| T-15 | [Lexical](https://lexical.dev/docs/intro) e [licença](https://github.com/facebook/lexical/blob/main/LICENSE) | Editor extensível; core MIT |
| T-16 | [Colaboração Lexical](https://lexical.dev/docs/collaboration/react) | Yjs; provider oficialmente suportado documentado como y-websocket |
| T-17 | [Testes de editor](https://lexical.dev/docs/testing) | Seleção e contentEditable requerem navegador para comprovação real |
| T-18 | [FTS PostgreSQL](https://www.postgresql.org/docs/current/textsearch.html) | Configurações, ranking e índices de busca |
| T-19 | [SSR Supabase/Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) | Cliente de sessão no runtime de servidor |
| T-20 | [Auth Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) | Configuração do provedor e callbacks |
| T-21 | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Referência normativa de acessibilidade |
| T-22 | [Limites Vercel Functions](https://vercel.com/docs/functions/limitations) | Verificação de duração/payload para o plano de deploy |

Não foram feitas chamadas à API do Notion. As páginas da API são apenas documentação pública. A distinção atual entre database e fonte de dados não obriga o Bloco a reproduzir a mesma interface ou recursos de múltiplas fontes.
