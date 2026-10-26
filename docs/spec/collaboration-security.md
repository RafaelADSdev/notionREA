# Colaboração, autorização e segurança

Origem D: missão e ADR-001/003/004/009. Segurança existe desde M1; simultaneidade é projetada desde M3 e liberada no M5. Detalhes de transporte são escolhas próprias, sem conhecimento de protocolo privado da referência.

## Papéis e herança

Membro ativo é pré-requisito para acesso autenticado; convidados sem vínculo de workspace ficam fora do MVP. Workspace tem owners administrativos e membros; ownership de página é independente. Página raiz nasce privada ao seu criador, com administração disponível ao owner do workspace. O criador pode compartilhar com membros ou conceder papel padrão ao workspace. Na árvore, uma página herda concessões até uma fronteira explicitamente restrita; a UI mostra a origem e o acesso efetivo. Sem regras de negação avulsas e sem papéis implícitos obtidos por URL.

| Capacidade na página | owner | editor | commenter | viewer | público |
| --- | --- | --- | --- | --- | --- |
| Ler página/propriedades autorizadas | Sim | Sim | Sim | Sim | Só projeção publicada |
| Editar corpo, campos e organização | Sim | Sim | Não | Não | Não |
| Comentar e responder | Sim | Sim | Sim | Não | Não |
| Alterar seu comentário | Sim | Sim | Sim | Não | Não |
| Resolver conversa | Sim | Sim | Se autor da conversa | Não | Não |
| Gerenciar acesso/publicação/ownership | Sim | Não | Não | Não | Não |

Owner de página pode transferir ownership para membro ativo, sem apagar a administração do workspace. Editor pode criar filha e mover dentro dos escopos em que tem edição, somente se o movimento não alterar acesso efetivo. Mudar leitores/capacidades pela herança requer gestão de acesso sobre todos os escopos afetados, calculada no servidor na mesma transação; confirmar uma prévia não substitui autorização. Nenhum papel pode criar vínculo entre workspaces. Remover membro revoga seu acesso em todas as superfícies; não apaga seu conteúdo automaticamente.

Ler uma filha por concessão direta não exige revelar pais: breadcrumbs ocultam nomes não autorizados. FTS, snippets, favoritos, menções, backlinks, células de relação, imagens de galeria e contagens não podem ser atalhos para descobrir páginas privadas. A lixeira tem autorização própria de administração e não amplia leitura.

## Edição simultânea e durabilidade

Documento canônico Yjs por página, persistido em log de updates e snapshots compactados. Servidor valida identidade, acesso atual, schema, limites e referências antes de aceitar. Cada operação possui ID idempotente. ACK só após commit do update e da revisão/projeção correspondente; Broadcast sinaliza revisão disponível, sem texto, nomes de páginas, comentários ou bytes do documento. O cliente busca dados duráveis mediante nova autorização. Presence/cursores têm canal e capacidade separados de edição.

Bootstrap entrega snapshot consistente e watermark; buscar updates posteriores e reconciliar por vetor de estado. A assinatura ocorre antes de concluir o catch-up; nova verificação fecha a janela entre leitura e assinatura. Eventos fora de ordem, repetidos ou ausentes não causam perda: catch-up ao reconectar, voltar à aba e verificação periódica de revisão recuperam updates persistidos. Compactação usa comparação de revisão e só remove log coberto por snapshot durável; corrida ou falha preserva a fonte anterior.

Yjs não resolve automaticamente conflito de propriedade de database, metadado, ACL ou movimento relacional. Esses domínios usam transações e revisão, com erro explícito de conflito e opção de recarregar/reaplicar. Não misturar JSON last-write-wins e CRDT no mesmo corpo. Operação rejeitada não é anunciada aos outros como aceita.

## Revogação e Realtime

