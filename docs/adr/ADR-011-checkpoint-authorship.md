# ADR-011 — Autoria do commit documental
Status: decisão operacional reversível; data: 26/10/2026.
Contexto: o usuário autorizou commit ao fechar o checkpoint; não há user.name/user.email configurados no Git desta máquina.
Decisão: usar autoria técnica explícita Codex <codex@localhost> somente na invocação deste commit, sem inventar identidade pessoal ou alterar configuração global/local persistente.
Alternativa: interromper a entrega apenas por metadado reversível contraria a autonomia pedida para decisões pequenas.
Consequência: a autoria técnica fica auditável; commits futuros usam identidade que o usuário configurar ou nova escolha explícita documentada.
Limite: nenhuma conta GitHub foi acessada e não haverá push, assinatura em nome do usuário ou atribuição de e-mail pessoal.
