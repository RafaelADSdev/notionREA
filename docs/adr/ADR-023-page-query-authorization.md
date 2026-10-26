# ADR-023 — Autorização em conjunto para navegação e busca
Status: decisão reversível de desempenho da ADR-004; data: 26/10/2026.
Contexto: buscar termo comum ou páginas recentes repetia a resolução de ancestrais por resultado, excedendo 500 ms em 10 mil páginas.
Decisão: expandir a árvore ativa autorizada uma vez por consulta de workspace, sem cache persistente de permissões.
Semântica: restrição interrompe herança; concessão direta pode atravessar pai oculto; ancestral removido impede leitura de descendente ativo.
Fronteira: helper privado não executável pelo cliente; RPC confirma ator/membership e devolve projeção paginada com pais mascarados.
Alternativa recusada: aumentar o limite de tempo ou guardar ACL derivada sem invalidação transacional.
Verificação: paridade com page_role para todos os papéis, negativos de lifecycle e benchmark de owner/membro, busca e listagem.
Consequência: manter a resolução pontual para operações individuais; qualquer mudança de ACL deve preservar a paridade das duas consultas.
