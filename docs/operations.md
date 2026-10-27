# Operação e recuperação

## Diagnóstico sem expor conteúdo

Use métricas e logs nativos de Vercel/Supabase: erros 5xx, duração das rotas, timeouts, conexões Postgres/Realtime, armazenamento e egress. Não registre corpo de documento, comentários, e-mail, cookies, JWT, chaves ou URLs com tokens de publicação. O Next omite URLs de callback/publicação nos logs de requisições e não registra URL completa de fetch. Configure a retenção e restrição de acesso dos logs também na plataforma; configuração local não controla logs externos.

`/api/health` é uma prova de vida HTTP. Para disponibilidade completa, use uma conta e workspace sintéticos próprios em staging para salvar/reler conteúdo; nunca use páginas pessoais como sonda. Confirmação de salvamento significa ACK durável, não apenas texto visível no editor. Presença é transitória e pode expirar sem perda do documento confirmado.

Investigue imediatamente qualquer gravação confirmada que desapareça ou acesso após revogação. Para falhas operacionais, compare 5xx e p95 com a linha de base do ambiente; segure a liberação se dobrar a taxa de erros ou houver regressão de latência superior a 50%. Sem linha de base hospedada, não apresente esses limites como SLO já comprovado. Limites/quota 429 exigem espera e retry; não desative RLS ou validação para contorná-los.

## Backup e restauração

O conjunto de recuperação inclui banco com schema/histórico de migrations, dados de Auth, objetos privados de Storage e configuração externa de Auth/domínios. **Backup do Postgres sozinho não inclui os bytes dos objetos Storage.** Use os recursos disponíveis no plano Supabase e uma cópia separada dos objetos, com criptografia, acesso restrito e retenção definida pelo responsável pelo ambiente. Consulte [backups do Supabase](https://supabase.com/docs/guides/platform/backups).

Antes de uma migration em banco com usuários, registre contagens/identidades e checksums sem copiar conteúdo para logs. Guarde backups fora do Git. Teste a restauração em projeto isolado: restaure schema/dados e objetos preservando caminhos, execute migrations compatíveis e verifique entrada, páginas, documentos, anexos, ACL, busca e exportação com conta autorizada. Compare identidades/checksums. Registre data, duração e resultado; um arquivo de dump existente não comprova recuperação. Não restaure por cima do ambiente pessoal para fazer uma prova.

## Reversão

Se houver erro de UI/API sem mudança incompatível de dados, volte ao deployment Vercel anterior compatível e repita o smoke. Preserve o banco e os objetos. A versão anterior deve compreender o schema e os documentos atuais; não faça downgrade cego do schema Yjs.

Para migration incompatível ou erro de dados, suspenda gravações durante diagnóstico e prepare uma correção progressiva. Não aplique SQL destrutivo ou uma migration reversa improvisada. Se precisar restaurar, valide a cópia isolada, defina o intervalo de gravações afetadas e só então efetue a troca autorizada do ambiente. Jobs retomáveis mantêm recibos e identidades; cancelar não apaga páginas já confirmadas. Não purge jobs/objetos ativos para liberar quota.

## Ambiente local

A stack `bloco`/54321 contém dados pessoais: sem reset, purge ou remoção de volumes. Testes rodam em `bloco-test`/55321, app 3001. `pnpm test:env:stop` encerra somente o teste, preservando volumes; `pnpm test:db:reset` recria apenas seus dados descartáveis. Não copie `.env.test.local` sobre `.env.local`. Atualização da prévia pessoal exige backup e migrations aditivas verificadas.
