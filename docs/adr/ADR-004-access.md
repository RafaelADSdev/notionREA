# ADR-004 — Workspace, acesso e publicação
Status: proposta para Checkpoint 1; data: 26/10/2026.
Contexto: isolamento por workspace, quatro papéis por página e link público somente leitura; membros não recebem leitura privada automática.
Decisão proposta: workspace com owners administrativos/membros; página nasce privada ao criador, owner do workspace administra tudo; papéis de página owner/editor/commenter/viewer.
Herança: fronteira explícita por subárvore, grants até essa fronteira; associação ativa obrigatória; sem convidados externos avulsos no MVP.
Gestão: convite de uso único por link/e-mail confirmado expira em sete dias; proteger último owner; mover só altera acesso com gestão de todos os escopos afetados e confirmação.
Público: publicação explícita por página/base, sem herança a filhos; projeção whitelisted, bucket privado, revogação no servidor e cache controlado.
Consequências: RLS e constraints em todas as entidades, Storage/Realtime próprios; título, contagens e referências também são conteúdo protegido.
Contrato e testes: [segurança](../spec/collaboration-security.md); paths privilegiados validam autorização atual mesmo quando a chave ignora RLS.
