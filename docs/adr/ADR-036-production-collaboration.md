# ADR-036 — Colaboração e publicação de produção
Status: decisão reversível do M5; data: 26/10/2026.
Decisão: Realtime privado anuncia somente revisão; todo conteúdo continua passando por leitura autenticada e commit durável do editor.
Sessão: cookie e refresh token permanecem HttpOnly; endpoint da mesma origem devolve somente JWT de acesso temporário, validado, para memória do socket.
SDK: callback accessToken próprio evita que o cliente substitua a credencial por sessão inacessível ao JavaScript; autenticar antes de assinar canais.
Presence: época por workspace e leases de trinta segundos, renovadas a cada dez; tracks deduplicados e limitados, sem texto/e-mail/rótulos de autoridade.
Comentários: texto simples até 8 KiB, revisão/autoria no servidor, âncoras relativas e conversas preservadas após remoção do bloco.
Publicação: token opaco revogável, projeção whitelist atual e arquivos reautorizados antes da resposta; relações/filhas/registros não herdam publicação.
Provas e fontes: duas sessões reais, revogação e arquivo público em E2E; [autorização Realtime](https://supabase.com/docs/guides/realtime/authorization). Limites de publicação permanecem explícitos no plano.
