# Preparação de deploy — Vercel e Supabase

Este documento descreve a operação após autorização de publicação. Não executa deploy nem cria recursos remotos. Progresso e evidências permanecem exclusivamente em [PLAN](PLAN.md).

Publicação sem backend: `BLOCO_SETUP_MODE=true` mostra preparação e responde503 às APIs/ações. Na Vercel, configuração incompleta também ativa esse estado fechado. Não preencher chaves fictícias nem apontar o domínio publicado para loopback. Depois de configurar o Supabase hospedado e todas as variáveis abaixo, desative a flag e faça novo deploy com smoke completo. Tela publicada não comprova funcionamento de contas ou documentos.

## Configuração

Use um projeto Supabase separado por ambiente e um projeto Vercel com Node 24, framework Next.js e pnpm 11.25.0. `vercel.json` fixa instalação reproduzível, build e limites de duração. Escolha uma região Vercel próxima ao Postgres; consulte a disponibilidade do plano antes da implantação. Nenhum servidor WebSocket adicional é necessário.

| Variável na Vercel | Valor e exposição |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL HTTPS do projeto correto; pública e incorporada no build |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publicável do mesmo projeto; autorização depende de JWT/RLS |
| `SUPABASE_SECRET_KEY` | Chave privilegiada somente no servidor; marcar como sensível e nunca usar prefixo público |
| `APP_URL` | Origem HTTPS exata e estável do ambiente |
| `GOOGLE_AUTH_ENABLED` | `true` somente após configurar e comprovar o provedor real |
| `ENABLE_COLLABORATION_SPIKE` | Sempre `false` em produção |
| `LOCAL_PREVIEW_ENABLED` | Sempre `false` em produção; bypass local também exige portas/origens loopback específicas |
| `BLOCO_SETUP_MODE` | `true` enquanto o backend estiver adiado; `false` após configuração e validação do serviço hospedado |

Não compartilhe bancos, chaves ou contas pessoais entre produção e previews de PR. Variáveis públicas exigem novo build quando alteradas. `.env.example` contém nomes e exemplos, nunca valores reais.

## Banco, Auth e Storage

1. Faça backup do destino e registre a versão de schema. Compare o histórico remoto com `supabase/migrations/`; não faça reset de banco com dados de usuários.
2. Após revisão do diff, aplique as migrations versionadas na ordem, com Supabase CLI autenticada no projeto autorizado. Confirme o projeto antes de qualquer comando remoto. Não copie fixtures de teste.
3. Exponha apenas `public` pela Data API; schema `private` permanece interno. Todas as tabelas da aplicação usam RLS; buckets são privados. Não habilite exposição automática de tabelas novas.
4. Configure Site URL e callbacks Auth HTTPS exatos conforme [setup](setup.md). Configure SMTP, remetente e Google no Supabase; os segredos OAuth ficam no provedor Auth. Faça confirmação, recuperação e OAuth reais com conta de teste autorizada.
5. Configure o limite global de upload do Storage em **50 MiB**; o bucket `page-assets` continua em **25 MiB**, e o bucket de intercâmbio em 50 MiB. Use os limites dos buckets e validação de assinatura/dimensões, não apenas o tamanho declarado pelo cliente.
6. Mantenha canais Realtime privados e políticas de autorização versionadas. Presença não transporta conteúdo nem substitui a autorização HTTP atual. Confira quotas de conexões, mensagens, espaço e egress do plano contratado.

## Pacote e limites

`pnpm build` gera `.editor-runtime/validation-worker.mjs` antes do Next. O tracing inclui o worker nas rotas de documentos, databases e intercâmbio; não publique uma compilação parcial sem esse arquivo. Validação usa Node/worker_threads, não Edge runtime. Faça smoke do worker no ambiente hospedado.

Atualizações Yjs têm até 256 KiB; leituras privadas são paginadas em 512 KiB; publicação longa usa chunks de 256 KiB. Uploads maiores vão diretamente ao Storage por uma capacidade restrita. Downloads usam `ReadableStream`, sem `Content-Length`; exportação lê partes privadas com autorização atual e backpressure. Isso evita respostas bufferizadas acima do limite da Vercel, conforme [orientação oficial de streaming](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). O smoke remoto deve incluir um anexo maior que 4,5 MB; teste local não comprova o transporte hospedado.

Jobs processam lotes curtos e retomáveis mediante novas requisições do cliente; não há daemon escondido, cron ou dependência de execução após a resposta. A aba pode ser fechada após o ACK e o trabalho retomado depois. Não aumente os limites canônicos do editor para aceitar um documento inválido.

## Publicação e verificação

Antes de publicar, use os gates documentados no [AGENTS](../AGENTS.md), confira os arquivos rastreados e procure segredos no pacote cliente. Use primeiro um ambiente de staging com dados sintéticos. O CI não configura proteção de branch, contas externas ou DNS.

Após implantação autorizada, confira:

- `GET /api/health` retorna 200 com `{ "status": "ok" }`; esse endpoint confirma apenas o processo HTTP, sem testar banco ou Auth.
- Entrada/saída, recuperação e Google configurado retornam ao ambiente correto; cookies são seguros em HTTPS.
- Uma página salva, recarrega e aparece em busca; duas sessões convergem e um usuário revogado deixa de obter novo conteúdo.
- Base permite editar célula e trocar de view; importação confirma prévia, retoma lote e exporta ZIP legível.
- Anexo grande baixa por streaming; revogar publicação bloqueia a próxima leitura de arquivo/chunk.
- Teclado, tema e idioma funcionam em viewport móvel e desktop, sem exceções JavaScript.

Registre o resultado no PLAN e monitore a primeira hora. Consulte [operação e recuperação](operations.md) antes de liberar usuários.

Referências: [duração de Functions](https://vercel.com/docs/functions/configuring-functions/duration), [limites](https://vercel.com/docs/functions/limitations), [autorização Realtime](https://supabase.com/docs/guides/realtime/authorization).
