# Modo local por navegador

Pedido posterior do usuário substitui a tela de preparação por um workspace funcional sem Supabase. É uma superfície individual adicional; a implementação sincronizada permanece preservada. Decisão: [ADR045](../adr/ADR-045-browser-local-workspace.md).

- Páginas com título/ícone, hierarquia sem ciclos, ordenação fracionária, favoritos, busca por título e lixeira restaurável.
- Mesmo editor TipTap/Yjs, com texto rico, listas/tarefas, títulos, código, citações/toggles/callouts, divisores, tabelas simples e colunas. Menu `/`, Markdown, arraste, undo/redo e teclado seguem os controles existentes.
- Autosave confirmado por transação IndexedDB; operação/hash/recibo idempotentes e merge Yjs sobre o snapshot atual, inclusive entre abas da mesma origem. Falha mantém rascunho/retry, impede navegação pelo app e oferece cópia de texto pendente.
- Backup JSON versionado e restaurável; validação isolada em worker, limites de32MiB/2500páginas/8MiB por documento e cinco segundos. Restauração adiciona somente IDs ausentes; nunca sobrescreve notas atuais.
- Tema/idioma pt-BR/en são preferências locais. Notas não são enviadas para API, Auth, Realtime ou Supabase. Rotas de nuvem permanecem503.
- Contas, comentários, publicação, mídia/arquivos, menções e databases sincronizados não aparecem como ações locais nesta primeira fatia; tipos recebidos em backup são preservados com aviso, sem requisições à nuvem.
- Persistência pertence à origem/perfil do navegador. Outros dispositivos/aliases não compartilham dados; modo anônimo, limpeza do site e descarte por quota podem removê-los. Backup externo é necessário; bootstrap offline completo não faz parte desta fatia.
- Não existe migração automática de dados locais para a nuvem. Ativar Supabase depois exige fluxo explícito e preservação dos dois conjuntos.
