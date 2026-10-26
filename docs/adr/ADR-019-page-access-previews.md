# ADR-019 — Confirmação vinculada ao efeito de acesso
Status: decisão de implementação da ADR-004; data: 26/10/2026.
Contexto: mover/restaurar pode mudar a herança de toda uma subárvore; um checkbox antigo não confirma uma prévia atual.
Decisão: simular a nova aresta sem editar dados, comparar capacidades de todos os membros/escopos e exigir administração de todos os afetados se houver diferença.
Confirmação: hash SHA-256 vincula ator, revisão, destino/âncora, lotes e matrizes antes/depois; mudança após prévia exige nova confirmação.
Privacidade: editor só move se a matriz não muda e não recebe contagem de descendentes privados; o servidor continua autorizando em cada commit.
Concorrência: todas as mutações de árvore e ACL serializam o workspace; revisão impede sobrescrever metadado/organização obsoletos.
Restauração: lote revivido exclui remoções independentes antigas; destino original indisponível exige escolha explícita, incluindo raiz.
Prova: pgTAP e duas conexões reais cobrem ciclos, mesmo intervalo, revogação durante lock e prévia obsoleta; resultados ficam no PLAN.
