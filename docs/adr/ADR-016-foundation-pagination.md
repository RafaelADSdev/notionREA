# ADR-016 — Paginação e manutenção da fundação
Status: decisão reversível dentro do M1; data: 26/10/2026.
Contexto: respostas PostgREST têm limite; equipe sem paginação pode ocultar membros e impedir gestão.
Decisão: RPC da equipe retorna até 51 registros ordenados por created_at/user_id, com cursor composto; UI mostra 50 e próxima página.
Integridade: cursor exige ambos os componentes; índice por workspace/created_at/user_id e autorização de owner em cada consulta.
Workspaces: índice/consulta por UUID e páginas de 50; seletor mostra o primeiro conjunto e oferece a lista completa paginada.
Manutenção: exclusão privilegiada de workspace permite cascade de membros somente quando o pai já não existe; último owner continua protegido em workspace existente.
Alternativa recusada: aumentar max_rows ou remover proteção de owner para contornar truncamento/cleanup.
Prova: casos de timestamps empatados, páginas sem repetição/omissão, cursor parcial e autorização negativa no banco; navegação também em E2E.
