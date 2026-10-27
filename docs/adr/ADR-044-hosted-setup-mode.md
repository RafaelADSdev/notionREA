# ADR-044 — Publicação sem banco conectado

Status: adotada pelo pedido “deixa o Supabase para depois, só faça o deploy na Vercel”.
Contexto: a conta atingiu dois projetos Free; nenhuma assinatura paga ou banco existente foi autorizado para o Bloco.
Decisão: publicar o código pelo Git, com tela original de preparação e APIs indisponíveis até configurar o backend.
O proxy reescreve navegações para setup, responde503 às APIs/ações e não inicializa sessão ou cliente Supabase.
Flag exclusiva do servidor BLOCO_SETUP_MODE; Vercel sem configuração completa também entra nesse estado fechado.
Não usar endpoints loopback, chaves locais, editor falso ou dados pessoais nessa publicação.
Reversão: configurar backend hospedado, APP_URL e provedores, desativar a flag, redeploy e executar smoke autorizado.
