# Fundação e páginas

Origem D: missão e ADR-004/005/006/008/009. Critérios descrevem o produto próprio.

## M1 — identidade e workspace

- Cadastro por e-mail e senha, confirmação de e-mail, login, logout e recuperação de senha via Supabase Auth; login Google por OAuth. Sessão verificada no servidor, cookies seguros e redirects restritos a destinos permitidos. Não vincular automaticamente provedores por comparação caseira de e-mails.
- Após autenticação sem vínculo, criar workspace com nome informado e transação que estabelece seu primeiro owner. Erro ou repetição não deixa workspace órfão nem cria cópias.
- Workspace tem owner e membros. Owner administra convites, vínculos e transferência de administração; o último owner não pode sair ou ser removido sem sucessor. Não há exclusão definitiva de workspace na UI do MVP.
- Convite usa link de uso único, expira em sete dias e é vinculado ao e-mail confirmado. O owner copia o link; envio automático de convite não é obrigatório. Token guardado apenas como hash; não registrar em logs. Reenvio revoga o anterior.
- Membro ingressa sem acesso automático a páginas privadas. O escopo por página concede owner/editor/commenter/viewer. Owner do workspace pode administrar todo o conteúdo, e isso deve ser comunicado na criação do workspace.
- Troca de workspace descarta caches autorizados e canais anteriores, sem misturar resultados. URL aponta para identidade estável do workspace e da página.
- Layout próprio: navegação lateral recolhível, barra de contexto, área de documento e estados de carregamento, erro e vazio. Claro/escuro, preferência de sistema e troca manual persistida por usuário. Nenhuma arte de referência.
- RLS e constraints desde a primeira migration; a tela não é fronteira de segurança. Banco local reproduzível e tipos gerados com paridade em CI. Segredos somente no servidor, exemplos sem valores reais.

Aceitação: dois usuários em workspaces distintos não leem/escrevem dados alheios por acesso direto; conta sem confirmação não aceita convite; convite expirado/reutilizado falha; último owner é preservado; logout impede nova leitura; navegação e formulários operam por teclado. OAuth real exige credenciais do projeto do usuário; simulação isolada não pode ser reportada como validação do provedor.

## M2 — ciclo de vida de página

| Ação | Comportamento verificável |
| --- | --- |
| Criar | Raiz ou filha de página autorizada; ID estável; foco no título; documento inicialmente vazio; rótulo provisório original se título em branco |
| Editar título | Renomear sem trocar URL ou romper menções; revisão impede sobrescrita silenciosa de metadado concorrente |
| Ícone/capa | Símbolo original ou emoji do sistema e upload de imagem própria; remoção preserva o restante; regras de upload iguais às do editor |
| Navegar | Carregar filhos sob demanda e irmãos paginados; breadcrumbs apenas de ancestrais visíveis; sem limite artificial de profundidade nem recursão de UI que estoure a pilha |
| Mover/reordenar | Drag via dnd-kit ou comando por teclado; ordem fracionária determinística; transação verifica workspace, ciclos, destinos ativos, acesso e revisão |
| Destino restrito | Recusar movimento para descendente, outro workspace, registro incompatível ou ancestral na lixeira; nunca corrigir silenciosamente para outro pai |
| Compartilhamento ao mover | Recalcular herança em toda a subárvore; qualquer alteração de acesso efetivo exige gestão de acesso sobre todos os escopos afetados e confirmação da prévia; editor sem essa capacidade só move se o acesso permanecer idêntico; limites explícitos continuam |
| Favoritar | Preferência por pessoa/workspace/página; não compartilha ou muda ordem da árvore; desaparece se perder acesso, reaparece após restauração autorizada |
| Remover | Exclusão lógica da subárvore, confirmação que informa alcance; página ativa e descendants ficam inacessíveis em navegação, FTS, APIs e publicação |
| Restaurar | Recuperar IDs/conteúdo; restaurar subárvore excluída na mesma operação, preservando exclusões anteriores independentes; pai indisponível exige destino autorizado ou raiz com aviso |
| Lixeira | Lista paginada e busca própria; apenas conteúdo que a pessoa podia administrar; não permite editar corpo antes de restaurar |

Metadados guardam autor, datas de servidor e revisão. Não há purge automático ou exclusão definitiva no MVP; backups e retenção operacional serão documentados para deploy. Restaurar não reativa publicações revogadas. A árvore de navegação é relacional, distinta do aninhamento de blocos de um documento. Registros pertencentes a uma base só saem dela por operação explícita que trata propriedades; drag comum não os converte em páginas soltas.

## Busca e descoberta

Ctrl/Cmd+K abre busca global do workspace; quando o editor tem seleção de texto não vazia, o mesmo atalho abre edição de link e o botão de busca continua disponível. Modal com foco inicial, setas/Enter, Esc e retorno ao foco anterior. Vazio mostra páginas recentes autorizadas; termo inválido ou sem resultado apresenta estado útil.

FTS do Postgres cobre título no M2 e corpo textual derivado no M3; termos em português/inglês e acentos seguem ADR-008. Título tem peso superior ao corpo, empate por ID estável. Página em lixeira, sem acesso ou de outro workspace não contribui com título, snippet, contagem ou sugestão. Resultados e snippets vêm do servidor, paginados por cursor; sem download completo do workspace. Backlinks aplicam filtro de acesso tanto à origem como ao destino.

Aceitação M2: criar/renomear/mover/remover/restaurar pelo teclado; cadeia de 1.000 níveis navegável sem limite de schema; drag concorrente para mesmo intervalo mantém ordem única; ciclo simultâneo é impedido no banco; editor não amplia/restringe acesso via movimento, inclusive por chamada direta ou corrida com ACL; rollback de erro devolve UI ao estado canônico; FTS não vaza resultados por título, corpo ou contagem. Testes unitários da posição + transação/índices/RLS + E2E do ciclo completo.
