# ADR-038 — Acesso local sem tela de login
Status: decisão reversível autorizada pelo usuário; data: 26/10/2026.
Contexto: usuário pediu desativar antecipadamente a tela de login.
Decisão: LOCAL_PREVIEW_ENABLED permite sessão automática somente em loopback, app 3000 e Supabase 54321.
Identidade: conta sintética marcada no servidor e workspace de prévia idempotente, separados da conta pessoal.
Sessões existentes são preservadas; tokens permanecem em cookies HttpOnly e nunca entram em URLs.
Limites: origem/Host e navegação cross-site verificados; remoto e stack de testes não habilitam o acesso.
Segurança: a chave administrativa só inicia a sessão; conteúdo continua acessado com JWT do usuário e RLS.
Reversão: desabilitar a variável restaura o formulário; nenhuma tabela, política ou conta pessoal é alterada.
