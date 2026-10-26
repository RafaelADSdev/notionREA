# ADR-015 — Histórico pertencente à página
Status: decisão de implementação dentro da ADR-012 aprovada; data: 26/10/2026.
Contexto: o plugin de undo padrão destrói manager externo ao desmontar qualquer view, interrompendo captura das demais views ainda vivas.
Decisão: extensão TipTap própria preserva estado/chave do plugin e substitui somente seu lifecycle público de view; página é dona exclusiva do UndoManager.
Seleção: callbacks nomeados por view guardam seleção relativa em WeakMap e são removidos no unmount; nenhuma view destrói o histórico compartilhado.
Origem: manager rastreia ator estrutural e ySyncPluginKey local; updates remotos usam origem diferente, preservando undo local.
Alternativas recusadas: tornar destroy globalmente inoperante ou restaurar _observers/restore privados da biblioteca.
Prova: regressão falhou antes da correção; depois, destruir outra view mantém undo/redo estrutural e undo textual preserva edição remota.
Limite: seleção entre blocos e composição completa do editor continuam responsabilidade do M3; versões do binding estão fixadas e mudanças exigem executar regressões.
