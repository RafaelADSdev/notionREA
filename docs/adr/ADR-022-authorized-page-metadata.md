# ADR-022 — Projeções autorizadas da hierarquia
Status: implementação da fronteira de leitura da ADR-004; data: 26/10/2026.
Contexto: concessão direta a uma filha não autoriza descobrir a identidade ou quantidade de seus pais privados.
Decisão: parent_id físico e campos internos deixam de ter SELECT direto; RPC de metadados devolve whitelist e mascara pai indisponível.
Navegação: raízes lógicas incluem páginas com pai não visível; breadcrumbs retornam apenas ancestrais legíveis e ordinal visível para paginação.
Movimento: reordenação informa manter pai atual; servidor resolve a aresta física sob lock, sem exigir seu vazamento ao cliente.
Lixeira: filhos administráveis podem aparecer mesmo se a raiz do lote for privada, sem nome/ID do pai; não amplia restauração de outros escopos.
Alternativa recusada: esconder só a UI, mantendo parent_id ou profundidade física acessíveis via Data API.
Prova: regressões da leitura direta, metadados whitelisted, pais mascarados e cadeia com ancestral intermediário privado; resultados ficam no PLAN.