A [documentação Supabase](https://supabase.com/docs/guides/realtime/authorization) informa que políticas do canal ficam em cache durante a conexão e são reavaliadas em eventos de autenticação. Por isso, mudar uma linha de ACL não basta para impedir que um canal antigo receba mensagens. A decisão de transportar apenas invalidação obriga toda leitura de conteúdo a passar pela autorização atual.

Mudar ACL incrementa época do canal, invalida leases e solicita renovação aos clientes autorizados. Presence transmite apenas ID de participante, cor original e âncora relativa, sem seleção textual, e-mails ou corpo; rótulos vêm de consulta autorizada. Ao perder acesso, cliente encerra subscriptions, remove cache e bloqueia edição. Cliente antigo não pode obter novo conteúdo mesmo ignorando aviso. Presence antiga expira por lease curta; o prazo e a rotação devem ser provados no M1/M5. Dados já recebidos não podem ser retirados da memória de uma pessoa.

## Comentários

Conversas de página ou bloco; âncora de intervalo usa posições relativas do CRDT. Corpo de comentário é texto/rich text restrito e sanitizado. Criar/responder/editar próprio/remover próprio, resolver/reabrir com capacidade adequada; datas/autoria do servidor. Bloco removido mantém conversa com estado de âncora indisponível, sem reassociar comentário a outro texto. Paginar conversas. Sem e-mail, webhook, notificação externa ou modo de sugestão no MVP.

## Link público somente leitura

Owner publica explicitamente a página; default privado, link opaco e revogável, sem indexação por buscadores no MVP. Projeção pública whitelist, sem log Yjs, ACL, e-mails, presença, comentários, backlinks privados ou URLs permanentes de objetos privados. Filhas, destinos de relação e databases inline não são publicados por herança: exigem publicação explícita de cada escopo; caso contrário renderizar conteúdo indisponível sem rótulo privado.

Publicar database expõe apenas campos selecionados e registros da projeção pública autorizada. Corpo de registro requer publicação própria. Pessoa não revela e-mail; relação só mostra destino também público. Resolver rótulos/referências contra publicação atual em cada leitura, sem confiar em rótulo antigo da projeção; revogar o destino também impede sua exposição por página de origem ainda publicada. Mudança/revogação, exclusão ou perda de vínculo invalida leitura pública no servidor e CDN; evitar cache compartilhado que sobreviva à autorização. Arquivos públicos passam por endpoint que verifica publicação atual; buckets continuam privados e nenhum link assinado de longa duração é fornecido ao visitante.

## Fronteiras de segurança

- Todas as tabelas da aplicação têm RLS com deny por padrão, inclusive log/snapshot, projeções, comentários, relações, templates e jobs. Constraints compostas impedem vínculos cruzados mesmo em caminhos privilegiados. Views SQL expostas respeitam o chamador ou ficam privadas; helpers privilegiados têm escopo mínimo e search path fixo.
- Leitura normal usa identidade do usuário e RLS; browser não pode gravar snapshot, índice ou projeção, nem chamar RPC de manutenção. Mutação de conteúdo passa por endpoint confiável que valida o CRDT. Caminho servidor privilegiado, quando necessário, revalida JWT e autorização atual em transação; não presume proteção por RLS de uma chave que a ignora. Service/secret key é exclusivamente servidor e não entra no bundle/log.
- Storage privado com política por workspace e página, nomes opacos, upload em staging e finalização validada; downloads autorizados. Realtime usa canal privado, políticas separadas de ler/enviar Presence e sem permissão cliente de Broadcast de conteúdo.
- Validar origem/CSRF quando aplicável, URLs de retorno e OAuth, rate limit por usuário/ação, tamanho e profundidade de dados, formato de ID e schema. Sem fetch servidor de URL arbitrária; não introduzir SSRF para preview de link.
- Sem HTML arbitrário: parser permitido, sanitização na entrada e renderização escapada; CSP compatível e sem execução em bloco de código. SVG/HTML anexados não renderizam inline em origem da aplicação. Links externos e nomes de arquivo não controlam HTML.
- Auditoria mínima de mutações administrativas: ator, escopo, ação, resultado e horário; não registrar corpo, senha, JWT, query de busca ou token de convite. Logs técnicos não viram histórico de versões do produto.

Aceitação: duas sessões convergem após edição simultânea, update fora de ordem, duplicado, ACK perdido, desconexão, compactação e reload; nenhum update confirmado é perdido. Undo local não remove contribuição remota. Papel viewer/commenter não injeta update via HTTP, Data API, RPC ou canal. Sessão revogada conectada não lê novo texto; projeção pública/arquivo negam acesso após revogar. Matriz de RLS cobre cada tabela, CRUD, dois workspaces, todos os papéis e anônimo; E2E cobre papéis reais, comentários e publicação.
