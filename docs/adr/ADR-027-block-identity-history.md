# ADR-027 — Identidade de bloco durante desfazer criação
Status: complemento da ADR-012/015 descoberto em teste real do M3; data: 26/10/2026.
Problema: desfazer a criação remove o bloco do mapa ativo, mas Yjs mantém o root do fragmento e metadados de posição necessários para refazer.
Decisão: registrar identidades em mapa próprio fora do escopo de undo; IDs já emitidos não podem ser reutilizados por criação comum.
Validação: bloco ativo exige recibo de identidade; fragmento sem bloco ativo só é aceito se tiver recibo e estiver inteiramente vazio.
Histórico: refazer reintegra o bloco e seu texto sem trocar o fragmento; contribuições remotas permanecem no histórico da página.
Metadados: posição do binding pode referir uma identidade retida, mas continua submetida ao schema e aos limites da ADR-025.
Alternativa recusada: permitir qualquer fragmento órfão, descartar texto para passar o gate ou reconstruir todo o documento ao desfazer.
Prova: split, undo, reload canônico, redo e inserção remota são testes separados do editor real; schema 1 ainda não foi liberado no preview pessoal.
