# ADR-031 — Composição e seleção de estruturas
Status: detalhamento reversível do editor M3; data: 26/10/2026.
Colunas: controles oferecem de duas a doze colunas, com pesos positivos de 0,01 a 100; os limites pertencem ao schema de apresentação, não à quantidade de páginas/registros.
Remoção: confirmação move todos os filhos físicos para a coluna vizinha, incluindo tombstones, antes de ocultar a coluna; texto, IDs e ordem relativa permanecem intactos.
Concorrência: quantidade visível divergente dos pesos usa trilhas iguais; não esconder colunas aceitas por outra sessão para caber no vetor anterior.
Validação: mudanças fazem preflight e respeitam tamanho do documento e do delta; aplicar apenas operações do modelo, com uma ação desfazível.
Tabela: seleção retangular é estado local distinto de texto/blocos; copiar gera TSV canônico e excluir remove só caracteres/átomos conhecidos, preservando contêineres.
Renderização: o highlight recompõe apenas DOM de apresentação ao preencher código vazio, evitando custo quadrático de inserções antes do BR final; Yjs e IME permanecem preservados.
Provas: comandos estruturais, texto remoto, undo/redo e recarga têm verificações focadas; não reduzir corpus nem alterar timeouts para fazer gates passarem.
