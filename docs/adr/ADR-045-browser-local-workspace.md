# ADR-045 — Workspace persistido no navegador

Status: adotada pelo pedido posterior “sem o Supabase, só com memória local”.
Usar IndexedDB versionado por origem para páginas, snapshots Yjs e recibos; localStorage guarda somente tema/idioma.
Reutilizar editor/validação/undo existentes com transporte injetado; transações fundem deltas sobre o estado atual entre abas.
Modo explícito BLOCO_LOCAL_MODE tem precedência; não inicializa conta, Realtime, API ou conexão Supabase.
Primeira fatia: páginas/hierarquia/favoritos/lixeira, blocos textuais/tabelas/colunas e backup JSON restaurável; mídia, menções e databases da nuvem não aparecem como ações locais.
Backups validam schema/conteúdo em worker com cinco segundos, até32MiB/2500páginas/8MiB por documento; restauração adiciona somente IDs ausentes.
Dados pertencem ao navegador/dispositivo, sem sincronização remota; limpar dados do site pode removê-los e exige backup externo do usuário.
Backend e dados pessoais existentes permanecem intactos; conectar a nuvem depois exige migração explícita, nunca sobrescrita automática.
