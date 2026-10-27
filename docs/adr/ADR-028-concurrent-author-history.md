# ADR-028 — Histórico local com contribuições concorrentes
Status: complemento das ADR-012/015/027; data: 26/10/2026.
Problema: desfazer a criação de um bloco pode remover o contêiner de texto já editado por outra réplica.
Decisão: PageHistory usa o filtro de exclusão do UndoManager e protege contêineres com contribuições remotas vivas.
Metadados: proteger a identidade/posição/atributos exigidos pelo conteúdo remoto; uma transformação com novos atributos remotos pode manter seu tipo para não invalidá-los.
Tabelas: células referenciam a identidade estável da coluna de origem; preservá-la e seus ancestrais durante undo concorrente.
Limite: undo continua removendo apenas alterações locais possíveis; preservar conteúdo remoto pode manter um contêiner criado localmente.
Dependência: structs e intervalos tipados do Yjs fixado ficam isolados em PageHistory; processar um item de histórico por vez e recalcular a proteção ao pular ação sem efeito.
Provas: criação/edição concorrente, descendentes remotos, movimento anterior, tabela e redo têm regressões; não substituir o documento por snapshot.
