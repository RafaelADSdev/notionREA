# ADR-040 — Liberação local dos recursos estáveis
Status: adotada pelo pedido posterior “coloque as funções do notion”, abrangendo os três grupos; data: 26/10/2026.
Contexto: a prévia pessoal permanecia em M3 e ocultava as capacidades M4/M5 já implementadas e verificadas.
Decisão: liberar o código estável de `722e9e6`, com os estilos atuais e a entrada local da ADR-038, em runtime temporário independente.
Banco: aplicar somente migrations006–009, aditivas e testadas; backup binário privado e verificação de fingerprints dentro da transação.
Preservação: contas, workspaces, páginas, ACL, CRDT e arquivos existentes permanecem iguais; nenhuma operação de reset/purge.
Runtime: `%TEMP%/bloco-features-runtime` possui dependências próprias e build local; M6 permanece no checkout principal em andamento.
Reversão: runtime antigo continua disponível; não fazer downgrade destrutivo do schema nem servir M6 sem suas migrations verificadas.
Limites: libera editor, cinco views, templates, comentários, presença e compartilhamento; não afirma paridade integral com o produto de referência.
