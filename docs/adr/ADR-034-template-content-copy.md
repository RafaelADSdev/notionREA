# ADR-034 — Instâncias independentes de templates
Status: decisão reversível do M4; data: 26/10/2026.
Contexto: copiar um snapshot Yjs conservaria identidades de colaboração e referências privadas de arquivos da página original.
Decisão: reconstruir a projeção validada com novos IDs de página/blocos/CRDT, remapear colunas e preservar menções intencionais autorizadas.
Transporte: lotes causais menores que 256 KiB passam pelo mesmo validador/commit do editor; cortes textuais preservam pares Unicode.
Arquivos: download autenticado reautoriza a origem; novo staging privado no destino recebe a cópia e passa por validação/finalização normal.
Falha: a página criada é identificada para recuperação; não sobrescrever corpo existente nem confundir existência de snapshot com cópia concluída.
Limite: retomada durável de cópias interrompidas depende do mecanismo de jobs do M6; ausência de recibo não é relatada como sucesso.
Runtime: Yjs é externalizado no servidor Next para uma única instância por runtime; o navegador mantém seu bundle separado.
